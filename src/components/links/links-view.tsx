"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChartColumn, Building2, ChevronDown, Copy, CopyPlus, Download, Ellipsis, Layers, Link2, Pencil, Plus, Power, QrCode, Search, Tag, Trash2, X,
} from "lucide-react";

import "@/styles/reporting.css";
import "@/styles/links.css";
import { PageHeader, EmptyState, Badge, LabelChip } from "@/components/ui/misc";
import { ConfirmModal, Menu, type MenuItem } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/avatar";
import { CompanyMark, SortTh, useSort } from "@/components/reporting/common";
import { fmtDate, money, num } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { readUtm, toCsv, download } from "@/lib/links/utm";
import type { Attribution, LinkRow } from "@/lib/links/load";
import { QrModal, TrackingCallout, isExpired, useCopy, useShort } from "./shared";

type Col = "name" | "source" | "clicks" | "leads" | "sales" | "created";
type StatusFilter = "all" | "active" | "inactive";

interface Props {
  links: LinkRow[];
  attribution: Record<string, Attribution>;
  tracking: { sites: number; active: boolean };
}

export function LinksView({ links, attribution, tracking }: Props) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const short = useShort();
  const { copy } = useCopy();
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [qr, setQr] = useState<LinkRow | null>(null);
  const [del, setDel] = useState<LinkRow | null>(null);
  const currency = ws.workspace.currency || "EUR";
  const hasAttr = tracking.sites > 0;

  const rows = useMemo(
    () =>
      links.map((l) => {
        const u = readUtm(l.utm);
        return { ...l, u, attr: attribution[l.id] ?? null, off: !l.active || isExpired(l.expires_at) };
      }),
    [links, attribution],
  );

  const sources = useMemo(() => [...new Set(rows.map((r) => r.u.utm_source).filter(Boolean))].sort(), [rows]);
  const tags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "fr")), [rows]);
  const companies = useMemo(() => [...new Set(rows.map((r) => r.company_id).filter(Boolean))] as string[], [rows]);

  const filtered = rows.filter((r) => {
    if (company && r.company_id !== company) return false;
    if (source && r.u.utm_source !== source) return false;
    if (tag && !r.tags.includes(tag)) return false;
    if (status === "active" && r.off) return false;
    if (status === "inactive" && !r.off) return false;
    if (q) {
      const s = q.toLowerCase();
      const hay = [r.name, r.destination, r.code ?? "", r.u.utm_campaign, r.u.utm_source, r.u.utm_medium, r.u.utm_content, ...r.tags, ws.company(r.company_id)?.name ?? ""].join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  const { sort, toggle, apply } = useSort<Col>("created");
  const sorted = apply(filtered, (r, k) => {
    switch (k) {
      case "name":
        return (r.name || r.destination).toLowerCase();
      case "source":
        return r.u.utm_source || null;
      case "clicks":
        return r.code ? r.clicks : null;
      case "leads":
        return r.attr?.leads ?? null;
      case "sales":
        return r.attr?.revenue ?? r.attr?.sales ?? null;
      default:
        return new Date(r.created_at).getTime();
    }
  });

  const setActive = (l: LinkRow, active: boolean) =>
    mutate(async (sb) => must(await sb.from("links").update({ active }).eq("id", l.id)), { success: active ? "Lien réactivé" : "Lien désactivé" });

  const exportCsv = () => {
    const head = ["nom", "client", "lien_court", "destination", "url_finale", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "etiquettes", "actif", "clics", "prospects", "ventes", "chiffre_affaires", "cree_le"];
    const body = sorted.map((r) => [
      r.name, ws.company(r.company_id)?.name ?? "", r.code ? short.url(r.code) : "", r.destination, r.final_url,
      r.u.utm_source, r.u.utm_medium, r.u.utm_campaign, r.u.utm_content, r.u.utm_term, r.tags.join(" | "),
      r.off ? "non" : "oui", r.code ? r.clicks : "", r.attr?.leads ?? "", r.attr?.sales ?? "", r.attr?.revenue ?? "", r.created_at.slice(0, 10),
    ]);
    download(`liens-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
  };

  const filtersOn = !!(company || source || tag || status !== "all" || q);

  return (
    <div className="page">
      <PageHeader title="Liens trackés" sub="Génère des liens UTM propres, raccourcis et traçables, puis suis leurs clics et ce qu'ils rapportent.">
        <button className="btn" onClick={exportCsv} disabled={!sorted.length}>
          <Download size={14} /> Exporter
        </button>
        {ws.canWrite && (
          <>
            <Link href={`${ws.base}/links/new?mode=bulk`} className="btn">
              <Layers size={14} /> En masse
            </Link>
            <Link href={`${ws.base}/links/new`} className="btn btn-primary">
              <Plus size={14} /> Nouveau lien
            </Link>
          </>
        )}
      </PageHeader>

      {!tracking.active && links.length > 0 && <TrackingCallout sites={tracking.sites} />}

      {links.length === 0 ? (
        <div className="card">
          <EmptyState icon="link" title="Aucun lien pour l'instant" text="Crée un lien UTM pour une campagne, une newsletter ou une bio Instagram. Tu pourras le raccourcir et en faire un QR code.">
            {ws.canWrite && (
              <Link href={`${ws.base}/links/new`} className="btn btn-primary">
                <Plus size={14} /> Créer un lien
              </Link>
            )}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="lnk-toolbar">
            <label className="searchbox">
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un lien, une campagne…" aria-label="Rechercher" />
            </label>
            <Menu
              search="Client…"
              items={[{ label: "Tous les clients", checked: !company, onSelect: () => setCompany(null) }, ...companies.map((id) => ({ label: ws.company(id)?.name ?? "Client supprimé", checked: company === id, onSelect: () => setCompany(id) }))]}
              trigger={(open) => (
                <button className={`btn lnk-filter${company ? " on" : ""}`} onClick={open}>
                  <Building2 size={14} /> {company ? ws.company(company)?.name : "Client"} <ChevronDown size={13} className="faint" />
                </button>
              )}
            />
            <Menu
              items={[{ label: "Toutes les sources", checked: !source, onSelect: () => setSource(null) }, ...sources.map((s) => ({ label: s, checked: source === s, onSelect: () => setSource(s) }))]}
              trigger={(open) => (
                <button className={`btn lnk-filter${source ? " on" : ""}`} onClick={open}>
                  <Link2 size={14} /> {source ?? "Source"} <ChevronDown size={13} className="faint" />
                </button>
              )}
            />
            {tags.length > 0 && (
              <Menu
                search="Étiquette…"
                items={[{ label: "Toutes les étiquettes", checked: !tag, onSelect: () => setTag(null) }, ...tags.map((t) => ({ label: t, checked: tag === t, onSelect: () => setTag(t) }))]}
                trigger={(open) => (
                  <button className={`btn lnk-filter${tag ? " on" : ""}`} onClick={open}>
                    <Tag size={14} /> {tag ?? "Étiquette"} <ChevronDown size={13} className="faint" />
                  </button>
                )}
              />
            )}
            <div className="seg" role="group" aria-label="Statut">
              {(
                [
                  ["all", "Tous"],
                  ["active", "Actifs"],
                  ["inactive", "Inactifs"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)} aria-pressed={status === k}>
                  {l}
                </button>
              ))}
            </div>
            {filtersOn && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setQ("");
                  setCompany(null);
                  setSource(null);
                  setTag(null);
                  setStatus("all");
                }}
              >
                <X size={13} /> Effacer
              </button>
            )}
            <span className="spacer" />
            <span className="faint" style={{ fontSize: 12.5 }}>
              {sorted.length} lien{sorted.length > 1 ? "s" : ""}
            </span>
          </div>

          <div className="card">
            <div className="rp-scroll">
              <table className="tbl rp-tbl lnk-table" style={{ minWidth: hasAttr ? 900 : 760 }}>
                <thead>
                  <tr>
                    <SortTh k="name" sort={sort} onSort={toggle}>Lien et client</SortTh>
                    <th>Lien court</th>
                    <SortTh k="source" sort={sort} onSort={toggle}>Source / support / campagne</SortTh>
                    <SortTh k="clicks" sort={sort} onSort={toggle} right>Clics</SortTh>
                    {hasAttr && <SortTh k="leads" sort={sort} onSort={toggle} right>Prospects</SortTh>}
                    {hasAttr && <SortTh k="sales" sort={sort} onSort={toggle} right>Ventes</SortTh>}
                    <SortTh k="created" sort={sort} onSort={toggle} right>Créé</SortTh>
                    <th className="acts"><span className="sr">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const c = ws.company(r.company_id);
                    const m = ws.member(r.created_by);
                    const href = `${ws.base}/links/${r.id}`;
                    const items: MenuItem[] = [
                      ...(r.code ? [{ label: "Copier le lien court", icon: <Copy size={14} />, onSelect: () => copy(short.url(r.code!)) }] : []),
                      { label: "Copier l'URL complète", icon: <Link2 size={14} />, onSelect: () => copy(r.final_url) },
                      { label: "QR code", icon: <QrCode size={14} />, onSelect: () => setQr(r) },
                      { label: "Statistiques", icon: <ChartColumn size={14} />, onSelect: () => router.push(href) },
                      ...(ws.canWrite
                        ? [
                            { separator: true, label: "" },
                            { label: "Modifier", icon: <Pencil size={14} />, onSelect: () => router.push(`${href}/edit`) },
                            { label: "Dupliquer", icon: <CopyPlus size={14} />, onSelect: () => router.push(`${ws.base}/links/new?from=${r.id}`) },
                            { label: r.active ? "Désactiver" : "Réactiver", icon: <Power size={14} />, onSelect: () => setActive(r, !r.active) },
                            { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDel(r) },
                          ]
                        : []),
                    ];
                    return (
                      <tr key={r.id} className={`link${r.off ? " off" : ""}`} onClick={() => router.push(href)}>
                        <td>
                          <div className="nm">
                            <span className="l1">
                              <Link href={href} className="trunc" onClick={(e) => e.stopPropagation()}>
                                <b>{r.name || r.destination.replace(/^https?:\/\//, "")}</b>
                              </Link>
                              {!r.active && <Badge color="var(--gray)">Désactivé</Badge>}
                              {r.active && isExpired(r.expires_at) && <Badge color="var(--amber)">Expiré</Badge>}
                              {r.tags.slice(0, 2).map((t) => (
                                <LabelChip key={t} name={t} color="slate" />
                              ))}
                            </span>
                            <span className="dest">
                              {c && (
                                <>
                                  <CompanyMark name={c.name} color={c.color} size={14} />
                                  <span className="co">{c.name}</span>
                                  <span className="fainter">·</span>
                                </>
                              )}
                              <span className="trunc">{r.destination.replace(/^https?:\/\/(www\.)?/, "")}</span>
                            </span>
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {r.code ? (
                            <button className="lnk-short" onClick={() => copy(short.url(r.code!))} title={`Copier ${short.url(r.code)}`}>
                              <span className="trunc">/{r.code}</span>
                              <Copy size={12} className="faint" />
                            </button>
                          ) : (
                            <span className="lnk-short none" title="Lien UTM seul, sans lien court">UTM seul</span>
                          )}
                        </td>
                        <td>
                          <div className="utm trunc" title={[r.u.utm_source, r.u.utm_medium, r.u.utm_campaign].filter(Boolean).join(" / ")}>
                            {[r.u.utm_source, r.u.utm_medium, r.u.utm_campaign].filter(Boolean).map((v, i) => (
                              <span key={i} className="mono">{v}</span>
                            ))}
                            {!r.u.utm_source && !r.u.utm_campaign && <span className="faint">Sans UTM</span>}
                          </div>
                        </td>
                        <td className="r">{r.code ? num(r.clicks) : <span className="faint">–</span>}</td>
                        {hasAttr && <td className="r">{r.attr ? num(r.attr.leads) : <span className="faint">–</span>}</td>}
                        {hasAttr && (
                          <td className="r">
                            {r.attr ? (
                              <>
                                {num(r.attr.sales)}
                                {r.attr.revenue > 0 && <div className="sub">{money(r.attr.revenue, currency)}</div>}
                              </>
                            ) : (
                              <span className="faint">–</span>
                            )}
                          </td>
                        )}
                        <td className="r faint">
                          <span className="lnk-by">
                            {m && <Avatar profile={m.profile} size={18} />}
                            {fmtDate(r.created_at.slice(0, 10))}
                          </span>
                        </td>
                        <td className="acts" onClick={(e) => e.stopPropagation()}>
                          <Menu
                            align="end"
                            items={items}
                            trigger={(open) => (
                              <button className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label={`Actions pour ${r.name || r.destination}`}>
                                <Ellipsis size={15} />
                              </button>
                            )}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {!sorted.length && (
                    <tr>
                      <td colSpan={hasAttr ? 8 : 6} className="faint" style={{ textAlign: "center", height: 80 }}>
                        Aucun lien ne correspond à ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {qr && <QrModal text={qr.code ? short.url(qr.code) : qr.final_url} name={qr.name || qr.code || "lien"} onClose={() => setQr(null)} />}
      {del && (
        <ConfirmModal
          title="Supprimer ce lien ?"
          text={
            del.code
              ? `Le lien court ${short.display(del.code)} cessera de fonctionner et ses ${num(del.clicks)} clics enregistrés seront effacés. Pour simplement l'arrêter, désactive-le plutôt.`
              : "Le lien et son historique seront effacés."
          }
          onConfirm={() => mutate(async (sb) => must(await sb.from("links").delete().eq("id", del.id)), { success: "Lien supprimé" }).then(() => undefined)}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  );
}
