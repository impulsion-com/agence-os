"use client";

import { useState } from "react";
import { GripVertical, Lock, Plus, Trash2 } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { SetPage } from "@/components/workspace/settings/shell";
import { useToast } from "@/components/ui/toast";
import { colorOf } from "@/lib/constants";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { PipelineStage } from "@/lib/types";
import { useSynced } from "./lib";
import { ColorPicker, InlineText, PillSelect } from "./shared";

import "@/styles/crm.css";

const KINDS: { id: PipelineStage["kind"]; name: string; color: string }[] = [
  { id: "open", name: "En cours", color: "var(--blue)" },
  { id: "won", name: "Gagné", color: "var(--green)" },
  { id: "lost", name: "Perdu", color: "var(--red)" },
];

export function PipelineSettings({ stages: initial, dealCounts }: { stages: PipelineStage[]; dealCounts: Record<string, number> }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const [stages, setStages] = useSynced(initial);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const [del, setDel] = useState<PipelineStage | null>(null);
  const ro = !ws.isAdmin;
  const sorted = [...stages].sort((a, b) => a.position - b.position);

  const patch = (id: string, p: Partial<PipelineStage>, success?: string) => {
    const prev = stages;
    setStages((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
    mutate(
      async (sb) => {
        const r = await sb.from("pipeline_stages").update(p).eq("id", id);
        if (r.error) setStages(prev);
        return must(r);
      },
      { success },
    );
  };

  // Changer le type en conservant exactement une étape gagnée et une perdue : l'ancienne repasse « en cours ».
  const setKind = (s: PipelineStage, kind: PipelineStage["kind"]) => {
    if (kind === s.kind) return;
    if (s.kind !== "open") {
      toast(`Il faut exactement une étape « ${s.kind === "won" ? "Gagné" : "Perdu"} ». Choisis-en une autre pour la remplacer.`, { error: true });
      return;
    }
    const previous = stages.find((x) => x.kind === kind);
    const prev = stages;
    setStages((all) =>
      all.map((x) =>
        x.id === s.id ? { ...x, kind, probability: kind === "won" ? 100 : 0 } : previous && x.id === previous.id ? { ...x, kind: "open", probability: 50 } : x,
      ),
    );
    mutate(
      async (sb) => {
        try {
          if (previous) must(await sb.from("pipeline_stages").update({ kind: "open", probability: 50 }).eq("id", previous.id));
          must(await sb.from("pipeline_stages").update({ kind, probability: kind === "won" ? 100 : 0 }).eq("id", s.id));
        } catch (e) {
          setStages(prev);
          throw e;
        }
      },
      { success: previous ? `« ${s.name} » remplace « ${previous.name} »` : "Type mis à jour" },
    );
  };

  const add = async () => {
    const opens = sorted.filter((s) => s.kind === "open");
    const lastOpen = opens[opens.length - 1];
    const at = lastOpen ? sorted.indexOf(lastOpen) + 1 : 0;
    // Nouvelle étape insérée après la dernière étape ouverte, positions renumérotées (entiers)
    const after = sorted.slice(at);
    const row = await mutate(
      async (sb) => {
        await Promise.all(after.map((x, i) => sb.from("pipeline_stages").update({ position: at + i + 1 }).eq("id", x.id).then(must)));
        return must(
          await sb
            .from("pipeline_stages")
            .insert({ workspace_id: ws.workspace.id, name: "Nouvelle étape", position: at, probability: 50, kind: "open", color: "#8662C9" })
            .select("*")
            .single(),
        );
      },
      { success: "Étape ajoutée" },
    );
    if (row) setStages((all) => [...all.map((x) => (after.some((a) => a.id === x.id) ? { ...x, position: at + after.findIndex((a) => a.id === x.id) + 1 } : x)), row as PipelineStage]);
  };

  const drop = (movingId: string | null, targetId: string, after: boolean) => {
    const moving = sorted.find((s) => s.id === movingId);
    setDrag(null);
    setOver(null);
    if (!moving || moving.id === targetId) return;
    const rest = sorted.filter((s) => s.id !== moving.id);
    const ti = rest.findIndex((s) => s.id === targetId) + (after ? 1 : 0);
    const order = [...rest.slice(0, ti), moving, ...rest.slice(ti)];
    // Positions entières renumérotées pour rester lisibles
    const prev = stages;
    setStages(order.map((s, i) => ({ ...s, position: i })));
    mutate(
      async (sb) => {
        try {
          await Promise.all(order.map((s, i) => (s.position !== i ? sb.from("pipeline_stages").update({ position: i }).eq("id", s.id).then(must) : null)));
        } catch (e) {
          setStages(prev);
          throw e;
        }
      },
      { success: "Ordre des étapes mis à jour" },
    );
  };

  const moveBy = (s: PipelineStage, dir: -1 | 1) => {
    const i = sorted.indexOf(s);
    const target = sorted[i + dir];
    if (!target) return;
    drop(s.id, target.id, dir === 1);
  };

  return (
    <SetPage title="Pipeline commercial" lead="Les étapes par lesquelles passent tes deals, de la prise de contact à la signature. La probabilité sert à calculer le pipeline pondéré.">
      {ro && (
        <p className="crm-note" style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <Lock size={14} /> Seuls les admins de l&apos;espace peuvent modifier le pipeline.
        </p>
      )}

      <div className="crm-stages">
        <div className="crm-stage-head" aria-hidden>
          <span />
          <span />
          <span>Étape</span>
          <span style={{ textAlign: "right", paddingRight: 18 }}>Probabilité</span>
          <span className="kind">Type</span>
          <span />
        </div>
        <div className="card" style={{ overflow: "hidden" }} role="list">
          {sorted.map((s) => {
            const n = dealCounts[s.id] ?? 0;
            const cls = `crm-stage-row${drag === s.id ? " dragging" : ""}${over?.id === s.id ? (over.after ? " over-bottom" : " over-top") : ""}`;
            return (
              <div
                key={s.id}
                role="listitem"
                className={cls}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > r.top + r.height / 2;
                  if (over?.id !== s.id || over.after !== after) setOver({ id: s.id, after });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (over) drop(drag, over.id, over.after);
                }}
              >
                <span
                  className="grip"
                  draggable={!ro}
                  tabIndex={ro ? -1 : 0}
                  role="button"
                  aria-label={`Déplacer ${s.name} (flèches haut et bas)`}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", s.id);
                    const row = e.currentTarget.parentElement;
                    if (row) e.dataTransfer.setDragImage(row, 20, 20);
                    setDrag(s.id);
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onKeyDown={(e) => {
                    if (ro) return;
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      moveBy(s, -1);
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      moveBy(s, 1);
                    }
                  }}
                >
                  {!ro && <GripVertical size={14} />}
                </span>
                {ro ? <i className="crm-dot lg" style={{ ["--c" as string]: colorOf(s.color), margin: "0 auto" }} /> : <ColorPicker value={s.color} onChange={(color) => patch(s.id, { color })} />}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <InlineText value={s.name} disabled={ro} ariaLabel="Nom de l'étape" onSave={(name) => name && patch(s.id, { name }, "Étape renommée")} />
                  {n > 0 && <span className="count" title={`${n} deal${n > 1 ? "s" : ""}`}>{n}</span>}
                </div>
                <div className="crm-prob">
                  <InlineText
                    className="num"
                    value={String(s.probability)}
                    disabled={ro || s.kind !== "open"}
                    ariaLabel={`Probabilité de ${s.name}`}
                    onSave={(v) => {
                      const p = Math.max(0, Math.min(100, Math.round(Number(v.replace(",", ".")) || 0)));
                      patch(s.id, { probability: p });
                    }}
                  />
                  %
                </div>
                <div className="kind">
                  {ro ? (
                    <span className="badge" style={{ ["--c" as string]: KINDS.find((k) => k.id === s.kind)!.color }}>{KINDS.find((k) => k.id === s.kind)!.name}</span>
                  ) : (
                    <PillSelect value={s.kind} options={KINDS} onChange={(k) => setKind(s, k)} />
                  )}
                </div>
                {!ro && s.kind === "open" ? (
                  <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Supprimer ${s.name}`} onClick={() => setDel(s)}>
                    <Trash2 size={14} />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
        <div className="crm-stage-foot">
          {!ro ? (
            <button className="btn" onClick={add}>
              <Plus size={14} /> Ajouter une étape
            </button>
          ) : (
            <span />
          )}
          <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            Glisse les étapes pour les réordonner. Les étapes « Gagné » et « Perdu » sont uniques et ne se suppriment pas.
          </span>
        </div>
      </div>

      {del && (
        <DeleteStageModal
          stage={del}
          count={dealCounts[del.id] ?? 0}
          others={sorted.filter((s) => s.id !== del.id)}
          onClose={() => setDel(null)}
          onDone={() => setStages((s) => s.filter((x) => x.id !== del.id))}
        />
      )}
    </SetPage>
  );
}

function DeleteStageModal({ stage, count, others, onClose, onDone }: { stage: PipelineStage; count: number; others: PipelineStage[]; onClose: () => void; onDone: () => void }) {
  const mutate = useMutate();
  const [dest, setDest] = useState(others.find((s) => s.kind === "open")?.id ?? others[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const ok = await mutate(
      async (sb) => {
        if (count) must(await sb.from("deals").update({ stage_id: dest }).eq("stage_id", stage.id));
        must(await sb.from("pipeline_stages").delete().eq("id", stage.id));
        return true;
      },
      { success: `Étape « ${stage.name} » supprimée` },
    );
    setBusy(false);
    if (ok) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title={`Supprimer l'étape « ${stage.name} » ?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-danger" disabled={busy || (count > 0 && !dest)} onClick={run} autoFocus>
            Supprimer
          </button>
        </>
      }
    >
      {count ? (
        <>
          <p className="muted">
            {count} deal{count > 1 ? "s sont" : " est"} dans cette étape. Choisis où {count > 1 ? "les" : "le"} déplacer avant la suppression.
          </p>
          <div className="field">
            <label htmlFor="dest-stage">Déplacer vers</label>
            <select id="dest-stage" className="select" value={dest} onChange={(e) => setDest(e.target.value)}>
              {others.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <p className="muted">Aucun deal n&apos;est dans cette étape. Elle sera supprimée définitivement.</p>
      )}
    </Modal>
  );
}
