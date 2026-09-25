"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Check, ChevronDown } from "lucide-react";

import "@/styles/reporting.css";
import { Popover } from "@/components/ui/overlay";
import { fmtDate } from "@/lib/format";
import { PERIODS, rangeLabel, type Period } from "@/lib/ads/metrics";

/** Sélecteur de période : préréglages en liste, plage personnalisée en pied. Écrit dans l'URL. */
export function PeriodPicker({ period }: { period: Period }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [from, setFrom] = useState(period.start);
  const [to, setTo] = useState(period.end);

  const go = (params: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.push(`${path}?${q}`, { scroll: false });
  };

  return (
    <div className="rp-filters" style={{ marginBottom: 0 }}>
      <Popover
        width={280}
        trigger={(open, isOpen) => (
          <button type="button" className="btn" onClick={open} aria-haspopup="dialog" aria-expanded={isOpen}>
            <CalendarRange size={14} />
            {period.key === "custom" ? rangeLabel(period.start, period.end) : PERIODS.find((p) => p.id === period.key)?.name}
            <ChevronDown size={13} className="faint" />
          </button>
        )}
      >
        {(close) => (
          <div className="rp-period-pop">
            {PERIODS.filter((p) => p.id !== "custom").map((p) => (
              <button
                key={p.id}
                type="button"
                className="mi"
                onClick={() => {
                  go({ period: p.id, from: null, to: null });
                  close();
                }}
              >
                <span>{p.name}</span>
                {period.key === p.id && <Check size={16} strokeWidth={2.6} aria-label="sélectionné" />}
              </button>
            ))}
            <form
              className="custom"
              onSubmit={(e) => {
                e.preventDefault();
                if (!from || !to || from > to) return;
                go({ period: "custom", from, to });
                close();
              }}
            >
              <span className="label">Plage personnalisée</span>
              <div className="row">
                <label className="field">
                  <span className="sr">Du</span>
                  <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Date de début" />
                </label>
                <label className="field">
                  <span className="sr">Au</span>
                  <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Date de fin" />
                </label>
              </div>
              <button className="btn btn-sm btn-primary" type="submit" disabled={!from || !to || from > to}>
                Appliquer
              </button>
            </form>
          </div>
        )}
      </Popover>
      <span className="cmp">
        Comparaison : {fmtDate(period.prevStart)} au {fmtDate(period.prevEnd, true)}
      </span>
    </div>
  );
}
