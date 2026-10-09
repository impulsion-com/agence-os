"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ListFilter, Plus, Settings2, Trash2 } from "lucide-react";

import { PeriodPicker } from "@/components/reporting/period-picker";
import { ConfirmModal, Menu, Modal } from "@/components/ui/overlay";
import { fmtKpi, type Period } from "@/lib/ads/metrics";
import { KINDS, TEMPLATES, stageKey, type Funnel, type Stage, type StageKind, type TemplateId } from "@/lib/tracking/funnel";
import type { SiteRow } from "@/lib/tracking/load";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { fmtConv, fmtPct } from "./shared";

export function FunnelTab({ site, period, stages, funnel }: { site: SiteRow; period: Period; stages: Stage[]; funnel: Funnel }) {
  const ws = useWorkspace();
  const currency = ws.workspace.currency || "EUR";
  const [edit, setEdit] = useState(false);
  const empty = funnel.rows.every((r) => r.events === 0);
  // L'étape la moins bien couverte, si elle passe sous la moitié
  const weakest = funnel.rows.filter((r) => r.coverage !== null && r.coverage < 50).sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0))[0];

  return (
    <div className="trk-col">
      <div className="trk-filters">
        <PeriodPicker period={period} />
        {ws.canWrite && (
          <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => setEdit(true)}>
            <Settings2 size={14} /> Modifier les étapes
          </button>
        )}
      </div>

      <section className="card">
        <div className="card-h">
          <h2>Entonnoir</h2>
        </div>
        {funnel.rows.length === 0 ? (
          <div className="card-b trk-prose">
            <p>Ce site n&apos;a aucune étape. {ws.canWrite ? "Ajoute-en avec « Modifier les étapes »." : "Un membre de l'espace peut en ajouter."}</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl trk-funnel">
                <thead>
                  <tr>
                    <th>Étape</th>
                    <th className="r">Personnes</th>
                    <th aria-hidden />
                    <th className="r">Depuis l&apos;étape précédente</th>
                    <th className="r">Évènements</th>
                    <th className="r" title="Part des évènements de l'étape rattachés à une source : au moins un point de contact autre que direct dans la fenêtre d'attribution du site">Avec une source</th>
                    <th className="r">Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.rows.map((r) => (
                    <tr key={r.stage.id}>
                      <td>
                        <span style={{ fontWeight: 500 }}>{r.stage.label}</span> <code className="faint">{r.stage.key}</code>
                      </td>
                      <td className="r num">{fmtConv(r.people)}</td>
                      <td className="bar" aria-hidden>
                        <i style={{ width: `${Math.round(r.share * 100)}%` }} />
                      </td>
                      <td className="r num">{fmtPct(r.fromPrev)}</td>
                      <td className="r num muted">{fmtConv(r.events)}</td>
                      <td className={`r num${r.coverage !== null && r.coverage < 50 ? " low" : ""}`}>{fmtPct(r.coverage)}</td>
                      <td className="r num">{r.stage.has_value ? fmtKpi("value", r.value, currency) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-b trk-prose" style={{ paddingTop: 12 }}>
              <p className="faint">
                {empty
                  ? "Aucune conversion reçue sur la période. Les étapes se remplissent avec le script du site et les conversions envoyées par l'API."
                  : "Chaque étape est comptée à sa date : une vente de cette période peut venir d'un prospect d'une période précédente, et un taux peut alors dépasser 100 %."}
              </p>
              {weakest && (
                <p className="faint">
                  « Avec une source » dit jusqu&apos;où l&apos;attribution est fiable. Sur « {weakest.stage.label} », {fmtPct(weakest.coverage)} seulement des
                  évènements ont une source : les chiffres par campagne de cette étape ne décrivent donc qu&apos;une partie de la réalité. Les causes habituelles :
                  conversion envoyée sous un autre email ou téléphone que celui du visiteur, cookie expiré, consentement refusé.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {funnel.other.length > 0 && (
        <section className="card">
          <div className="card-h">
            <h2>
              <ListFilter size={15} style={{ display: "inline", verticalAlign: -2, marginRight: 6 }} />
              Évènements hors entonnoir
            </h2>
          </div>
          <div className="card-b trk-prose">
            <p>Ces évènements arrivent bien mais ne correspondent à aucune étape. Ajoute leur nom à une étape, ou crée une étape, pour les compter.</p>
            <ul className="trk-other">
              {funnel.other.map((o) => (
                <li key={o.type}>
                  <code>{o.type}</code>
                  <span className="num">
                    {fmtConv(o.events)} évènement{o.events > 1 ? "s" : ""}, {fmtConv(o.people)} personne{o.people > 1 ? "s" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {edit && <StagesModal site={site} stages={stages} onClose={() => setEdit(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Édition des étapes
// ---------------------------------------------------------------------
interface Draft {
  id?: string;
  key: string;
  label: string;
  kind: StageKind;
  has_value: boolean;
  aliases: string;
}

function StagesModal({ site, stages, onClose }: { site: SiteRow; stages: Stage[]; onClose: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [rows, setRows] = useState<Draft[]>(stages.map((s) => ({ id: s.id, key: s.key, label: s.label, kind: s.kind, has_value: s.has_value, aliases: s.aliases.join(", ") })));
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<TemplateId | null>(null);

  const set = (i: number, patch: Partial<Draft>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  // Une étape nouvelle tire sa clé de son nom ; une étape existante garde la sienne (les évènements déjà reçus y sont rattachés)
  const keyed = rows.map((r) => ({ ...r, key: r.id ? r.key : stageKey(r.key || r.label) }));
  const dup = keyed.find((r, i) => r.key && keyed.findIndex((x) => x.key === r.key) !== i)?.key;
  const blank = keyed.some((r) => !r.label.trim() || !r.key);
  const error = blank ? "Chaque étape a besoin d'un nom." : dup ? `Deux étapes portent la clé « ${dup} ».` : null;

  const save = async () => {
    if (error) return;
    setBusy(true);
    const kept = new Set(keyed.filter((r) => r.id).map((r) => r.id));
    const gone = stages.filter((s) => !kept.has(s.id)).map((s) => s.id);
    const ok = await mutate(
      async (sb) => {
        if (gone.length) must(await sb.from("tracking_stages").delete().in("id", gone));
        const payload = keyed.map((r, i) => ({
          ...(r.id ? { id: r.id } : {}),
          site_id: site.id,
          workspace_id: ws.workspace.id,
          key: r.key,
          label: r.label.trim(),
          position: i + 1,
          kind: r.kind,
          has_value: r.has_value,
          aliases: [...new Set(r.aliases.split(/[\s,;]+/).map(stageKey).filter((a) => a && a !== r.key))],
        }));
        const existing = payload.filter((p) => "id" in p);
        const added = payload.filter((p) => !("id" in p));
        if (existing.length) must(await sb.from("tracking_stages").upsert(existing));
        if (added.length) must(await sb.from("tracking_stages").insert(added));
      },
      { success: "Entonnoir enregistré" },
    );
    setBusy(false);
    if (ok !== undefined) onClose();
  };

  return (
    <>
      <Modal
        title="Étapes de l'entonnoir"
        onClose={onClose}
        size="lg"
        footer={
          <>
            <Menu
              width={300}
              trigger={(open, isOpen) => (
                <button type="button" className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={open} aria-haspopup="menu" aria-expanded={isOpen}>
                  Repartir d&apos;un gabarit
                </button>
              )}
              items={TEMPLATES.map((t) => ({ label: t.name, sub: t.desc, onSelect: () => setTemplate(t.id) }))}
            />
            <button className="btn" onClick={onClose}>Annuler</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !!error}>Enregistrer</button>
          </>
        }
      >
        <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
          Une étape compte les évènements qui portent sa clé (par exemple <code>purchase</code>) ou l&apos;un des autres noms indiqués. L&apos;ordre est celui du parcours.
        </p>
        <div className="trk-stages">
          {rows.map((r, i) => (
            <div className="trk-stage" key={r.id ?? `new-${i}`}>
              <div className="ord">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter l'étape ${r.label}`}>
                  <ArrowUp size={13} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Descendre l'étape ${r.label}`}>
                  <ArrowDown size={13} />
                </button>
              </div>
              <div className="field">
                <label htmlFor={`st-label-${i}`}>Nom</label>
                <input id={`st-label-${i}`} className="input" value={r.label} maxLength={60} onChange={(e) => set(i, { label: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`st-key-${i}`}>Clé de l&apos;évènement</label>
                <input
                  id={`st-key-${i}`}
                  className="input mono"
                  value={r.key}
                  placeholder={stageKey(r.label) || "ma_cle"}
                  readOnly={!!r.id}
                  onChange={(e) => set(i, { key: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`st-kind-${i}`}>Type</label>
                <select id={`st-kind-${i}`} className="select" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as StageKind })}>
                  {KINDS.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
              </div>
              <div className="field wide">
                <label htmlFor={`st-alias-${i}`}>Autres noms comptés dans cette étape</label>
                <input id={`st-alias-${i}`} className="input mono" value={r.aliases} placeholder="Aucun" onChange={(e) => set(i, { aliases: e.target.value })} />
              </div>
              <label className="trk-check val">
                <input type="checkbox" className="toggle" checked={r.has_value} onChange={(e) => set(i, { has_value: e.target.checked })} />
                <span>
                  <b>Porte un montant</b>
                </span>
              </label>
              <button type="button" className="btn btn-ghost btn-icon btn-sm del" onClick={() => setRows((x) => x.filter((_, k) => k !== i))} aria-label={`Supprimer l'étape ${r.label}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div>
          <button type="button" className="btn" onClick={() => setRows((r) => [...r, { key: "", label: "", kind: "step", has_value: false, aliases: "" }])}>
            <Plus size={14} /> Ajouter une étape
          </button>
        </div>
        {error && <p role="alert" style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }}>{error}</p>}
      </Modal>
      {template && (
        <ConfirmModal
          title="Remplacer l'entonnoir par ce gabarit ?"
          text="Les étapes actuelles sont remplacées. Les évènements déjà reçus sont conservés : ils se rangent dans les nouvelles étapes qui portent leur nom."
          confirmLabel="Remplacer"
          onClose={() => setTemplate(null)}
          onConfirm={async () => {
            const ok = await mutate(async (sb) => must(await sb.rpc("tracking_apply_template", { p_site: site.id, p_template: template })), { success: "Gabarit appliqué" });
            if (ok !== undefined) onClose();
          }}
        />
      )}
    </>
  );
}
