"use client";

import { useEffect, useState } from "react";
import { CalendarOff, Copy, Plus, Trash2, X } from "lucide-react";

import { cleanRanges, toMin, tzLabel, type Range, type Weekly } from "@/lib/booking/engine";
import { readWeekly, WEEKDAYS, type BookingOverride, type BookingProfile } from "@/lib/booking/shared";
import { fmtDate } from "@/lib/format";
import { must, useMutate } from "@/lib/workspace/context";
import { useToast } from "@/components/ui/toast";

const nextRange = (last?: Range): Range => {
  if (!last) return ["09:00", "12:00"];
  const s = Math.min(toMin(last[1]) + 60, 22 * 60);
  const e = Math.min(s + 180, 23 * 60 + 30);
  const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return [f(s), f(e)];
};

/** Fuseaux proposés : liste complète du navigateur, chargée après le montage (pas d'écart d'hydratation) */
export function useTimezones(current: string) {
  const [zones, setZones] = useState<string[]>(() => [...new Set([current, "Europe/Paris"])].sort());
  useEffect(() => {
    try {
      const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- liste fournie par le navigateur
      setZones([...new Set([...all, current, "Europe/Paris"])].sort());
    } catch {
      /* navigateur ancien */
    }
  }, [current]);
  return zones;
}

export function AvailabilityEditor({ profile, canEdit }: { profile: BookingProfile; canEdit: boolean }) {
  const mutate = useMutate();
  const toast = useToast();
  const [weekly, setWeekly] = useState<Weekly>(() => readWeekly(profile.weekly));
  const [tz, setTz] = useState(profile.timezone);
  const [dirty, setDirty] = useState(false);
  const zones = useTimezones(profile.timezone);

  const update = (day: string, ranges: Range[]) => {
    setWeekly((w) => ({ ...w, [day]: ranges }));
    setDirty(true);
  };

  async function save() {
    const out: Weekly = {};
    for (let d = 1; d <= 7; d++) {
      const raw = weekly[String(d)] ?? [];
      const clean = cleanRanges(raw);
      if (clean.length !== raw.length) {
        toast(`${WEEKDAYS[d - 1]} : chaque plage doit finir après son début (les plages qui se chevauchent sont fusionnées).`, { error: true });
        if (raw.some((r) => toMin(r[1]) <= toMin(r[0]))) return;
      }
      out[String(d)] = clean;
    }
    const ok = await mutate(async (sb) => must(await sb.from("booking_profiles").update({ weekly: out, timezone: tz }).eq("id", profile.id)), { success: "Disponibilités enregistrées" });
    if (ok !== undefined) {
      setWeekly(out);
      setDirty(false);
    }
  }

  const copyToWeekdays = (from: string) => {
    setWeekly((w) => {
      const n = { ...w };
      for (const d of ["1", "2", "3", "4", "5"]) if (d !== from) n[d] = w[from].map((r) => [r[0], r[1]] as Range);
      return n;
    });
    setDirty(true);
  };

  return (
    <section className="bk-sec">
      <h2>
        Horaires de la semaine
        <span className="aside">
          <button className="btn btn-primary btn-sm" disabled={!canEdit || !dirty} onClick={save}>
            Enregistrer
          </button>
        </span>
      </h2>
      <p className="lead">Les créneaux proposés sont calculés dans ce fuseau, puis affichés au prospect dans le sien. L&apos;heure d&apos;été est gérée automatiquement.</p>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="bk-tzsel">Ton fuseau horaire</label>
        <select
          id="bk-tzsel"
          className="select"
          value={tz}
          disabled={!canEdit}
          onChange={(e) => {
            setTz(e.target.value);
            setDirty(true);
          }}
        >
          {zones.map((z) => (
            <option key={z} value={z}>{tzLabel(z)}{z.includes("/") ? ` · ${z.split("/")[0]}` : ""}</option>
          ))}
        </select>
      </div>
      <div className="bk-week">
        {WEEKDAYS.map((name, i) => {
          const day = String(i + 1);
          const ranges = weekly[day] ?? [];
          const on = ranges.length > 0;
          return (
            <div className="bk-wrow" key={day}>
              <label className="d">
                <input type="checkbox" className="toggle" disabled={!canEdit} checked={on} onChange={(e) => update(day, e.target.checked ? [["09:00", "12:00"], ["14:00", "18:00"]] : [])} />
                {name}
              </label>
              <div className="rs">
                {!on && <span className="off">Indisponible</span>}
                {ranges.map((r, k) => (
                  <div className="r" key={k}>
                    <input
                      type="time"
                      step={900}
                      className="input"
                      disabled={!canEdit}
                      aria-label={`${name} : début de la plage ${k + 1}`}
                      value={r[0]}
                      onChange={(e) => update(day, ranges.map((x, j) => (j === k ? [e.target.value, x[1]] : x)))}
                    />
                    <span className="faint">à</span>
                    <input
                      type="time"
                      step={900}
                      className="input"
                      disabled={!canEdit}
                      aria-label={`${name} : fin de la plage ${k + 1}`}
                      value={r[1]}
                      onChange={(e) => update(day, ranges.map((x, j) => (j === k ? [x[0], e.target.value] : x)))}
                    />
                    {canEdit && (
                      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Retirer la plage" onClick={() => update(day, ranges.filter((_, j) => j !== k))}>
                        <X size={13} />
                      </button>
                    )}
                    {canEdit && k === ranges.length - 1 && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Ajouter une plage" title="Ajouter une plage" onClick={() => update(day, [...ranges, nextRange(r)])}>
                          <Plus size={13} />
                        </button>
                        {i < 5 && (
                          <button type="button" className="btn btn-ghost btn-sm" title="Appliquer ces horaires du lundi au vendredi" onClick={() => copyToWeekdays(day)}>
                            <Copy size={12} /> Lun-ven
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function OverridesEditor({ profile, overrides, canEdit }: { profile: BookingProfile; overrides: BookingOverride[]; canEdit: boolean }) {
  const mutate = useMutate();
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const [custom, setCustom] = useState(false);
  const [range, setRange] = useState<Range>(["09:00", "12:00"]);

  async function add() {
    if (!from) return toast("Choisis au moins une date", { error: true });
    const end = to && to >= from ? to : from;
    if (custom && toMin(range[1]) <= toMin(range[0])) return toast("La fin doit être après le début", { error: true });
    const ok = await mutate(
      async (sb) =>
        must(
          await sb.from("booking_overrides").insert({
            workspace_id: profile.workspace_id,
            profile_id: profile.id,
            day_start: from,
            day_end: end,
            label: label.trim() || (custom ? "Horaires spéciaux" : "Indisponible"),
            ranges: custom ? [range] : [],
          }),
        ),
      { success: "Exception ajoutée" },
    );
    if (ok !== undefined) {
      setFrom("");
      setTo("");
      setLabel("");
      setCustom(false);
    }
  }

  return (
    <section className="bk-sec">
      <h2>Exceptions</h2>
      <p className="lead">Congés, jours fériés ou horaires spéciaux sur une date précise : ils remplacent les horaires de la semaine.</p>
      {overrides.length > 0 && (
        <div>
          {overrides.map((o) => {
            const rs = cleanRanges(o.ranges);
            return (
              <div className="bk-ov" key={o.id}>
                <CalendarOff size={15} className="faint" />
                <span className="when">
                  {o.day_start === o.day_end ? fmtDate(o.day_start, true) : `Du ${fmtDate(o.day_start)} au ${fmtDate(o.day_end, true)}`}
                  <span>
                    {o.label}
                    {rs.length ? ` : ${rs.map((r) => `${r[0]} à ${r[1]}`).join(", ")}` : ""}
                  </span>
                </span>
                {canEdit && (
                  <button className="btn btn-ghost btn-sm btn-icon" aria-label="Supprimer l'exception" onClick={() => mutate(async (sb) => must(await sb.from("booking_overrides").delete().eq("id", o.id)), { success: "Exception supprimée" })}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canEdit && (
        <div className="bk-g3" style={{ alignItems: "end" }}>
          <div className="field">
            <label htmlFor="ov-from">Du</label>
            <input id="ov-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ov-to">Au (facultatif)</label>
            <input id="ov-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ov-label">Motif</label>
            <input id="ov-label" className="input" value={label} placeholder="Congés, jour férié…" onChange={(e) => setLabel(e.target.value)} />
          </div>
          <label className="bk-inline" style={{ fontSize: "var(--fs-sm)", height: "var(--h-md)" }}>
            <input type="checkbox" className="toggle" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
            Disponible sur une plage précise
          </label>
          {custom ? (
            <div className="bk-inline">
              <input type="time" step={900} className="input" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
              <span className="faint">à</span>
              <input type="time" step={900} className="input" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
            </div>
          ) : (
            <span />
          )}
          <button className="btn" onClick={add} style={{ justifySelf: "start" }}>
            <Plus size={14} /> Ajouter l&apos;exception
          </button>
        </div>
      )}
    </section>
  );
}
