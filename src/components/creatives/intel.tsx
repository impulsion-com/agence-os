"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookmarkPlus, CircleAlert, CircleCheck, Ellipsis, ExternalLink, Hash, KeyRound, Layers, Plus, Radar, RefreshCw, Search, ShieldCheck, Sparkles, Store, Trash2, Trophy, X,
} from "lucide-react";

import { CompanyPicker } from "@/components/pickers";
import { CompanyMark } from "@/components/reporting/common";
import { EmptyState } from "@/components/ui/misc";
import { ConfirmModal, Menu, Modal, type MenuItem } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { colorOf } from "@/lib/constants";
import { ago, fmtDate } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { AWARE, FORMAT, type Awareness, type ConceptFormat } from "@/lib/creatives/constants";
import {
  INTEL_COUNTRIES, adLibraryUrl, firstSentence, hookTypeName, isNew, parsePageInput, platformName, scoreAll, type CompetitorAd, type Score,
} from "@/lib/creatives/intel-core";
import { watchLabel, type IntelData, type Watch } from "@/lib/creatives/intel-types";
import { AiCallout, callIntel, pageColor, useAction } from "./intel-parts";

type Sort = "score" | "longevity" | "recent";
interface Filters {
  company: string[];
  page: string[];
  platform: string[];
  active: boolean;
  winners: boolean;
  fresh: boolean;
  group: string | null;
}
const NO_FILTERS: Filters = { company: [], page: [], platform: [], active: false, winners: false, fresh: false, group: null };
const STEP = 48;

export function Intel({ data, initialWeek }: { data: IntelData; initialWeek: boolean }) {
  const ws = useWorkspace();
  const [now] = useState(() => Date.now());
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>("score");
  const [mode, setMode] = useState<"all" | "week">(initialWeek ? "week" : "all");
  const [limit, setLimit] = useState(STEP);
  // Une carte par groupe de variantes (la mieux classée), sauf quand on explore un groupe
  const [collapse, setCollapse] = useState(true);
  const [linked, setLinked] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const router = useRouter();

  const watchOf = useMemo(() => new Map(data.watches.map((w) => [w.id, w])), [data.watches]);
  const scores = useMemo(() => scoreAll(data.ads, now), [data.ads, now]);
  const companyOf = (a: CompetitorAd) => watchOf.get(a.watch_id ?? "")?.company_id ?? null;

  const has = (list: string[], v: string | null | undefined) => !list.length || list.includes(v ?? "");
  const shown = useMemo(() => {
    const list = data.ads.filter((a) => {
      const s = scores.get(a.id)!;
      return (
        has(f.company, companyOf(a)) &&
        has(f.page, a.page_name) &&
        (!f.platform.length || a.platforms.some((p) => f.platform.includes(p))) &&
        (!f.active || a.is_active) &&
        (!f.winners || s.winner) &&
        (!(f.fresh || mode === "week") || isNew(a.first_seen, now)) &&
        (!f.group || s.group === f.group)
      );
    });
    const key = (a: CompetitorAd) => (sort === "score" ? scores.get(a.id)!.score : sort === "longevity" ? (scores.get(a.id)!.longevity ?? -1) : Date.parse(a.start_time ?? a.first_seen));
    const sorted = list.sort((a, b) => key(b) - key(a) || b.first_seen.localeCompare(a.first_seen));
    if (!collapse || f.group) return sorted;
    const seen = new Set<string>();
    return sorted.filter((a) => {
      const g = scores.get(a.id)!.group;
      return seen.has(g) ? false : (seen.add(g), true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.ads, f, sort, mode, scores, now, collapse]);

  const pages = [...new Set(data.ads.map((a) => a.page_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const companies = ws.companies.filter((c) => data.watches.some((w) => w.company_id === c.id));
  const platforms = [...new Set(data.ads.flatMap((a) => a.platforms))].map((p) => ({ id: p, name: platformName(p) }));
  const newCount = data.ads.filter((a) => isNew(a.first_seen, now)).length;
  const toTag = data.ads.filter((a) => !a.ai_tags).length;

  const filterMenu = (key: "company" | "page" | "platform", label: string, options: { id: string; name: string }[]) => {
    const sel = f[key];
    if (!options.length) return null;
    const toggle = (id: string) => setF((x) => ({ ...x, [key]: sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id] }));
    const items: MenuItem[] = [
      ...options.map((o) => ({ label: o.name, checked: sel.includes(o.id), onSelect: () => toggle(o.id) })),
      ...(sel.length ? [{ separator: true, label: "" }, { label: "Effacer ce filtre", onSelect: () => setF((x) => ({ ...x, [key]: [] })) }] : []),
    ];
    return (
      <Menu
        items={items}
        search={options.length > 7 ? "Filtrer…" : undefined}
        trigger={(open, isOpen) => (
          <button type="button" className={`btn btn-sm${sel.length ? " on" : ""}`} onClick={open} aria-expanded={isOpen}>
            {label}
            {sel.length > 0 && <span className="n">{sel.length}</span>}
          </button>
        )}
      />
    );
  };
  const toggleBtn = (key: "active" | "winners" | "fresh", label: string) => (
    <button type="button" className={`btn btn-sm${f[key] ? " on" : ""}`} aria-pressed={f[key]} onClick={() => setF((x) => ({ ...x, [key]: !x[key] }))}>
      {label}
    </button>
  );
  const active = f.company.length + f.page.length + f.platform.length > 0 || f.active || f.winners || f.fresh || !!f.group;

  const syncAll = () =>
    run("sync", () => callIntel<{ watches: number; fetched: number; created: number; errors: string[]; tagged: number }>({ action: "sync", workspace_id: ws.workspace.id }), (r) => {
      router.refresh();
      if (r.errors.length) throw new Error(r.errors[0]);
      return r.watches ? `${r.watches} surveillance${r.watches > 1 ? "s" : ""} synchronisée${r.watches > 1 ? "s" : ""} : ${r.created} nouvelle${r.created > 1 ? "s" : ""} pub${r.created > 1 ? "s" : ""}${r.tagged ? `, ${r.tagged} taguée${r.tagged > 1 ? "s" : ""}` : ""}` : "Aucune surveillance réelle à synchroniser (les données d'exemple ne se synchronisent pas).";
    });
  const tagAll = () =>
    run("tag", () => callIntel<{ ads: number; concepts: number; remaining: number; error: string | null }>({ action: "tag", workspace_id: ws.workspace.id, scope: "all" }), (r) => {
      router.refresh();
      if (r.error) throw new Error(r.error);
      return r.ads + r.concepts ? `${r.ads} pub${r.ads > 1 ? "s" : ""} et ${r.concepts} concept${r.concepts > 1 ? "s" : ""} tagués${r.remaining ? ` (${r.remaining} restants, relance pour continuer)` : ""}` : "Tout est déjà tagué.";
    });

  // Nouveautés de la semaine : regroupées par concurrent
  const byPage = useMemo(() => {
    if (mode !== "week") return [];
    const m = new Map<string, CompetitorAd[]>();
    for (const a of shown) m.set(a.page_name, [...(m.get(a.page_name) ?? []), a]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [shown, mode]);

  const card = (a: CompetitorAd) => (
    <AdCard
      key={a.id}
      ad={a}
      score={scores.get(a.id)!}
      watch={watchOf.get(a.watch_id ?? "") ?? null}
      now={now}
      conceptId={linked[a.id] ?? a.concept_id}
      onLinked={(id) => setLinked((l) => ({ ...l, [a.id]: id }))}
      onGroup={(g) => setF((x) => ({ ...x, group: g }))}
    />
  );

  return (
    <div className="crv-in">
      <SourceCard data={data} />

      <Watches data={data} onSyncAll={syncAll} syncing={busy === "sync"} />

      <section aria-labelledby="crv-in-feed-h" className="crv-in-feed">
        <div className="crv-in-feed-h">
          <h2 id="crv-in-feed-h">
            <Radar size={16} aria-hidden /> Pubs des concurrents
          </h2>
          <div className="seg" role="group" aria-label="Période">
            <button type="button" className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>Toutes</button>
            <button type="button" className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>
              Nouveautés de la semaine{newCount ? ` (${newCount})` : ""}
            </button>
          </div>
          {ws.canWrite && data.ai.enabled && data.ads.length > 0 && (
            <button type="button" className="btn btn-sm" disabled={!!busy} onClick={tagAll} title="Tague les pubs et les concepts qui ne le sont pas encore (angle, hook, niveau de conscience, format…)">
              <Sparkles size={13} /> {busy === "tag" ? "Tagging…" : `Taguer avec l'IA${toTag ? ` (${toTag})` : ""}`}
            </button>
          )}
        </div>

        {!data.ai.enabled && toTag > 0 && <AiCallout what={`${toTag} pub${toTag > 1 ? "s ne sont pas taguées" : " n'est pas taguée"} (angle, hook, niveau de conscience, format).`} />}

        {data.ads.length > 0 && (
          <div className="crv-bar" role="search">
            {filterMenu("company", "Client", companies.map((c) => ({ id: c.id, name: c.name })))}
            {filterMenu("page", "Concurrent", pages.map((p) => ({ id: p, name: p })))}
            {filterMenu("platform", "Plateforme", platforms)}
            {toggleBtn("active", "Actives")}
            {toggleBtn("winners", "Gagnantes probables")}
            {mode === "all" && toggleBtn("fresh", "Nouvelles")}
            <button type="button" className={`btn btn-sm${collapse ? " on" : ""}`} aria-pressed={collapse} onClick={() => setCollapse((c) => !c)} title="Une seule carte par concept décliné (la variante la mieux classée)">
              <Layers size={13} /> Regrouper les variantes
            </button>
            {f.group && (
              <button type="button" className="btn btn-sm on" onClick={() => setF((x) => ({ ...x, group: null }))}>
                <Layers size={13} /> Variantes d&apos;un concept <X size={12} />
              </button>
            )}
            {active && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF(NO_FILTERS)}>
                <X size={13} /> Réinitialiser
              </button>
            )}
            <label className="crv-in-sort">
              <span>Trier par</span>
              <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="score">Score</option>
                <option value="longevity">Longévité</option>
                <option value="recent">Plus récentes</option>
              </select>
            </label>
            <span className="crv-count">
              {shown.length} {collapse && !f.group ? `concept${shown.length > 1 ? "s" : ""}` : `pub${shown.length > 1 ? "s" : ""}`}
              {shown.length !== data.ads.length ? ` sur ${data.ads.length} pubs` : ""}
            </span>
          </div>
        )}

        {!data.ads.length ? (
          <div className="card">
            <EmptyState
              icon="eye"
              title="Aucune pub concurrente pour l'instant"
              text={data.watches.length ? "Lance une synchronisation : les pubs actives des concurrents surveillés arrivent ici, avec leur longévité, leurs variantes et un score." : "Ajoute une surveillance (une page concurrente ou un mot-clé) : ses pubs diffusées dans l'UE arrivent ici, avec leur longévité, leurs variantes et un score « probablement gagnante »."}
            />
          </div>
        ) : !shown.length ? (
          <div className="card">
            <EmptyState icon="search" title={mode === "week" ? "Rien de nouveau cette semaine" : "Aucune pub ne correspond"} text={mode === "week" ? "Aucune pub vue pour la première fois ces 7 derniers jours avec ces filtres." : "Retire un filtre pour élargir."} />
          </div>
        ) : mode === "week" ? (
          <div className="crv-in-week">
            {byPage.map(([page, list]) => (
              <section key={page} aria-label={page}>
                <h3>
                  <span className="av" style={{ ["--s" as string]: "20px", ["--c" as string]: colorOf(pageColor(page)), borderRadius: 5 }} aria-hidden>{page.slice(0, 1)}</span>
                  {page}
                  <span className="faint">
                    {list.length} nouvelle{list.length > 1 ? "s" : ""} pub{list.length > 1 ? "s" : ""}
                  </span>
                </h3>
                <div className="crv-in-grid">{list.map(card)}</div>
              </section>
            ))}
          </div>
        ) : (
          <>
            <div className="crv-in-grid">{shown.slice(0, limit).map(card)}</div>
            {shown.length > limit && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                <button type="button" className="btn" onClick={() => setLimit((l) => l + STEP)}>
                  Afficher plus ({shown.length - limit})
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------
// Carte d'une pub
// ---------------------------------------------------------------------
function AdCard({
  ad, score, watch, now, conceptId, onLinked, onGroup,
}: {
  ad: CompetitorAd;
  score: Score & { group: string };
  watch: Watch | null;
  now: number;
  conceptId: string | null;
  onLinked: (id: string) => void;
  onGroup: (g: string) => void;
}) {
  const ws = useWorkspace();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const body = ad.bodies[0] ?? "";
  const hook = firstSentence(ad.ai_tags?.hook || body) || ad.titles[0] || ad.page_name;
  const fresh = isNew(ad.first_seen, now);
  const t = ad.ai_tags;
  const co = ws.company(watch?.company_id);
  const level = score.winner ? "win" : score.score >= 45 ? "mid" : "low";

  const addToLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const url = ad.is_demo ? "" : adLibraryUrl(ad.archive_id);
      const since = score.longevity !== null ? `, ${ad.is_active ? "en ligne depuis" : "diffusée"} ${score.longevity} jours` : "";
      const row = must(
        await sb
          .from("creative_concepts")
          .insert({
            workspace_id: ws.workspace.id,
            company_id: watch?.company_id ?? null,
            title: (t?.angle ? `${t.angle} : ` : "").concat(ad.titles[0] || firstSentence(body) || ad.page_name).slice(0, 120),
            status: "idea",
            angle: t?.angle ?? "",
            hook: hook.slice(0, 300),
            persona: t?.persona ?? "",
            format: (t?.format as ConceptFormat) ?? "static",
            awareness: (t?.awareness as Awareness) ?? null,
            platforms: ["meta"],
            tags: ["Inspiration concurrente"],
            brief: {
              context: `Inspiration : pub de ${ad.page_name} dans la bibliothèque publicitaire Meta${since}${score.variants > 1 ? `, ${score.variants} variantes` : ""} (score ${score.score}/100).`,
              script: [...ad.bodies, ...ad.titles.map((x) => `Titre : ${x}`), ...ad.descriptions.map((x) => `Description : ${x}`)].join("\n\n"),
              ...(t?.cta ? { cta: t.cta } : {}),
              ...(url ? { references: url } : {}),
            } as never,
            source: { type: "competitor", ad_id: ad.id, archive_id: ad.archive_id, page_name: ad.page_name, url } as never,
            owner_id: ws.me.id,
            position: Date.now() / 1000,
          })
          .select("id")
          .single(),
      );
      await sb.from("competitor_ads").update({ concept_id: row!.id }).eq("id", ad.id);
      onLinked(row!.id);
      toast("Concept créé (statut Idée)");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`crv-in-card${score.winner ? " winner" : ""}`}>
      <div className="crv-in-vis" style={{ ["--c" as string]: colorOf(pageColor(ad.page_id || ad.page_name)) }}>
        <div className="top">
          <span className="pg">
            <span className="ini" aria-hidden>{ad.page_name.slice(0, 1)}</span>
            <span className="trunc">{ad.page_name}</span>
          </span>
          <span className={`crv-in-score ${level}`} title={`Score « probablement gagnante » : ${score.score}/100`}>
            {score.score}
          </span>
        </div>
        <p className="hook">{hook}</p>
        <div className="flags">
          {fresh && <span className="flag new">Nouvelle</span>}
          {score.winner && (
            <span className="flag win">
              <Trophy size={11} aria-hidden /> Gagnante probable
            </span>
          )}
          {!ad.is_active && <span className="flag off">Arrêtée</span>}
        </div>
      </div>
      <div className="body">
        <div className="meta">
          <span className={`dot${ad.is_active ? " on" : ""}`} aria-hidden />
          {ad.start_time ? (
            <span>
              {ad.is_active ? "Depuis le" : "Du"} {fmtDate(ad.start_time)}
              {!ad.is_active && ad.stop_time ? ` au ${fmtDate(ad.stop_time)}` : ""}
            </span>
          ) : (
            <span>Date de lancement inconnue</span>
          )}
          {score.longevity !== null && <b>{score.longevity} j</b>}
        </div>
        {body && (
          <p className={`txt${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
            {ad.bodies.join("\n\n")}
          </p>
        )}
        {ad.titles[0] && <p className="ttl">{ad.titles[0]}</p>}
        <div className="chips">
          {score.variants > 1 && (
            <button type="button" className="chip-b" onClick={() => onGroup(score.group)} title="Voir les variantes de ce concept">
              <Layers size={11} aria-hidden /> {score.variants} variantes
            </button>
          )}
          {ad.platforms.map((p) => (
            <span key={p} className="chip-p">{platformName(p)}</span>
          ))}
        </div>
        {t && (
          <div className="tags" aria-label="Tags IA">
            {t.angle && <span title="Angle">{t.angle}</span>}
            {t.hook_type && <span title="Type de hook">Hook {hookTypeName(t.hook_type).toLowerCase()}</span>}
            {t.awareness && AWARE[t.awareness] && <span title={AWARE[t.awareness].name}>{AWARE[t.awareness].short}</span>}
            {t.format && FORMAT[t.format] && <span title="Format probable">{FORMAT[t.format].name}</span>}
          </div>
        )}
        <details className="why">
          <summary>Pourquoi ce score ?</summary>
          <ul>
            {score.reasons.map((r) => (
              <li key={r.label}>
                <span>{r.label}</span>
                <b>+{r.points}</b>
              </li>
            ))}
            {!score.reasons.length && <li><span>Trop récente pour juger</span></li>}
          </ul>
          <p>Gagnante probable : toujours active, en ligne depuis 30 jours ou plus et score d&apos;au moins 60. Meta ne publie ni la dépense ni les résultats des pubs commerciales.</p>
        </details>
        <div className="acts">
          {ad.is_demo ? (
            <span className="btn btn-sm" aria-disabled title="Pub fictive des données d'exemple : pas d'aperçu Meta">
              <ExternalLink size={13} /> Aperçu indisponible
            </span>
          ) : (
            <a className="btn btn-sm" href={adLibraryUrl(ad.archive_id)} target="_blank" rel="noopener noreferrer" title="Ouvre la pub dans la bibliothèque publicitaire Meta (nouvel onglet)">
              <ExternalLink size={13} /> Voir l&apos;aperçu
            </a>
          )}
          {conceptId ? (
            <Link className="btn btn-sm" href={`${ws.base}/creatives/${conceptId}`}>
              <CircleCheck size={13} /> Dans la bibliothèque
            </Link>
          ) : ws.canWrite ? (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={addToLibrary}>
              <BookmarkPlus size={13} /> Ajouter à la bibliothèque
            </button>
          ) : null}
        </div>
        {co && (
          <div className="for">
            <CompanyMark name={co.name} color={co.color} size={14} /> Veille pour {co.name}
          </div>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------
// Source des données (jeton)
// ---------------------------------------------------------------------
function SourceCard({ data }: { data: IntelData }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const s = data.status;
  const src = s.manual
    ? {
        tone: s.manual.ok === false ? "bad" : "ok",
        title: `Jeton collé${s.manual.label ? ` (${s.manual.label})` : ""}`,
        text: [
          s.manual.expires_at ? `expire le ${fmtDate(s.manual.expires_at, true)}` : "expiration inconnue",
          s.manual.checked_at ? `testé ${ago(s.manual.checked_at)}` : null,
          s.manual.ok === false ? s.manual.error : s.manual.ok ? "accès à l'API Ad Library confirmé" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      }
    : s.connection
      ? {
          tone: "ok",
          title: `Connexion Meta du reporting${s.connection.label ? ` (${s.connection.label})` : ""}`,
          text: `${s.connection.expires_at ? `expire le ${fmtDate(s.connection.expires_at, true)} · ` : ""}fonctionne si ce compte Facebook a confirmé son identité (facebook.com/ID)`,
        }
      : { tone: "warn", title: "Aucune source de données", text: "La veille a besoin d'un jeton Meta : colle-en un, ou connecte Meta dans le reporting." };
  return (
    <div className={`crv-in-callout ${src.tone}`}>
      <span className="ic">{src.tone === "ok" ? <ShieldCheck size={16} aria-hidden /> : <KeyRound size={16} aria-hidden />}</span>
      <div style={{ minWidth: 0 }}>
        <b>{src.title}</b>
        <p>{src.text}</p>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        {ws.isAdmin ? "Configurer" : "Prérequis et limites"}
      </button>
      {open && <TokenModal data={data} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TokenModal({ data, onClose }: { data: IntelData; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const { busy, run } = useAction();
  type R = { ok: boolean; label: string | null; expires_at: string | null; error: string | null };
  const describe = (r: R) =>
    r.ok
      ? { ok: true, text: `Jeton valide pour l'API Ad Library${r.label ? ` (${r.label})` : ""}${r.expires_at ? `, expire le ${fmtDate(r.expires_at, true)}` : ""}.` }
      : { ok: false, text: r.error ?? "Jeton refusé." };
  const test = (withToken: boolean) =>
    run("test", () => callIntel<R>({ action: "token_test", workspace_id: ws.workspace.id, ...(withToken ? { token: token.trim() } : {}) }), (r) => {
      setRes(describe(r));
      if (!withToken) router.refresh();
      return null;
    });
  const save = () =>
    run("save", () => callIntel<R>({ action: "token_save", workspace_id: ws.workspace.id, token: token.trim() }), (r) => {
      setRes(describe(r));
      setToken("");
      router.refresh();
      return r.ok ? "Jeton enregistré" : "Jeton enregistré, mais l'accès à l'API Ad Library est refusé";
    });
  const remove = () =>
    run("delete", () => callIntel({ action: "token_delete", workspace_id: ws.workspace.id }), () => {
      router.refresh();
      setRes(null);
      return "Jeton supprimé";
    });
  const valid = token.trim().length >= 20;
  return (
    <Modal title="Source des données de la veille" onClose={onClose} size="lg" footer={<button type="button" className="btn" onClick={onClose}>Fermer</button>}>
      <div className="crv-in-help">
        <p>
          La veille lit la <b>bibliothèque publicitaire Meta</b> par son API officielle (Ad Library), en lecture seule. Elle a besoin du jeton d&apos;un compte
          Facebook qui remplit deux conditions :
        </p>
        <ol>
          <li>
            <b>Identité confirmée</b> sur <a href="https://www.facebook.com/ID" target="_blank" rel="noopener noreferrer">facebook.com/ID</a> (pièce d&apos;identité, de quelques heures à 2 jours).
          </li>
          <li>
            <b>Une app développeur</b> sur <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">developers.facebook.com</a>, avec les conditions de l&apos;API acceptées sur{" "}
            <a href="https://www.facebook.com/ads/library/api" target="_blank" rel="noopener noreferrer">facebook.com/ads/library/api</a>.
          </li>
        </ol>
        <p>
          Si Meta est déjà connecté dans le reporting, la veille réutilise ce jeton. Sinon, génère un jeton utilisateur dans l&apos;
          <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer">explorateur de l&apos;API Graph</a>, prolonge-le à 60 jours avec
          l&apos;<a href="https://developers.facebook.com/tools/debug/accesstoken" target="_blank" rel="noopener noreferrer">outil de débogage des jetons</a>, puis colle-le ici. Un jeton collé est prioritaire.
        </p>
        <h4>Ce que l&apos;API ne donne pas</h4>
        <ul>
          <li>Les pubs commerciales ne sont consultables que pour l&apos;<b>Union européenne et le Royaume-Uni</b> (règlement DSA).</li>
          <li>
            <b>Ni dépense, ni impressions, ni engagement</b> : le score « probablement gagnante » se fonde sur la longévité, les variantes, le fait d&apos;être
            toujours active et la portée UE quand Meta la publie.
          </li>
          <li>Aucun média téléchargeable : l&apos;aperçu s&apos;ouvre dans la bibliothèque Meta. Rien n&apos;est copié ni stocké à part les textes.</li>
          <li>Environ 200 appels par heure : la synchro est quotidienne et incrémentale (5 pages de 100 pubs au plus par surveillance).</li>
        </ul>
      </div>
      {ws.isAdmin ? (
        <div className="crv-in-token">
          <div className="field">
            <label htmlFor="crv-in-tok">Jeton d&apos;accès utilisateur</label>
            <input
              id="crv-in-tok"
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={data.status.manual ? "Un jeton est enregistré : colle un nouveau jeton pour le remplacer" : "EAAG…"}
            />
            <span className="hint">Stocké côté serveur, jamais renvoyé au navigateur.</span>
          </div>
          <div className="btns">
            <button type="button" className="btn" disabled={!valid || !!busy} onClick={() => test(true)}>
              Tester
            </button>
            <button type="button" className="btn btn-primary" disabled={!valid || !!busy} onClick={save}>
              Enregistrer
            </button>
            {(data.status.manual || data.status.connection) && (
              <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => test(false)}>
                <RefreshCw size={13} /> Tester la source actuelle
              </button>
            )}
            {data.status.manual && (
              <button type="button" className="btn btn-ghost" style={{ color: "var(--red)" }} disabled={!!busy} onClick={remove}>
                <Trash2 size={13} /> Supprimer le jeton
              </button>
            )}
          </div>
          {busy && <p className="faint" style={{ fontSize: 12 }}>Vérification auprès de Meta…</p>}
          {res && (
            <div className={`crv-in-callout ${res.ok ? "ok" : "bad"}`} role="status">
              <span className="ic">{res.ok ? <CircleCheck size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}</span>
              <div>
                <p style={{ margin: 0 }}>{res.text}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>Seuls les admins de l&apos;espace peuvent configurer le jeton.</p>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Surveillances
// ---------------------------------------------------------------------
function Watches({ data, onSyncAll, syncing }: { data: IntelData; onSyncAll: () => void; syncing: boolean }) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Watch | null>(null);
  const { busy, run } = useAction();
  const [now] = useState(() => Date.now());
  const stats = useMemo(() => {
    const m = new Map<string, { active: number; fresh: number }>();
    for (const a of data.ads) {
      const k = a.watch_id ?? "";
      const s = m.get(k) ?? { active: 0, fresh: 0 };
      if (a.is_active) s.active++;
      if (isNew(a.first_seen, now)) s.fresh++;
      m.set(k, s);
    }
    return m;
  }, [data.ads, now]);

  const syncOne = (w: Watch) =>
    run(w.id, () => callIntel<{ created: number; fetched: number; errors: string[] }>({ action: "sync", workspace_id: ws.workspace.id, watch_id: w.id }), (r) => {
      router.refresh();
      if (r.errors.length) throw new Error(r.errors[0]);
      return `${watchLabel(w)} : ${r.fetched} pub${r.fetched > 1 ? "s" : ""} lue${r.fetched > 1 ? "s" : ""}, ${r.created} nouvelle${r.created > 1 ? "s" : ""}`;
    });

  return (
    <section className="card crv-in-watches" aria-labelledby="crv-in-w-h">
      <div className="card-h">
        <h2 id="crv-in-w-h">Surveillances</h2>
        <div className="acts">
          {ws.canWrite && data.watches.some((w) => !w.is_demo && w.enabled) && (
            <button type="button" className="btn btn-sm" disabled={syncing} onClick={onSyncAll}>
              <RefreshCw size={13} className={syncing ? "spin" : undefined} /> {syncing ? "Synchronisation…" : "Tout synchroniser"}
            </button>
          )}
          {ws.canWrite && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
              <Plus size={13} /> Ajouter une surveillance
            </button>
          )}
        </div>
      </div>
      {data.watches.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl crv-in-wtbl">
            <thead>
              <tr>
                <th>Concurrent ou mot-clé</th>
                <th>Client</th>
                <th>Pays</th>
                <th className="r">Pubs actives</th>
                <th className="r">Nouvelles 7 j</th>
                <th>Dernière synchro</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.watches.map((w) => {
                const co = ws.company(w.company_id);
                const s = stats.get(w.id) ?? { active: 0, fresh: 0 };
                return (
                  <tr key={w.id} className={w.enabled ? undefined : "off"}>
                    <td>
                      <span className="tg">
                        {w.kind === "page" ? <Store size={14} aria-hidden /> : <Hash size={14} aria-hidden />}
                        <span className="trunc">{watchLabel(w)}</span>
                        {w.is_demo && <span className="demo">Exemple</span>}
                        {!w.enabled && <span className="demo">En pause</span>}
                      </span>
                      <span className="sub">{w.kind === "page" ? `Page ${w.page_id}` : "Mot-clé"} · {w.active_only ? "actives uniquement" : "toutes les pubs"}</span>
                    </td>
                    <td>{co ? <span className="co"><CompanyMark name={co.name} color={co.color} size={16} /> <span className="trunc">{co.name}</span></span> : <span className="faint">–</span>}</td>
                    <td className="muted">{w.countries.join(", ")}</td>
                    <td className="r">{s.active}</td>
                    <td className="r">{s.fresh ? <b className="fresh">{s.fresh}</b> : <span className="faint">0</span>}</td>
                    <td>
                      {w.last_synced_at ? <span className="muted">{ago(w.last_synced_at)}</span> : <span className="faint">Jamais</span>}
                      {w.last_error && (
                        <span className="err" title={w.last_error}>
                          <CircleAlert size={12} aria-hidden /> {w.last_error}
                        </span>
                      )}
                    </td>
                    <td className="r">
                      {ws.canWrite && (
                        <span className="row-acts">
                          {!w.is_demo && w.enabled && (
                            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Synchroniser ${watchLabel(w)}`} title="Synchroniser" disabled={!!busy || syncing} onClick={() => syncOne(w)}>
                              <RefreshCw size={14} className={busy === w.id ? "spin" : undefined} />
                            </button>
                          )}
                          <Menu
                            align="end"
                            items={[
                              {
                                label: w.enabled ? "Mettre en pause" : "Réactiver",
                                onSelect: () => void mutate(async (sb) => must(await sb.from("competitor_watches").update({ enabled: !w.enabled }).eq("id", w.id).select("id")), { success: w.enabled ? "Surveillance en pause" : "Surveillance réactivée" }),
                              },
                              { label: "Supprimer", danger: true, icon: <Trash2 size={14} />, onSelect: () => setDeleting(w) },
                            ]}
                            trigger={(open) => (
                              <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Plus d'actions" onClick={open}>
                                <Ellipsis size={14} />
                              </button>
                            )}
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="crv-note">Aucune surveillance. Ajoute la page Facebook d&apos;un concurrent (par son nom, son ID ou son URL) ou un mot-clé, pour chaque client.</p>
      )}
      {creating && <WatchModal onClose={() => setCreating(false)} />}
      {deleting && (
        <ConfirmModal
          title="Supprimer la surveillance"
          text={<>La surveillance <b>{watchLabel(deleting)}</b> et ses pubs enregistrées seront supprimées. Les concepts créés à partir de ces pubs restent dans la bibliothèque.</>}
          onClose={() => setDeleting(null)}
          onConfirm={() => void mutate(async (sb) => must(await sb.from("competitor_watches").delete().eq("id", deleting.id).select("id")), { success: "Surveillance supprimée" })}
        />
      )}
    </section>
  );
}

function WatchModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [company, setCompany] = useState<string | null>(null);
  const [kind, setKind] = useState<"page" | "keyword">("page");
  const [input, setInput] = useState("");
  const [page, setPage] = useState<{ page_id: string; page_name: string } | null>(null);
  const [results, setResults] = useState<{ page_id: string; page_name: string; ads: number }[] | null>(null);
  const [countries, setCountries] = useState<string[]>(["FR"]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [saving, setSaving] = useState(false);
  const { busy, run } = useAction();

  const search = () => {
    const p = parsePageInput(input);
    setPage(null);
    setResults(null);
    if (!p) return;
    if ("pageId" in p) {
      setPage({ page_id: p.pageId, page_name: "" });
      return;
    }
    void run("search", () => callIntel<{ pages: { page_id: string; page_name: string; ads: number }[] }>({ action: "search_pages", workspace_id: ws.workspace.id, q: p.name, countries }), (r) => {
      setResults(r.pages);
      return null;
    });
  };

  const ready = kind === "page" ? !!page : input.trim().length >= 2;
  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      const row = must(
        await sb
          .from("competitor_watches")
          .insert({
            workspace_id: ws.workspace.id,
            company_id: company,
            kind,
            page_id: kind === "page" ? page!.page_id : null,
            page_name: kind === "page" ? page!.page_name : "",
            search_terms: kind === "keyword" ? input.trim().slice(0, 100) : "",
            countries: countries.length ? countries : ["FR"],
            active_only: activeOnly,
          })
          .select("id")
          .single(),
      );
      onClose();
      toast("Surveillance ajoutée : première synchronisation…");
      try {
        const r = await callIntel<{ fetched: number; errors: string[] }>({ action: "sync", workspace_id: ws.workspace.id, watch_id: row!.id });
        if (r.errors.length) toast(r.errors[0], { error: true });
        else toast(`${r.fetched} pub${r.fetched > 1 ? "s" : ""} récupérée${r.fetched > 1 ? "s" : ""}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), { error: true });
      }
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Nouvelle surveillance"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={!ready || saving} onClick={submit}>
            Ajouter et synchroniser
          </button>
        </>
      }
    >
      <div className="crv-in-form">
        <div className="field">
          <span className="label">Client</span>
          <CompanyPicker
            value={company}
            onChange={setCompany}
            trigger={(open) => (
              <button type="button" className="btn" style={{ justifyContent: "flex-start" }} onClick={open}>
                <span className="trunc">{ws.company(company)?.name ?? "Choisir un client"}</span>
              </button>
            )}
          />
        </div>
        <div className="field">
          <span className="label">Surveiller</span>
          <div className="seg" role="group" aria-label="Type de surveillance">
            <button type="button" className={kind === "page" ? "on" : ""} onClick={() => setKind("page")}>
              <Store size={13} /> Une page concurrente
            </button>
            <button type="button" className={kind === "keyword" ? "on" : ""} onClick={() => setKind("keyword")}>
              <Hash size={13} /> Un mot-clé
            </button>
          </div>
        </div>
        {kind === "page" ? (
          <div className="field">
            <label htmlFor="crv-in-page">Page Facebook</label>
            <div className="crv-in-searchrow">
              <input
                id="crv-in-page"
                className="input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setPage(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
                placeholder="Nom, ID ou URL de la page (ou lien de la bibliothèque publicitaire)"
              />
              <button type="button" className="btn" disabled={input.trim().length < 2 || !!busy} onClick={search}>
                <Search size={13} /> {busy ? "Recherche…" : "Chercher"}
              </button>
            </div>
            <span className="hint">Un nom lance une recherche dans les pubs diffusées en UE ; un ID ou une URL avec l&apos;ID est pris tel quel.</span>
            {page && (
              <div className="crv-in-picked">
                <CircleCheck size={14} aria-hidden /> {page.page_name || "Page"} <span className="faint">ID {page.page_id}</span>
              </div>
            )}
            {results && !page && (
              <ul className="crv-in-results" aria-label="Pages trouvées">
                {results.map((r) => (
                  <li key={r.page_id}>
                    <button type="button" onClick={() => setPage(r)}>
                      <span className="trunc">{r.page_name || `Page ${r.page_id}`}</span>
                      <span className="faint">{r.ads} pub{r.ads > 1 ? "s" : ""} trouvée{r.ads > 1 ? "s" : ""} · ID {r.page_id}</span>
                    </button>
                  </li>
                ))}
                {!results.length && <li className="faint" style={{ padding: 8, fontSize: 13 }}>Aucune page trouvée. Essaie un autre nom ou colle l&apos;URL de la page.</li>}
              </ul>
            )}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="crv-in-kw">Mot-clé</label>
            <input id="crv-in-kw" className="input" maxLength={100} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ex. sérum vitamine C" />
            <span className="hint">Recherche dans les textes des pubs, dans la langue des pubs (Meta ne traduit pas).</span>
          </div>
        )}
        <div className="field">
          <span className="label">Pays de diffusion</span>
          <div className="crv-plats">
            {INTEL_COUNTRIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={countries.includes(c.id) ? "on" : ""}
                aria-pressed={countries.includes(c.id)}
                onClick={() => setCountries((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id].slice(0, 10)))}
                title={c.name}
              >
                {c.id}
              </button>
            ))}
          </div>
          <span className="hint">Union européenne et Royaume-Uni seulement : ailleurs, Meta ne publie pas les pubs commerciales.</span>
        </div>
        <div className="field">
          <span className="label">Pubs à suivre</span>
          <div className="seg" role="group" aria-label="Pubs à suivre">
            <button type="button" className={activeOnly ? "on" : ""} onClick={() => setActiveOnly(true)}>Actives uniquement</button>
            <button type="button" className={!activeOnly ? "on" : ""} onClick={() => setActiveOnly(false)}>Toutes (90 derniers jours)</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
