"use client";

import { useState, type ReactNode } from "react";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Tag, UserRound } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { LabelChip, ObjIcon } from "@/components/ui/misc";
import { MenuList, Popover } from "@/components/ui/overlay";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { PRIORITIES, PRIORITY, STATUS, STATUSES, colorOf } from "@/lib/constants";
import { MONTHS, addDays, diffDays, fmtDate, iso, parseDay, relDate, today } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import type { Priority, TaskStatus } from "@/lib/types";

type Trigger = (open: (e: React.MouseEvent) => void) => ReactNode;

export function StatusPicker({ value, onChange, trigger, compact }: { value: TaskStatus; onChange: (v: TaskStatus) => void; trigger?: Trigger; compact?: boolean }) {
  return (
    <Popover
      trigger={(open) =>
        trigger ? trigger(open) : (
          <button type="button" className="pill" onClick={open} title={STATUS[value].name}>
            <StatusIcon status={value} />
            {!compact && <span>{STATUS[value].name}</span>}
          </button>
        )
      }
    >
      {(close) => (
        <MenuList
          onClose={close}
          search="Changer le statut…"
          items={STATUSES.map((s, i) => ({ label: s.name, icon: <StatusIcon status={s.id} />, checked: s.id === value, sub: String(i + 1), onSelect: () => onChange(s.id) }))}
        />
      )}
    </Popover>
  );
}

export function PriorityPicker({ value, onChange, trigger, compact }: { value: Priority; onChange: (v: Priority) => void; trigger?: Trigger; compact?: boolean }) {
  return (
    <Popover
      trigger={(open) =>
        trigger ? trigger(open) : (
          <button type="button" className={`pill${value === "none" ? " empty" : ""}`} onClick={open} title={PRIORITY[value].name}>
            <PriorityIcon priority={value} />
            {!compact && <span>{PRIORITY[value].name}</span>}
          </button>
        )
      }
    >
      {(close) => (
        <MenuList
          onClose={close}
          search="Priorité…"
          items={PRIORITIES.map((p) => ({ label: p.name, icon: <PriorityIcon priority={p.id} />, checked: p.id === value, onSelect: () => onChange(p.id) }))}
        />
      )}
    </Popover>
  );
}

export function AssigneePicker({ value, onChange, trigger, compact }: { value: string | null; onChange: (v: string | null) => void; trigger?: Trigger; compact?: boolean }) {
  const ws = useWorkspace();
  const m = ws.member(value);
  return (
    <Popover
      trigger={(open) =>
        trigger ? trigger(open) : (
          <button type="button" className={`pill${m ? "" : " empty"}`} onClick={open} title={m?.profile.full_name ?? "Non assigné"}>
            {m ? <Avatar profile={m.profile} size={18} title={false} /> : <UserRound size={14} />}
            {!compact && <span className="trunc">{m?.profile.full_name ?? "Responsable"}</span>}
          </button>
        )
      }
    >
      {(close) => (
        <MenuList
          onClose={close}
          search="Assigner à…"
          items={[
            { label: "Non assigné", icon: <Avatar profile={null} size={18} />, checked: !value, onSelect: () => onChange(null) },
            ...ws.members
              .filter((x) => x.role !== "guest")
              .map((x) => ({
                label: x.profile.full_name + (x.user_id === ws.me.id ? " (moi)" : ""),
                icon: <Avatar profile={x.profile} size={18} title={false} />,
                checked: x.user_id === value,
                onSelect: () => onChange(x.user_id),
              })),
          ]}
        />
      )}
    </Popover>
  );
}

export function LabelsPicker({ value, onChange, trigger }: { value: string[]; onChange: (v: string[]) => void; trigger?: Trigger }) {
  const ws = useWorkspace();
  const [q, setQ] = useState("");
  const shown = ws.labels.filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover
      trigger={(open) =>
        trigger ? trigger(open) : (
          <button type="button" className={`pill${value.length ? "" : " empty"}`} onClick={open}>
            {value.length ? (
              <span style={{ display: "flex", gap: 4 }}>
                {value.slice(0, 2).map((id) => {
                  const l = ws.label(id);
                  return l ? <LabelChip key={id} name={l.name} color={l.color} /> : null;
                })}
                {value.length > 2 && <span className="faint">+{value.length - 2}</span>}
              </span>
            ) : (
              <>
                <Tag size={14} />
                <span>Étiquettes</span>
              </>
            )}
          </button>
        )
      }
    >
      {() => (
        <div>
          <input autoFocus className="pop-search" placeholder="Étiquettes…" value={q} onChange={(e) => setQ(e.target.value)} />
          {shown.map((l) => {
            const on = value.includes(l.id);
            return (
              <button key={l.id} type="button" className="mi" onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}>
                <input type="checkbox" className="check" readOnly checked={on} tabIndex={-1} />
                <span className="chip" style={{ ["--c" as string]: colorOf(l.color), border: 0, padding: 0, background: "transparent" }}>
                  <i />
                </span>
                {l.name}
              </button>
            );
          })}
          {!shown.length && <div className="mi faint">Aucune étiquette</div>}
        </div>
      )}
    </Popover>
  );
}

export function MiniCalendar({ value, onPick, weekStart = 1 }: { value: string | null; onPick: (d: string) => void; weekStart?: number }) {
  const init = parseDay(value) ?? today();
  const [month, setMonth] = useState(new Date(init.getFullYear(), init.getMonth(), 1));
  const first = new Date(month);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const wd = weekStart === 1 ? ["L", "M", "M", "J", "V", "S", "D"] : ["D", "L", "M", "M", "J", "V", "S"];
  const t = iso(today());
  return (
    <div style={{ padding: 6, width: 236 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <b style={{ fontSize: "var(--fs-sm)", textTransform: "capitalize" }}>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </b>
        <span style={{ display: "flex" }}>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Mois précédent" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Mois suivant" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <ChevronRight size={14} />
          </button>
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
        {wd.map((d, i) => (
          <span key={i} className="fainter" style={{ fontSize: 11, height: 22, lineHeight: "22px" }}>
            {d}
          </span>
        ))}
        {days.map((d) => {
          const s = iso(d);
          const on = s === value;
          const out = d.getMonth() !== month.getMonth();
          return (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              style={{
                height: 28, borderRadius: 6, fontSize: 12, fontVariantNumeric: "tabular-nums",
                background: on ? "var(--accent)" : undefined, color: on ? "var(--on-accent)" : out ? "var(--text-4)" : undefined,
                fontWeight: s === t ? 700 : undefined, textDecoration: s === t && !on ? "underline" : undefined,
              }}
              onMouseEnter={(e) => !on && (e.currentTarget.style.background = "var(--surface-3)")}
              onMouseLeave={(e) => !on && (e.currentTarget.style.background = "")}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DatePicker({
  value,
  onChange,
  trigger,
  placeholder = "Échéance",
  overdue,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  trigger?: Trigger;
  placeholder?: string;
  overdue?: boolean;
}) {
  const ws = useWorkspace();
  const weekStart = ws.me.prefs?.weekStart ?? 1;
  const quick: [string, number][] = [
    ["Aujourd'hui", 0],
    ["Demain", 1],
    ["Dans 1 semaine", 7],
    ["Dans 2 semaines", 14],
  ];
  return (
    <Popover
      trigger={(open) =>
        trigger ? trigger(open) : (
          <button type="button" className={`pill${value ? (overdue ? " over" : "") : " empty"}`} onClick={open} title={value ? fmtDate(value, true) : placeholder}>
            <CalIcon size={14} />
            <span>{value ? relDate(value) : placeholder}</span>
          </button>
        )
      }
    >
      {(close) => (
        <div>
          {quick.map(([l, n]) => (
            <button key={l} type="button" className="mi" onClick={() => { onChange(iso(addDays(today(), n))); close(); }}>
              {l}
              <span className="sub">{fmtDate(addDays(today(), n))}</span>
            </button>
          ))}
          <div className="mi-sep" />
          <MiniCalendar value={value} weekStart={weekStart} onPick={(d) => { onChange(d); close(); }} />
          {value && (
            <>
              <div className="mi-sep" />
              <button type="button" className="mi danger" onClick={() => { onChange(null); close(); }}>
                Retirer la date
              </button>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

export function ProjectPicker({ value, onChange, trigger }: { value: string | null; onChange: (v: string) => void; trigger?: Trigger }) {
  const ws = useWorkspace();
  const p = ws.project(value);
  return (
    <Popover
      trigger={(open) =>
        trigger ? trigger(open) : (
          <button type="button" className={`pill${p ? "" : " empty"}`} onClick={open}>
            {p ? <ObjIcon icon={p.icon} color={p.color} size={16} /> : null}
            <span className="trunc">{p?.name ?? "Projet"}</span>
          </button>
        )
      }
    >
      {(close) => (
        <MenuList
          onClose={close}
          search="Projet…"
          items={ws.projects
            .filter((x) => !x.archived_at)
            .map((x) => ({ label: x.name, icon: <ObjIcon icon={x.icon} color={x.color} size={16} />, checked: x.id === value, onSelect: () => onChange(x.id) }))}
        />
      )}
    </Popover>
  );
}

export function CompanyPicker({ value, onChange, trigger, allowNone = true }: { value: string | null; onChange: (v: string | null) => void; trigger?: Trigger; allowNone?: boolean }) {
  const ws = useWorkspace();
  const c = ws.company(value);
  return (
    <Popover
      trigger={(open) =>
        trigger ? trigger(open) : (
          <button type="button" className={`pill${c ? "" : " empty"}`} onClick={open}>
            {c && <span className="av" style={{ ["--s" as string]: "16px", ["--c" as string]: c.color, borderRadius: 4 }}>{c.name[0]}</span>}
            <span className="trunc">{c?.name ?? "Client"}</span>
          </button>
        )
      }
    >
      {(close) => (
        <MenuList
          onClose={close}
          search="Client ou prospect…"
          items={[
            ...(allowNone ? [{ label: "Aucun", checked: !value, onSelect: () => onChange(null) }] : []),
            ...ws.companies.map((x) => ({
              label: x.name,
              sub: x.status === "client" ? "client" : x.status === "lead" ? "prospect" : "ancien",
              onSelect: () => onChange(x.id),
            })),
          ]}
        />
      )}
    </Popover>
  );
}

// Échéance relative colorée (rouge si en retard)
export function DueText({ date, done }: { date: string | null; done?: boolean }) {
  if (!date) return null;
  const n = diffDays(parseDay(date)!, today());
  const color = done ? "var(--text-3)" : n < 0 ? "var(--red)" : n <= 1 ? "var(--amber)" : "var(--text-3)";
  return (
    <span style={{ color, display: "inline-flex", alignItems: "center", gap: 4 }} className="num">
      <CalIcon size={12} />
      {relDate(date)}
    </span>
  );
}
