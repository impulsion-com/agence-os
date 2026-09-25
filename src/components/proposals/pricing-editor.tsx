"use client";

import { ArrowDown, ArrowUp, BookOpen, GripVertical, PenLine, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Menu } from "@/components/ui/overlay";
import { money } from "@/lib/format";
import type { Billing, ProposalItem, Service } from "@/lib/types";
import { TotalsSummary } from "./document";
import { AutoTextarea } from "./fields";
import { computeTotals, lineTotal } from "./lib";

export type EditItem = Omit<ProposalItem, "proposal_id">;

/** Champ numérique qui tolère la saisie en cours (« 12, » ou vide). */
function NumInput({ value, onChange, label, step = "any", min = 0, className = "" }: { value: number; onChange: (n: number) => void; label: string; step?: string; min?: number; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Number(value)).replace(".", ",");
  return (
    <input
      className={`input pe-num ${className}`}
      inputMode="decimal"
      aria-label={label}
      value={shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value.replace(/\s/g, "").replace(",", "."));
        if (!Number.isNaN(n) && n >= min) onChange(n);
      }}
      onBlur={() => setDraft(null)}
      step={step}
    />
  );
}

export function PricingEditor({
  items,
  services,
  currency,
  discountPct,
  taxPct,
  onAdd,
  onChange,
  onRemove,
  onMove,
}: {
  items: EditItem[];
  services: Service[];
  currency: string;
  discountPct: number;
  taxPct: number;
  onAdd: (from?: Service) => void;
  onChange: (id: string, patch: Partial<EditItem>) => void;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const totals = computeTotals(items, discountPct, taxPct);
  const withOptions = computeTotals(items, discountPct, taxPct, () => true);
  const hasOptions = items.some((i) => i.optional);
  const catalog = services.filter((s) => !s.archived);

  return (
    <div className="pe-pricing">
      {items.length === 0 ? (
        <div className="pe-pricing-empty">
          <p>Aucune ligne de prix. Ajoute une prestation depuis ton catalogue ou une ligne libre.</p>
        </div>
      ) : (
        <ul className="pe-lines" aria-label="Lignes de prix">
          {items.map((i, idx) => (
            <li
              key={i.id}
              className={`pe-line${drag === idx ? " dragging" : ""}${over === idx && drag !== null && drag !== idx ? (drag < idx ? " drop-after" : " drop-before") : ""}${i.optional ? " opt" : ""}`}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                setOver(idx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null && drag !== idx) onMove(drag, idx);
                setDrag(null);
                setOver(null);
              }}
            >
              <span
                className="pe-grip"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", i.id);
                  setDrag(idx);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                title="Glisser pour réordonner"
                aria-hidden
              >
                <GripVertical size={14} />
              </span>
              <div className="pe-line-main">
                <input
                  className="input bare pe-line-name"
                  value={i.name}
                  placeholder="Nom de la prestation"
                  aria-label="Nom de la prestation"
                  onChange={(e) => onChange(i.id, { name: e.target.value })}
                />
                <AutoTextarea
                  className="pe-line-desc"
                  value={i.description}
                  placeholder="Description (facultatif)"
                  ariaLabel="Description"
                  onChange={(v) => onChange(i.id, { description: v })}
                />
                <div className="pe-line-ctl">
                  <label className="pe-ctl">
                    <span>Qté</span>
                    <NumInput className="pe-qty" label="Quantité" value={i.quantity} onChange={(n) => onChange(i.id, { quantity: n })} />
                  </label>
                  <label className="pe-ctl">
                    <span>Prix unitaire HT</span>
                    <NumInput className="pe-price" label="Prix unitaire HT" value={i.unit_price} onChange={(n) => onChange(i.id, { unit_price: n })} />
                  </label>
                  <label className="pe-ctl">
                    <span>Facturation</span>
                    <select
                      className="select pe-billing"
                      aria-label="Facturation"
                      value={i.billing}
                      onChange={(e) => onChange(i.id, { billing: e.target.value as Billing })}
                    >
                      <option value="monthly">Mensuel</option>
                      <option value="one_off">Ponctuel</option>
                    </select>
                  </label>
                  <label className="pe-opt" title="Le client pourra cocher ou décocher cette ligne sur la page de la proposition">
                    <input
                      type="checkbox"
                      className="toggle"
                      checked={i.optional}
                      onChange={(e) => onChange(i.id, { optional: e.target.checked, selected: !e.target.checked })}
                    />
                    En option
                  </label>
                  {i.optional && (
                    <label className="pe-opt" title="L'option apparaît déjà cochée pour le client, qui peut la retirer">
                      <input type="checkbox" className="check" checked={i.selected} onChange={(e) => onChange(i.id, { selected: e.target.checked })} />
                      Cochée par défaut
                    </label>
                  )}
                </div>
              </div>
              <span className="pe-line-total num">
                {money(lineTotal(i), currency, Number.isInteger(lineTotal(i)) ? 0 : 2)}
                {i.billing === "monthly" && <small>/ mois</small>}
                {i.optional && <span className="pd-opt-tag">Option</span>}
              </span>
              <span className="pe-line-act">
                <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={idx === 0} onClick={() => onMove(idx, idx - 1)} aria-label="Monter la ligne">
                  <ArrowUp size={13} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={idx === items.length - 1} onClick={() => onMove(idx, idx + 1)} aria-label="Descendre la ligne">
                  <ArrowDown size={13} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon pe-del" onClick={() => onRemove(i.id)} aria-label={`Supprimer la ligne ${i.name}`}>
                  <Trash2 size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="pe-pricing-add">
        <Menu
          search="Chercher une prestation…"
          width={320}
          trigger={(open) => (
            <button type="button" className="btn btn-sm" onClick={open}>
              <BookOpen size={13} />
              Depuis le catalogue
            </button>
          )}
          items={
            catalog.length
              ? catalog.map((s) => ({
                  label: s.name,
                  sub: `${money(s.unit_price, currency)}${s.billing === "monthly" ? " / mois" : ""}`,
                  onSelect: () => onAdd(s),
                }))
              : [{ label: "Catalogue vide : ajoute tes services dans les réglages", heading: true }]
          }
        />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onAdd()}>
          <PenLine size={13} />
          Ligne libre
        </button>
      </div>

      {items.length > 0 && (
        <div className="pe-pricing-totals">
          <TotalsSummary totals={totals} currency={currency} discountPct={discountPct} taxPct={taxPct} compact />
          {hasOptions && (
            <p className="faint pe-opt-note">
              <Plus size={12} aria-hidden /> Options non cochées : {money(totals.optionsLeft, currency)} HT. Tout compris :{" "}
              {withOptions.monthly.net ? `${money(withOptions.monthly.net, currency)} HT / mois` : ""}
              {withOptions.monthly.net && withOptions.one_off.net ? " et " : ""}
              {withOptions.one_off.net ? `${money(withOptions.one_off.net, currency)} HT ponctuel` : ""}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
