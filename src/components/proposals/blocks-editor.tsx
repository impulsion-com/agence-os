"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarRange, GripVertical, Heading, Pilcrow, Plus, Receipt, Target, Trash2, X } from "lucide-react";

import { Menu, type MenuItem } from "@/components/ui/overlay";
import type { ProposalBlock } from "@/lib/types";
import { AutoTextarea } from "./fields";
import { BLOCK_TYPES, newBlock } from "./lib";

const BLOCK_ICON: Record<ProposalBlock["type"], ReactNode> = {
  heading: <Heading size={14} />,
  text: <Pilcrow size={14} />,
  pricing: <Receipt size={14} />,
  timeline: <CalendarRange size={14} />,
  kpis: <Target size={14} />,
};
const BLOCK_NAME = Object.fromEntries(BLOCK_TYPES.map((b) => [b.type, b.name])) as Record<ProposalBlock["type"], string>;

export function addMenuItems(onPick: (b: ProposalBlock) => void, hasPricing: boolean): MenuItem[] {
  return BLOCK_TYPES.filter((b) => b.type !== "pricing" || !hasPricing).map((b) => ({
    label: b.name,
    icon: BLOCK_ICON[b.type],
    sub: b.desc,
    onSelect: () => onPick(newBlock(b.type)),
  }));
}

function TimelineEditor({ block, onChange }: { block: Extract<ProposalBlock, { type: "timeline" }>; onChange: (b: ProposalBlock) => void }) {
  const set = (i: number, patch: Partial<(typeof block.steps)[number]>) =>
    onChange({ ...block, steps: block.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <div className="pe-tl">
      <ol>
        {block.steps.map((s, i) => (
          <li key={i} className="pe-tl-step">
            <span className="pd-tl-dot" aria-hidden>
              {i + 1}
            </span>
            <div className="pe-tl-fields">
              <input className="input bare pe-tl-when" placeholder="Quand (ex. Semaine 1)" aria-label={`Période de l'étape ${i + 1}`} value={s.duration} onChange={(e) => set(i, { duration: e.target.value })} />
              <input className="input bare pe-tl-title" placeholder="Nom de l'étape" aria-label={`Nom de l'étape ${i + 1}`} value={s.title} onChange={(e) => set(i, { title: e.target.value })} />
              <AutoTextarea className="pe-tl-detail" placeholder="Ce qui se passe à cette étape" ariaLabel={`Détail de l'étape ${i + 1}`} value={s.detail} onChange={(v) => set(i, { detail: v })} />
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon pe-mini-del"
              aria-label={`Retirer l'étape ${i + 1}`}
              onClick={() => onChange({ ...block, steps: block.steps.filter((_, k) => k !== i) })}
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="add-row pe-add-sub" onClick={() => onChange({ ...block, steps: [...block.steps, { title: "", detail: "", duration: "" }] })}>
        <Plus size={13} /> Ajouter une étape
      </button>
    </div>
  );
}

function KpisEditor({ block, onChange }: { block: Extract<ProposalBlock, { type: "kpis" }>; onChange: (b: ProposalBlock) => void }) {
  const set = (i: number, patch: Partial<(typeof block.items)[number]>) =>
    onChange({ ...block, items: block.items.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <div className="pe-kpis">
      {block.items.map((k, i) => (
        <div key={i} className="pd-kpi pe-kpi">
          <input className="input bare pd-kpi-v" placeholder="60" aria-label={`Valeur de l'objectif ${i + 1}`} value={k.value} onChange={(e) => set(i, { value: e.target.value })} />
          <input className="input bare pd-kpi-l" placeholder="Démos qualifiées / mois" aria-label={`Libellé de l'objectif ${i + 1}`} value={k.label} onChange={(e) => set(i, { label: e.target.value })} />
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon pe-mini-del"
            aria-label={`Retirer l'objectif ${i + 1}`}
            onClick={() => onChange({ ...block, items: block.items.filter((_, x) => x !== i) })}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {block.items.length < 6 && (
        <button type="button" className="add-row pe-add-sub pe-kpi-add" onClick={() => onChange({ ...block, items: [...block.items, { label: "", value: "" }] })}>
          <Plus size={13} /> Ajouter un objectif
        </button>
      )}
    </div>
  );
}

export function BlocksEditor({
  blocks,
  onChange,
  pricing,
}: {
  blocks: ProposalBlock[];
  onChange: (b: ProposalBlock[]) => void;
  pricing: ReactNode;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const hasPricing = blocks.some((b) => b.type === "pricing");

  const update = (i: number, b: ProposalBlock) => onChange(blocks.map((x, k) => (k === i ? b : x)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b);
    onChange(next);
  };
  const insert = (at: number, b: ProposalBlock) => {
    const next = [...blocks];
    next.splice(at, 0, b);
    onChange(next);
    // Focus du nouveau bloc après rendu
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-block="${b.id}"] input, [data-block="${b.id}"] textarea`);
      el?.focus();
    });
  };

  return (
    <div className="pe-blocks">
      {blocks.length === 0 && (
        <div className="pe-blocks-empty">
          <p>Le document est vide. Ajoute un premier bloc : titre, texte, tableau de prix, calendrier ou objectifs.</p>
        </div>
      )}
      {blocks.map((b, i) => (
        <section
          key={b.id}
          data-block={b.id}
          className={`pe-block pe-block-${b.type}${drag === i ? " dragging" : ""}${over === i && drag !== null && drag !== i ? (drag < i ? " drop-after" : " drop-before") : ""}`}
          aria-label={BLOCK_NAME[b.type]}
          onDragOver={(e) => {
            if (drag === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (drag !== null && drag !== i) move(drag, i);
            setDrag(null);
            setOver(null);
          }}
        >
          <div className="pe-block-tools">
            <Menu
              width={300}
              trigger={(open) => (
                <button type="button" className="pe-tool" onClick={open} aria-label="Insérer un bloc en dessous" title="Insérer un bloc en dessous">
                  <Plus size={14} />
                </button>
              )}
              items={addMenuItems((nb) => insert(i + 1, nb), hasPricing)}
            />
            <span
              className="pe-tool pe-grip"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", b.id);
                setDrag(i);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              title="Glisser pour déplacer"
              aria-hidden
            >
              <GripVertical size={14} />
            </span>
          </div>
          <div className="pe-block-side">
            <span className="pe-block-kind">
              {BLOCK_ICON[b.type]}
              {BLOCK_NAME[b.type]}
            </span>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Monter le bloc">
              <ArrowUp size={13} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={i === blocks.length - 1} onClick={() => move(i, i + 1)} aria-label="Descendre le bloc">
              <ArrowDown size={13} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon pe-del" onClick={() => onChange(blocks.filter((x) => x.id !== b.id))} aria-label={`Supprimer le bloc ${BLOCK_NAME[b.type]}`}>
              <Trash2 size={13} />
            </button>
          </div>

          {b.type === "heading" && (
            <input
              className="input bare pd-h pe-heading"
              placeholder="Titre de section"
              aria-label="Titre de section"
              value={b.text}
              onChange={(e) => update(i, { ...b, text: e.target.value })}
            />
          )}
          {b.type === "text" && (
            <AutoTextarea
              className="pe-text prose"
              minRows={2}
              placeholder="Écris ici. **gras**, *italique*, une ligne qui commence par « - » devient une liste."
              ariaLabel="Texte"
              value={b.text}
              onChange={(v) => update(i, { ...b, text: v })}
            />
          )}
          {b.type === "timeline" && <TimelineEditor block={b} onChange={(nb) => update(i, nb)} />}
          {b.type === "kpis" && <KpisEditor block={b} onChange={(nb) => update(i, nb)} />}
          {b.type === "pricing" && pricing}
        </section>
      ))}

      <Menu
        width={300}
        trigger={(open) => (
          <button type="button" className="add-row pe-add-block" onClick={open}>
            <Plus size={14} /> Ajouter un bloc
          </button>
        )}
        items={addMenuItems((nb) => insert(blocks.length, nb), hasPricing)}
      />
    </div>
  );
}
