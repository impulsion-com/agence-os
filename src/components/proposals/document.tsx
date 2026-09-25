"use client";

import { Check } from "lucide-react";

import { fmtDate, money } from "@/lib/format";
import type { ProposalBlock, ProposalItem } from "@/lib/types";
import { Markdown, computeTotals, lineTotal, type Totals } from "./lib";

export type DocItem = Pick<ProposalItem, "id" | "name" | "description" | "quantity" | "unit_price" | "billing" | "optional" | "selected" | "position">;

export interface DocData {
  number: number;
  title: string;
  currency: string;
  discount_pct: number;
  tax_pct: number;
  valid_until: string | null;
  sent_at: string | null;
  created_at: string;
  blocks: ProposalBlock[];
}

const fmtQty = (n: number) => (Number.isInteger(Number(n)) ? String(Number(n)) : String(Number(n)).replace(".", ","));

/** Récapitulatif des totaux mensuel / ponctuel (HT, remise, TVA, TTC). */
export function TotalsSummary({ totals, currency, discountPct, taxPct, compact }: { totals: Totals; currency: string; discountPct: number; taxPct: number; compact?: boolean }) {
  const cols = (["monthly", "one_off"] as const).filter((b) => totals[b].count > 0);
  if (!cols.length) return <p className="pd-totals-empty faint">Aucune ligne de prix retenue.</p>;
  return (
    <div className={`pd-totals${compact ? " compact" : ""}`} data-cols={cols.length}>
      {cols.map((b) => {
        const t = totals[b];
        return (
          <div key={b} className="pd-total">
            <div className="pd-total-h">{b === "monthly" ? "Par mois" : "Ponctuel, une fois"}</div>
            <dl>
              {Number(discountPct) > 0 && (
                <>
                  <div>
                    <dt>Sous-total HT</dt>
                    <dd className="num">{money(t.subtotal, currency, 2)}</dd>
                  </div>
                  <div className="pd-disc">
                    <dt>Remise {String(Number(discountPct)).replace(".", ",")} %</dt>
                    <dd className="num">− {money(t.discount, currency, 2)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Total HT</dt>
                <dd className="num">{money(t.net, currency, 2)}</dd>
              </div>
              <div>
                <dt>TVA {String(Number(taxPct)).replace(".", ",")} %</dt>
                <dd className="num">{money(t.tax, currency, 2)}</dd>
              </div>
              <div className="pd-ttc">
                <dt>Total TTC</dt>
                <dd className="num">
                  {money(t.total, currency, 2)}
                  {b === "monthly" && <small> / mois</small>}
                </dd>
              </div>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/** Tableau de prix en lecture, options cochables si `onToggle` est fourni. */
export function PricingTable({
  items,
  currency,
  isSelected,
  onToggle,
}: {
  items: DocItem[];
  currency: string;
  isSelected: (i: DocItem) => boolean;
  onToggle?: (id: string) => void;
}) {
  if (!items.length) return <p className="faint">Les lignes de prix seront bientôt ajoutées.</p>;
  const groups = (["monthly", "one_off"] as const).map((b) => ({ b, rows: items.filter((i) => i.billing === b) })).filter((g) => g.rows.length);
  return (
    <div className="pd-price">
      {groups.map((g) => (
        <div key={g.b} className="pd-price-group">
          <div className="pd-price-h">
            <span>{g.b === "monthly" ? "Prestations mensuelles" : "Prestations ponctuelles"}</span>
            <span className="pd-price-hr">Montant HT</span>
          </div>
          <ul>
            {g.rows.map((i) => {
              const on = isSelected(i);
              const qty = Number(i.quantity);
              return (
                <li key={i.id} className={`pd-line${i.optional ? " opt" : ""}${i.optional && !on ? " off" : ""}`}>
                  {i.optional && (
                    <span className="pd-opt-box">
                      {onToggle ? (
                        <input
                          type="checkbox"
                          className="check"
                          checked={on}
                          onChange={() => onToggle(i.id)}
                          aria-label={`Ajouter l'option ${i.name}`}
                        />
                      ) : (
                        <span className={`pd-opt-static${on ? " on" : ""}`} aria-hidden>
                          {on && <Check size={11} strokeWidth={3} />}
                        </span>
                      )}
                    </span>
                  )}
                  <div className="pd-line-main">
                    <div className="pd-line-name">
                      {i.name}
                      {i.optional && <span className="pd-opt-tag">Option</span>}
                    </div>
                    {i.description && <div className="pd-line-desc">{i.description}</div>}
                    {qty !== 1 && (
                      <div className="pd-line-qty faint num">
                        {fmtQty(qty)} × {money(i.unit_price, currency, 2)}
                      </div>
                    )}
                  </div>
                  <div className="pd-line-amt num">
                    {money(lineTotal(i), currency, Number.isInteger(lineTotal(i)) ? 0 : 2)}
                    {g.b === "monthly" && <small>/ mois</small>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function TimelineView({ steps }: { steps: { title: string; detail: string; duration: string }[] }) {
  return (
    <ol className="pd-timeline">
      {steps
        .filter((s) => s.title || s.detail || s.duration)
        .map((s, i) => (
          <li key={i}>
            <span className="pd-tl-dot" aria-hidden>
              {i + 1}
            </span>
            <div>
              {s.duration && <div className="pd-tl-when">{s.duration}</div>}
              <div className="pd-tl-title">{s.title}</div>
              {s.detail && <div className="pd-tl-detail">{s.detail}</div>}
            </div>
          </li>
        ))}
    </ol>
  );
}

export function KpisView({ items }: { items: { label: string; value: string }[] }) {
  const shown = items.filter((k) => k.label || k.value);
  return (
    <div className="pd-kpis" data-n={Math.min(shown.length, 4)}>
      {shown.map((k, i) => (
        <div key={i} className="pd-kpi">
          <div className="pd-kpi-v">{k.value}</div>
          <div className="pd-kpi-l">{k.label}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Document complet en lecture (page publique, éditeur verrouillé).
 * `selected` / `onToggle` pilotent les options cochables.
 */
export function ProposalDocument({
  data,
  items,
  agency,
  client,
  contact,
  selected,
  onToggle,
}: {
  data: DocData;
  items: DocItem[];
  agency: string;
  client?: string | null;
  contact?: string | null;
  selected: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const isSelected = (i: { id: string; optional: boolean }) => !i.optional || selected.has(i.id);
  const totals = computeTotals(items, data.discount_pct, data.tax_pct, isSelected);
  const blocks = data.blocks.some((b) => b.type === "pricing") || !items.length ? data.blocks : [...data.blocks, { id: "_pricing", type: "pricing" as const }];
  const date = data.sent_at ? data.sent_at.slice(0, 10) : data.created_at.slice(0, 10);

  return (
    <article className="pd">
      <header className="pd-head">
        <div className="pd-agency">
          <span className="pd-mark" aria-hidden>
            {agency.slice(0, 1).toUpperCase()}
          </span>
          {agency}
        </div>
        <p className="pd-kicker">Proposition commerciale n° {data.number}</p>
        <h1 className="pd-title">{data.title}</h1>
        <dl className="pd-meta">
          {client && (
            <div>
              <dt>Pour</dt>
              <dd>
                {client}
                {contact && <span className="faint">, à l&apos;attention de {contact}</span>}
              </dd>
            </div>
          )}
          <div>
            <dt>Date</dt>
            <dd>{fmtDate(date, true)}</dd>
          </div>
          {data.valid_until && (
            <div>
              <dt>Valable jusqu&apos;au</dt>
              <dd>{fmtDate(data.valid_until, true)}</dd>
            </div>
          )}
        </dl>
      </header>

      <div className="pd-body">
        {blocks.map((b) => {
          switch (b.type) {
            case "heading":
              return b.text ? (
                <h2 key={b.id} className="pd-h">
                  {b.text}
                </h2>
              ) : null;
            case "text":
              return b.text.trim() ? (
                <div key={b.id} className="pd-text prose">
                  <Markdown text={b.text} />
                </div>
              ) : null;
            case "timeline":
              return <TimelineView key={b.id} steps={b.steps} />;
            case "kpis":
              return <KpisView key={b.id} items={b.items} />;
            case "pricing":
              return (
                <section key={b.id} className="pd-pricing" aria-label="Investissement">
                  <PricingTable items={items} currency={data.currency} isSelected={isSelected} onToggle={onToggle} />
                  {items.some((i) => i.optional) && onToggle && (
                    <p className="pd-opt-hint faint">Cochez les options qui vous intéressent : les totaux se mettent à jour.</p>
                  )}
                  <TotalsSummary totals={totals} currency={data.currency} discountPct={data.discount_pct} taxPct={data.tax_pct} />
                </section>
              );
          }
        })}
      </div>
    </article>
  );
}

