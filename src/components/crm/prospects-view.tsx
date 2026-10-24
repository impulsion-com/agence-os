"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Ban, FileUp, Globe, Handshake, MapPin, RotateCcw, Search, Star, Tag, Trash2, X } from "lucide-react";

import { EmptyState } from "@/components/ui/misc";
import { ConfirmModal, Popover } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { colorOf } from "@/lib/constants";
import { logActivity, must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { addProspectsToCrm, bestEmail, PROSPECT_STATUS, type AddToCrmResult, type Prospect } from "@/lib/prospects";
import { ProspectsImportModal } from "./prospects-import-modal";
import { ComboList, PageCrumbs, sortRows, SortTh } from "./shared";

type Tab = Prospect["status"] | "all";
type Col = "name" | "city" | "rating" | "reviews" | "email" | "phone";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fr = (n: number) => String(n).replace(".", ",");
// Les identifiants partent dans l'URL de la requête : par lots pour rester sous sa longueur maximale
const chunks = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function ChipToggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`btn btn-sm${on ? " crm-on" : " btn-ghost"}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}

export function ProspectsView({ prospects, total, limit }: { prospects: Prospect[]; total: number; limit: number }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("new");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [hasEmail, setHasEmail] = useState(false);
  const [hasSite, setHasSite] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [minReviews, setMinReviews] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [withDeal, setWithDeal] = useState(true);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "reviews", dir: -1 });

  const counts = { new: 0, added: 0, ignored: 0, all: prospects.length };
  for (const p of prospects) counts[p.status]++;
  const inTab = prospects.filter((p) => tab === "all" || p.status === tab);
  const values = (k: "category" | "city") => Array.from(new Set(inTab.map((p) => p[k]).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr"));

  const filtered = inTab.filter((p) => {
    if (category && p.category !== category) return false;
    if (city && p.city !== city) return false;
    if (hasEmail && !p.emails.length) return false;
    if (hasSite && !p.website) return false;
    if (minRating && (p.rating ?? 0) < minRating) return false;
    if (minReviews && (p.reviews ?? 0) < minReviews) return false;
    return !q || norm(`${p.name} ${p.category} ${p.city} ${p.address} ${p.emails.join(" ")} ${p.search}`).includes(norm(q));
  });
  const rows = sortRows(
    filtered,
    (p) => {
      switch (sort.col) {
        case "name": return p.name;
        case "city": return p.city || "~";
        case "rating": return p.rating ?? -1;
        case "reviews": return p.reviews ?? -1;
        case "email": return bestEmail(p.emails) || "~";
        case "phone": return p.phone || "~";
      }
    },
    sort.dir,
  );
  const picked = rows.filter((p) => sel.has(p.id));
  const all = rows.length > 0 && picked.length === rows.length;
  const filters = !!(category || city || hasEmail || hasSite || minRating || minReviews);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const clearFilters = () => {
    setCategory(null);
    setCity(null);
    setHasEmail(false);
    setHasSite(false);
    setMinRating(0);
    setMinReviews(0);
  };

  const setStatus = async (status: Prospect["status"]) => {
    const ids = picked.map((p) => p.id);
    if (!ids.length) return;
    const ok = await mutate(async (sb) => {
      for (const part of chunks(ids)) must(await sb.from("prospects").update({ status }).eq("workspace_id", ws.workspace.id).in("id", part));
      return true;
    }, {
      success: status === "ignored" ? `${ids.length} fiche${ids.length > 1 ? "s" : ""} écartée${ids.length > 1 ? "s" : ""}` : `${ids.length} fiche${ids.length > 1 ? "s" : ""} remise${ids.length > 1 ? "s" : ""} à trier`,
    });
    if (ok !== undefined) setSel(new Set());
  };

  const addToCrm = async () => {
    const ids = picked.filter((p) => p.status !== "added").map((p) => p.id);
    if (!ids.length || busy) return;
    setBusy(true);
    const res = await mutate(async (sb) => {
      const r: AddToCrmResult = { companies: [], contacts: 0, deals: [] };
      for (const part of chunks(ids)) {
        const x = await addProspectsToCrm(sb, { workspaceId: ws.workspace.id, ownerId: ws.me.id, ids: part, withDeal });
        r.companies.push(...x.companies);
        r.contacts += x.contacts;
        r.deals.push(...x.deals);
      }
      for (const d of r.deals) await logActivity(sb, { workspace_id: ws.workspace.id, verb: "deal.created", deal_id: d.id, meta: { title: d.title, value: 0, via: "prospection" } });
      return r;
    });
    setBusy(false);
    if (!res) return;
    setSel(new Set());
    const created = res.companies.filter((c) => c.created).length;
    toast(
      [
        `${created} prospect${created > 1 ? "s" : ""} ajouté${created > 1 ? "s" : ""} au CRM`,
        res.companies.length > created && `${res.companies.length - created} déjà présent${res.companies.length - created > 1 ? "s" : ""}`,
        res.contacts && `${res.contacts} contact${res.contacts > 1 ? "s" : ""}`,
        res.deals.length && `${res.deals.length} deal${res.deals.length > 1 ? "s" : ""}`,
      ]
        .filter(Boolean)
        .join(", "),
    );
  };

  const remove = async () => {
    const ids = picked.map((p) => p.id);
    await mutate(async (sb) => {
      for (const part of chunks(ids)) must(await sb.from("prospects").delete().eq("workspace_id", ws.workspace.id).in("id", part));
    }, { success: `${ids.length} fiche${ids.length > 1 ? "s" : ""} supprimée${ids.length > 1 ? "s" : ""}` });
    setSel(new Set());
    setDeleting(false);
  };

  return (
    <div className="crm-wrap">
      <PageCrumbs items={[{ label: "Prospection" }]} />
      <div className="crm-top">
        <div className="ph">
          <div>
            <h1>Prospection</h1>
            <p>Les entreprises trouvées sur Google Maps. Trie-les ici, puis ajoute au CRM celles qui valent un appel.</p>
          </div>
          {ws.canWrite && (
            <div className="actions">
              <button className="btn btn-primary" onClick={() => setImporting(true)}>
                <FileUp size={14} /> Importer un CSV
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="crm-body" style={{ display: "block" }}>
        {!prospects.length ? (
          <div className="card">
            <EmptyState
              icon="target"
              title="Aucune fiche pour l'instant"
              text="Lance une recherche avec google-maps-scraper (par exemple « agence immobilière Nantes »), puis importe le CSV obtenu. Avec Claude Code, demande directement « trouve les agences immobilières de Nantes et mets-les dans ma prospection » : l'outil MCP import_prospects les envoie ici."
            >
              {ws.canWrite && (
                <button className="btn btn-primary" onClick={() => setImporting(true)}>
                  <FileUp size={14} /> Importer un CSV
                </button>
              )}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="crm-list-bar">
              <div className="seg" role="tablist" aria-label="Statut">
                {(["new", "added", "ignored", "all"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? "on" : ""}
                    onClick={() => {
                      setTab(t);
                      setSel(new Set());
                    }}
                  >
                    {t === "all" ? "Toutes" : PROSPECT_STATUS[t].name}
                    <span className="count">{counts[t]}</span>
                  </button>
                ))}
              </div>
              <label className="crm-search">
                <Search size={14} className="faint" />
                <input placeholder="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une fiche" />
                {q && (
                  <button onClick={() => setQ("")} aria-label="Effacer la recherche">
                    <X size={13} />
                  </button>
                )}
              </label>
            </div>
            <div className="crm-list-bar" style={{ marginTop: 0 }}>
              <Popover
                width={280}
                trigger={(open) => (
                  <button className={`btn btn-sm${category ? " crm-on" : " btn-ghost"}`} onClick={open}>
                    <Tag size={14} /> {category ?? "Catégorie"}
                  </button>
                )}
              >
                {(close) => (
                  <ComboList
                    placeholder="Filtrer par catégorie…"
                    value={category}
                    none="Toutes les catégories"
                    items={values("category").map((c) => ({ id: c, label: c }))}
                    onPick={(id) => {
                      setCategory(id);
                      close();
                    }}
                  />
                )}
              </Popover>
              <Popover
                width={240}
                trigger={(open) => (
                  <button className={`btn btn-sm${city ? " crm-on" : " btn-ghost"}`} onClick={open}>
                    <MapPin size={14} /> {city ?? "Ville"}
                  </button>
                )}
              >
                {(close) => (
                  <ComboList
                    placeholder="Filtrer par ville…"
                    value={city}
                    none="Toutes les villes"
                    items={values("city").map((c) => ({ id: c, label: c }))}
                    onPick={(id) => {
                      setCity(id);
                      close();
                    }}
                  />
                )}
              </Popover>
              <ChipToggle on={hasEmail} onClick={() => setHasEmail((v) => !v)}>Avec email</ChipToggle>
              <ChipToggle on={hasSite} onClick={() => setHasSite((v) => !v)}>
                <Globe size={14} /> Avec site
              </ChipToggle>
              <ChipToggle on={minRating > 0} onClick={() => setMinRating((v) => (v ? 0 : 4))}>
                <Star size={14} /> 4 et plus
              </ChipToggle>
              <ChipToggle on={minReviews > 0} onClick={() => setMinReviews((v) => (v ? 0 : 20))}>20 avis et plus</ChipToggle>
              {filters && (
                <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
                  <X size={13} /> Effacer
                </button>
              )}
              <span className="faint" style={{ marginLeft: "auto", fontSize: "var(--fs-sm)" }}>
                {rows.length} fiche{rows.length > 1 ? "s" : ""}
              </span>
            </div>

            <div className="crm-table-wrap card">
              <table className="tbl crm-tbl">
                <thead>
                  <tr>
                    {ws.canWrite && (
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          className="check"
                          checked={all}
                          aria-label="Tout sélectionner"
                          onChange={() => setSel(all ? new Set() : new Set(rows.map((p) => p.id)))}
                        />
                      </th>
                    )}
                    <SortTh sort={sort} onSort={setSort} col="name">Entreprise</SortTh>
                    <SortTh sort={sort} onSort={setSort} col="city" cls="crm-hide-sm">Ville</SortTh>
                    <SortTh sort={sort} onSort={setSort} col="rating">Note</SortTh>
                    <SortTh sort={sort} onSort={setSort} col="reviews" cls="crm-hide-md">Avis</SortTh>
                    <SortTh sort={sort} onSort={setSort} col="email">Email</SortTh>
                    <SortTh sort={sort} onSort={setSort} col="phone" cls="crm-hide-md">Téléphone</SortTh>
                    <th className="crm-hide-sm">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const email = bestEmail(p.emails);
                    const st = PROSPECT_STATUS[p.status];
                    return (
                      <tr key={p.id} className="crm-tr" onClick={() => ws.canWrite && toggle(p.id)} style={sel.has(p.id) ? { background: "var(--accent-soft)" } : undefined}>
                        {ws.canWrite && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" className="check" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Sélectionner ${p.name}`} />
                          </td>
                        )}
                        <td style={{ maxWidth: 320 }}>
                          <span className="trunc" style={{ display: "block", fontWeight: 500 }}>{p.name}</span>
                          <span className="fainter trunc" style={{ display: "flex", gap: 8, fontSize: "var(--fs-xs)" }} onClick={(e) => e.stopPropagation()}>
                            {p.category && <span>{p.category}</span>}
                            {p.website && (
                              <a href={p.website} target="_blank" rel="noreferrer" className="crm-muted-link">
                                {p.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                              </a>
                            )}
                            {p.maps_url && (
                              <a href={p.maps_url} target="_blank" rel="noreferrer" className="crm-muted-link">
                                Maps
                              </a>
                            )}
                          </span>
                        </td>
                        <td className="crm-hide-sm faint">{p.city || <span className="fainter">-</span>}</td>
                        <td className="num">{p.rating !== null ? fr(p.rating) : <span className="fainter">-</span>}</td>
                        <td className="crm-hide-md num faint">{p.reviews ?? <span className="fainter">-</span>}</td>
                        <td onClick={(e) => e.stopPropagation()} style={{ maxWidth: 240 }}>
                          {email ? (
                            <a href={`mailto:${email}`} className="crm-muted-link trunc" style={{ display: "block" }} title={p.emails.join(", ")}>
                              {email}
                              {p.emails.length > 1 && <span className="fainter"> +{p.emails.length - 1}</span>}
                            </a>
                          ) : (
                            <span className="fainter">-</span>
                          )}
                        </td>
                        <td className="crm-hide-md num" onClick={(e) => e.stopPropagation()}>
                          {p.phone ? <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="crm-muted-link">{p.phone}</a> : <span className="fainter">-</span>}
                        </td>
                        <td className="crm-hide-sm" onClick={(e) => e.stopPropagation()}>
                          {p.status === "added" && p.company_id ? (
                            <Link href={`${ws.base}/crm/companies/${p.company_id}`} className="badge" style={{ ["--c" as string]: colorOf(st.color) }}>{st.name}</Link>
                          ) : (
                            <span className="badge" style={{ ["--c" as string]: colorOf(st.color) }}>{st.name}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td colSpan={8} className="faint" style={{ textAlign: "center", height: 80 }}>
                        Aucune fiche ne correspond.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {total > limit && (
              <p className="faint" style={{ fontSize: "var(--fs-xs)", marginTop: 8 }}>
                {limit} fiches les plus récentes affichées sur {total}. Écarte ou supprime celles qui ne servent plus pour voir les autres.
              </p>
            )}
          </>
        )}
      </div>

      {picked.length > 0 && (
        <div className="bulkbar" role="toolbar" aria-label="Actions groupées">
          <span className="crm-bulk-count">
            {picked.length} sélectionnée{picked.length > 1 ? "s" : ""}
          </span>
          {picked.some((p) => p.status !== "added") && (
            <>
              <label className="crm-bulk-opt">
                <input type="checkbox" className="check" checked={withDeal} onChange={(e) => setWithDeal(e.target.checked)} /> Ouvrir un deal
              </label>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={addToCrm}>
                <Handshake size={14} /> {busy ? "Ajout…" : "Ajouter au CRM"}
              </button>
            </>
          )}
          {tab !== "ignored" && (
            <button className="btn btn-sm btn-ghost" onClick={() => setStatus("ignored")}>
              <Ban size={14} /> Écarter
            </button>
          )}
          {tab === "ignored" && (
            <button className="btn btn-sm btn-ghost" onClick={() => setStatus("new")}>
              <RotateCcw size={14} /> Remettre à trier
            </button>
          )}
          <button className="btn btn-sm btn-ghost btn-icon" aria-label="Supprimer" onClick={() => setDeleting(true)}>
            <Trash2 size={14} />
          </button>
          <button className="btn btn-sm btn-ghost btn-icon" aria-label="Désélectionner" onClick={() => setSel(new Set())}>
            <X size={14} />
          </button>
        </div>
      )}

      {importing && <ProspectsImportModal onClose={() => setImporting(false)} />}
      {deleting && (
        <ConfirmModal
          title={`Supprimer ${picked.length} fiche${picked.length > 1 ? "s" : ""} ?`}
          text="Les fiches disparaissent de la prospection. Les entreprises déjà ajoutées au CRM restent. Une fiche supprimée reviendra si tu réimportes le même fichier : pour l'écarter durablement, utilise plutôt « Écarter »."
          onConfirm={remove}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
