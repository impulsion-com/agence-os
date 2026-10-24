"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Minus, Settings2 } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { MOVE_LABEL, SCORE_HELP, SCORE_LABEL, band, groupByAsset, retention, type BoardRow, type ScoreKey, type Scores } from "@/lib/creatives/board";
import { CK_HELP, CK_LABEL, CZERO, ck, cmerge, fmtCk, fmtPct, vsRef, type CKpi, type CTotals } from "@/lib/creatives/metrics";
import { namingCoverage, namingFields, parseAdName, type NamingConfig, type NamingField } from "@/lib/creatives/naming";

export interface BoardAd {
  key: string;
  adId: string;
  /** Nom lisible (sans les propriétés de la nomenclature) */
  name: string;
  /** Nom complet de la plateforme, lu par la nomenclature */
  raw: string;
  campaign: string;
  thumb: string | null;
  conceptId: string | null;
  assetKey: string | null;
  t: CTotals;
  /** Ventes suivies par le tracking (null si aucune) */
  real: { sales: number; revenue: number } | null;
}

const SCORE_KEYS: ScoreKey[] = ["hook", "watch", "click", "convert"];

/** Quatre pastilles 1 à 100 façon Motion : accroche, rétention, clic, conversion. */
export function ScoreChips({ scores }: { scores: Scores | undefined }) {
  if (!scores || SCORE_KEYS.every((k) => scores[k] === null)) return <span className="fainter">–</span>;
  return (
    <span className="crv-scores">
      {SCORE_KEYS.map((k) => {
        const v = scores[k];
        return (
          <span key={k} className={`crv-score ${v === null ? "none" : band(v)}`} title={`${SCORE_LABEL[k]} : ${v ?? "non calculable"}. ${SCORE_HELP[k]}`}>
            <b>{SCORE_LABEL[k][0]}</b>
            {v ?? "–"}
          </span>
        );
      })}
    </span>
  );
}

/** Courbe de rétention en 5 barres : 3 s, 25 %, 50 %, 75 %, fin de la vidéo. */
export function RetentionBars({ t }: { t: CTotals }) {
  const r = retention(t);
  if (!r) return <span className="fainter">–</span>;
  return (
    <span className="crv-ret" role="img" aria-label={`Rétention : ${r.map((p) => `${p.label} ${Math.round(p.pct)} %`).join(", ")}`}>
      {r.map((p) => (
        <i key={p.label} style={{ ["--h" as string]: `${Math.max(4, p.pct)}%` }} title={`${p.label} : ${Math.round(p.pct)} % des personnes arrêtées par la vidéo`} />
      ))}
    </span>
  );
}

function AdName({ ad, href }: { ad: BoardAd; href: string | null }) {
  return (
    <span className="name">
      {ad.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.thumb} alt="" width={34} height={34} style={{ borderRadius: 6, objectFit: "cover" }} />
      ) : (
        <span className="crv-noimg" aria-hidden />
      )}
      <span style={{ minWidth: 0 }}>
        {href ? (
          <Link href={href} className="t trunc" style={{ display: "block" }}>
            {ad.name}
          </Link>
        ) : (
          <span className="t trunc" style={{ display: "block" }}>
            {ad.name}
          </span>
        )}
        <span className="s trunc" style={{ display: "block" }}>
          {ad.campaign}
        </span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------
// Classement de la semaine
// ---------------------------------------------------------------------
export function WeeklyBoard({ rows, ads, scores, currency, end }: { rows: BoardRow[]; ads: Map<string, BoardAd>; scores: Map<string, Scores>; currency: string; end: string }) {
  const ws = useWorkspace();
  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.move]: (m[r.move] ?? 0) + 1 }), {});
  return (
    <section className="card crv-sec" aria-labelledby="crv-week-h">
      <div className="card-h">
        <h2 id="crv-week-h">Classement de la semaine</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          Top 10 par dépense sur les 7 jours finis le {new Date(end + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}, comparé à la semaine d&apos;avant
        </span>
      </div>
      {rows.length ? (
        <>
          <div className="crv-moves">
            {(["new", "scaling", "declining", "paused"] as const).map((m) => (
              <span key={m} className={`crv-move ${m}`}>
                {MOVE_LABEL[m]} <b>{counts[m] ?? 0}</b>
              </span>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl crv-tbl" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th className="crv-rank">#</th>
                  <th>Annonce</th>
                  <th className="r">Dépense 7 j</th>
                  <th className="r">vs semaine d&apos;avant</th>
                  <th>Mouvement</th>
                  <th className="r" title="Semaines passées dans le top 10 sur les 8 dernières">Semaines top 10</th>
                  <th title="Scores 1 à 100 sur la période choisie : Accroche, Rétention, Clic, Ventes">Scores</th>
                  <th title="Part des personnes arrêtées par la vidéo encore là à 25, 50, 75 % et à la fin">Rétention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ad = ads.get(r.key);
                  if (!ad) return null;
                  const d = r.prevSpend > 0 ? ((r.spend - r.prevSpend) / r.prevSpend) * 100 : null;
                  const up = r.prevRank !== null && r.rank !== null ? r.prevRank - r.rank : null;
                  return (
                    <tr key={r.key} style={r.move === "paused" ? { opacity: 0.6 } : undefined}>
                      <td className="crv-rank">
                        {r.rank ?? "–"}
                        {up !== null && up !== 0 && (
                          <span className={`crv-rk ${up > 0 ? "up" : "down"}`} title={`${Math.abs(up)} place${Math.abs(up) > 1 ? "s" : ""} ${up > 0 ? "gagnée" : "perdue"}${Math.abs(up) > 1 ? "s" : ""}`}>
                            {up > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                            {Math.abs(up)}
                          </span>
                        )}
                      </td>
                      <td>
                        <AdName ad={ad} href={ad.conceptId ? `${ws.base}/creatives/${ad.conceptId}` : null} />
                      </td>
                      <td className="r">{fmtCk("spend", r.spend, currency)}</td>
                      <td className="r">{d === null ? <span className="fainter">–</span> : <span className={d >= 30 ? "crv-idx good" : d <= -30 ? "crv-idx bad" : "crv-idx neutral"}>{fmtPct(d)}</span>}</td>
                      <td>
                        <span className={`crv-move ${r.move}`}>
                          {r.move === "scaling" ? <ArrowUp size={11} /> : r.move === "declining" ? <ArrowDown size={11} /> : r.move === "steady" ? <Minus size={11} /> : null}
                          {MOVE_LABEL[r.move]}
                        </span>
                      </td>
                      <td className="r">{r.weeksTop} / 8</td>
                      <td>
                        <ScoreChips scores={scores.get(r.key)} />
                      </td>
                      <td>
                        <RetentionBars t={ad.t} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="crv-note">Aucune dépense sur les 14 derniers jours pour ce client.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Comparer : nomenclature des noms d'annonces ou même créa
// ---------------------------------------------------------------------
const CMP_COLS: CKpi[] = ["roas", "cpa", "ctr", "hook", "hold"];
const ASSET = "__asset";

export function Compare({ ads, naming, baseline, min, currency }: { ads: BoardAd[]; naming: NamingConfig; baseline: CTotals; min: number; currency: string }) {
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const names = useMemo(() => ads.map((a) => a.raw), [ads]);
  const fields = useMemo(() => namingFields(names, naming), [names, naming]);
  const coverage = namingCoverage(names, naming);
  const [field, setField] = useState<string | null>(null);
  const current = field ?? fields[0]?.label ?? ASSET;

  const groups = useMemo(() => {
    if (current === ASSET) {
      const byAd = new Map(ads.map((a) => [a.key, a]));
      return groupByAsset(
        new Map(ads.map((a) => [a.key, a.t])),
        (k) => byAd.get(k)?.assetKey ?? null,
        cmerge,
      )
        .map((g) => {
          const first = byAd.get(g.ads[0])!;
          const label = g.ads.length > 1 ? `${first.name} (+${g.ads.length - 1} copie${g.ads.length > 2 ? "s" : ""})` : first.name;
          return { key: g.asset, label, n: g.ads.length, t: g.t, thumb: first.thumb, real: sumReal(g.ads.map((k) => byAd.get(k)!)) };
        })
        .sort((a, b) => b.n - a.n || b.t.spend - a.t.spend);
    }
    const m = new Map<string, { key: string; label: string; n: number; t: CTotals; thumb: string | null; ads: BoardAd[] }>();
    for (const a of ads) {
      const v = parseAdName(a.raw, naming)[current] ?? "";
      const g = m.get(v) ?? { key: v, label: v || "Non renseigné", n: 0, t: CZERO, thumb: null, ads: [] };
      g.n++;
      g.t = cmerge(g.t, a.t);
      g.ads.push(a);
      m.set(v, g);
    }
    return [...m.values()].map((g) => ({ ...g, real: sumReal(g.ads) })).sort((a, b) => b.t.spend - a.t.spend);
  }, [ads, naming, current]);

  const max = Math.max(1, ...groups.map((g) => g.t.spend));
  const shared = current === ASSET ? groups.filter((g) => g.n > 1).length : 0;

  return (
    <section className="card crv-sec" aria-labelledby="crv-cmp-h">
      <div className="card-h">
        <h2 id="crv-cmp-h">Comparer</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg" role="group" aria-label="Comparer par">
            {fields.slice(0, 6).map((f) => (
              <button key={f.label} type="button" className={current === f.label ? "on" : ""} onClick={() => setField(f.label)} title={`${f.count} annonce${f.count > 1 ? "s" : ""} portent ce champ`}>
                {f.label}
              </button>
            ))}
            <button type="button" className={current === ASSET ? "on" : ""} onClick={() => setField(ASSET)} title="Regroupe les annonces qui diffusent la même vidéo ou la même image">
              Même créa
            </button>
          </div>
          {ws.isAdmin && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
              <Settings2 size={13} /> Nomenclature
            </button>
          )}
        </div>
      </div>
      {current !== ASSET && (
        <p className="crv-note" style={{ marginTop: 0 }}>
          Propriétés lues dans le nom des annonces ({Math.round(coverage * 100)} % des annonces reconnues).
          {coverage < 0.5 && " Nomme tes annonces avec des préfixes (« F:UGC | A:Routine | H:Problème ») ou règle la lecture par position."}
        </p>
      )}
      {current === ASSET && (
        <p className="crv-note" style={{ marginTop: 0 }}>
          {shared ? `${shared} créa${shared > 1 ? "s" : ""} diffusée${shared > 1 ? "s" : ""} dans plusieurs annonces : on la juge sur l'ensemble de ses copies.` : "Chaque créa n'est diffusée que dans une annonce sur la période."}
        </p>
      )}
      {groups.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="crv-dim" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>{current === ASSET ? "Créa" : current}</th>
                <th className="r">Annonces</th>
                <th className="r">Dépense</th>
                {CMP_COLS.map((k) => (
                  <th key={k} className="r" title={CK_HELP[k]}>
                    {CK_LABEL[k]}
                  </th>
                ))}
                <th className="r" title="Chiffre d'affaires mesuré par ton tracking / dépense">ROAS réel</th>
              </tr>
            </thead>
            <tbody>
              {groups.slice(0, 12).map((g) => {
                const low = g.t.spend < min;
                return (
                  <tr key={g.key || "_"} style={low ? { opacity: 0.55 } : undefined} title={low ? "Sous le seuil de dépense : à ne pas interpréter" : undefined}>
                    <td className="k">
                      <span className="lab" title={g.label}>{g.label}</span>
                      <span className="bar" aria-hidden>
                        <i style={{ ["--p" as string]: g.t.spend / max }} />
                      </span>
                    </td>
                    <td className="r">{g.n}</td>
                    <td className="r">{fmtCk("spend", g.t.spend, currency)}</td>
                    {CMP_COLS.map((k) => {
                      const v = ck(g.t, k);
                      const d = vsRef(v, ck(baseline, k));
                      const good = d !== null && Math.abs(d) >= 10 && (d > 0) === (k !== "cpa");
                      const bad = d !== null && Math.abs(d) >= 10 && !good;
                      return (
                        <td key={k} className="r" style={!low && (good || bad) ? { color: good ? "var(--green)" : "var(--red)" } : undefined}>
                          {fmtCk(k, v, currency)}
                        </td>
                      );
                    })}
                    <td className="r">{g.real && g.t.spend ? fmtCk("roas", g.real.revenue / g.t.spend) : <span className="fainter">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="crv-note">Aucune annonce sur la période.</p>
      )}
      {groups.length > 12 && <p className="crv-note">+ {groups.length - 12} autres</p>}
      {editing && <NamingModal naming={naming} sample={names.slice(0, 5)} onClose={() => setEditing(false)} />}
    </section>
  );
}

function sumReal(ads: BoardAd[]) {
  let sales = 0;
  let revenue = 0;
  let any = false;
  for (const a of ads)
    if (a.real) {
      any = true;
      sales += a.real.sales;
      revenue += a.real.revenue;
    }
  return any ? { sales, revenue } : null;
}

function NamingModal({ naming, sample, onClose }: { naming: NamingConfig; sample: string[]; onClose: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [mode, setMode] = useState(naming.mode);
  const [separator, setSeparator] = useState(naming.separator);
  const [fields, setFields] = useState<NamingField[]>(naming.fields.length ? naming.fields : [{ key: mode === "position" ? "1" : "F", label: "Format" }]);
  const cfg: NamingConfig = { mode, separator, fields: fields.filter((f) => f.key.trim()) };
  const set = (i: number, patch: Partial<NamingField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const save = async () => {
    await mutate(async (sb) => must(await sb.from("workspaces").update({ creative_naming: cfg as never }).eq("id", ws.workspace.id)), { success: "Nomenclature enregistrée" });
    onClose();
  };
  const reset = async () => {
    await mutate(async (sb) => must(await sb.from("workspaces").update({ creative_naming: null }).eq("id", ws.workspace.id)), { success: "Retour aux préfixes détectés automatiquement" });
    onClose();
  };

  return (
    <Modal
      title="Nomenclature des annonces"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={reset}>
            Détection automatique
          </button>
          <button className="btn btn-primary" onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Dis comment lire tes noms d&apos;annonces. Sans réglage, les préfixes comme « F:UGC » ou « H=Douleur » sont détectés tout seuls.
        </p>
        <div className="seg" role="group" aria-label="Style de nomenclature">
          <button type="button" className={mode === "prefix" ? "on" : ""} onClick={() => setMode("prefix")}>
            Préfixes (F:UGC)
          </button>
          <button type="button" className={mode === "position" ? "on" : ""} onClick={() => setMode("position")}>
            Positions (UGC_Routine)
          </button>
        </div>
        <label className="field">
          <span className="label">Séparateur (vide = deviné)</span>
          <input className="input mono" value={separator} onChange={(e) => setSeparator(e.target.value)} placeholder="| ou _" style={{ maxWidth: 120 }} />
        </label>
        <div className="field">
          <span className="label">{mode === "prefix" ? "Préfixe et nom du champ" : "Position (1, 2, 3…) et nom du champ"}</span>
          <div style={{ display: "grid", gap: 6 }}>
            {fields.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 6 }}>
                <input className="input mono" value={f.key} onChange={(e) => set(i, { key: e.target.value })} style={{ width: 80 }} aria-label="Préfixe ou position" />
                <input className="input" value={f.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Format, Angle, Accroche…" aria-label="Nom du champ" />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} aria-label="Retirer ce champ">
                  Retirer
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={() => setFields((fs) => [...fs, { key: mode === "position" ? String(fs.length + 1) : "", label: "" }])}>
              Ajouter un champ
            </button>
          </div>
        </div>
        {sample.length > 0 && (
          <div className="field">
            <span className="label">Aperçu sur tes annonces</span>
            <ul className="crv-naming-prev">
              {sample.map((n) => {
                const p = parseAdName(n, cfg);
                return (
                  <li key={n}>
                    <span className="trunc">{n}</span>
                    <span className="muted">{Object.keys(p).length ? Object.entries(p).map(([k, v]) => `${k} : ${v}`).join(" · ") : "rien de reconnu"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
