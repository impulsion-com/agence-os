"use client";

import "@/styles/calendar.css";

import { memo, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { Avatar } from "@/components/ui/avatar";
import { Popover } from "@/components/ui/overlay";
import { StatusIcon } from "@/components/ui/status";
import { colorOf } from "@/lib/constants";
import { MONTHS, WD, WDL, addDays, fmtDate, iso, parseDay, today } from "@/lib/format";
import { isOverdue } from "@/lib/tasks";
import type { Task } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { defaultProject, movedMsg, moveToDay, useOpenTask, useOptimisticDates, usePref } from "./calendar-utils";

type Mode = "month" | "week";
const MODES = ["month", "week"] as const;
const MAX_CHIPS = 3;
const DRAG_TYPE = "application/x-aos-task";

const startOfWeek = (d: Date, ws: number) => addDays(d, -((d.getDay() - ws + 7) % 7));
const sortDay = (a: Task, b: Task) =>
  Number(b.milestone) - Number(a.milestone) || Number(a.status === "done") - Number(b.status === "done") || a.position - b.position;

/**
 * Calendrier des tâches par échéance : vue Mois ou Semaine, glisser-déposer vers un autre jour,
 * création au double-clic, panneau « Sans date ».
 */
export function CalendarView({ tasks, projectId }: { tasks: Task[]; projectId?: string }) {
  const ws = useWorkspace();
  const ui = useUI();
  const openTask = useOpenTask();
  const weekStart = ws.me.prefs?.weekStart ?? 1;
  const [mode, setMode] = usePref<Mode>("cal-mode", MODES, "month");
  const [noDatePref, setNoDateOpen] = usePref("cal-nodate", ["1", "0", "auto"] as const, "auto");
  const [cursor, setCursor] = useState(() => iso(today()));
  const [overDay, setOverDay] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const { list, save } = useOptimisticDates(tasks);
  const proj = defaultProject(tasks, projectId);

  const cur = parseDay(cursor)!;
  const tStr = iso(today());

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of list) if (t.due_date) m.set(t.due_date, [...(m.get(t.due_date) ?? []), t]);
    for (const v of m.values()) v.sort(sortDay);
    return m;
  }, [list]);
  const noDate = useMemo(() => list.filter((t) => !t.due_date).sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.position - b.position), [list]);
  // Panneau ouvert par défaut seulement s'il y a des tâches à planifier (ou pendant un glisser)
  const noDateOpen = noDatePref === "auto" ? (noDate.length > 0 || dragId ? "1" : "0") : noDatePref;

  const days = useMemo(() => {
    if (mode === "week") {
      const s = startOfWeek(cur, weekStart);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const s = startOfWeek(first, weekStart);
    const cells = Array.from({ length: 42 }, (_, i) => addDays(s, i));
    return cells[35].getMonth() !== cur.getMonth() ? cells.slice(0, 35) : cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, mode, weekStart]);

  const nav = useCallback(
    (dir: -1 | 0 | 1) => {
      if (dir === 0) return setCursor(iso(today()));
      const d = parseDay(cursor)!;
      setCursor(iso(mode === "month" ? new Date(d.getFullYear(), d.getMonth() + dir, 1) : addDays(d, 7 * dir)));
    },
    [cursor, mode],
  );

  // Raccourcis : flèches gauche/droite pour naviguer, T pour aujourd'hui
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (document.querySelector(".modal, .drawer, .palette, .pop")) return;
      if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "ArrowRight") nav(1);
      else if (e.key.toLowerCase() === "t") nav(0);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [nav]);

  const create = (day: string) => {
    if (!ws.canWrite) return;
    ui.create({ kind: "task", defaults: { due_date: day, project_id: proj } });
  };

  const drop = (day: string | null) => (e: DragEvent) => {
    e.preventDefault();
    setOverDay(null);
    setDragId(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const t = list.find((x) => x.id === id);
    if (!t || t.due_date === day) return;
    if (day === null) void save(t, { due_date: null, start_date: null }, { success: movedMsg(null) });
    else void save(t, moveToDay(t, day), { success: movedMsg(day) });
  };
  const over = (day: string) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overDay !== day) setOverDay(day);
  };
  const leave = (day: string) => (e: DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && overDay === day) setOverDay(null);
  };

  const dnd = {
    draggable: ws.canWrite,
    onStart: (id: string) => setDragId(id),
    onEnd: () => {
      setDragId(null);
      setOverDay(null);
    },
    dragId,
  };

  const label =
    mode === "month"
      ? `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`
      : `${fmtDate(days[0])} au ${fmtDate(days[6], true)}`;
  const wdNames = Array.from({ length: 7 }, (_, i) => WD[(i + weekStart) % 7]);

  // Légende : projets présents dans la période
  const legend = useMemo(() => {
    const ids = new Set<string>();
    for (const d of days) for (const t of byDay.get(iso(d)) ?? []) ids.add(t.project_id);
    return [...ids].map((id) => ws.project(id)).filter(Boolean).slice(0, 4);
  }, [days, byDay, ws]);

  return (
    <div className="cal">
      <div className="cal-bar">
        <button className="btn btn-sm" onClick={() => nav(0)} title="Aujourd'hui (T)">
          Aujourd&apos;hui
        </button>
        <span className="cal-nav">
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => nav(-1)} aria-label={mode === "month" ? "Mois précédent" : "Semaine précédente"}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => nav(1)} aria-label={mode === "month" ? "Mois suivant" : "Semaine suivante"}>
            <ChevronRight size={16} />
          </button>
        </span>
        <h2 aria-live="polite">{label}</h2>
        <span className="sp" />
        {legend.length > 1 && (
          <span className="cal-legend">
            {legend.map((p) => (
              <span key={p!.id} style={{ ["--c" as string]: colorOf(p!.color) }}>
                <i />
                <b>{p!.name}</b>
              </span>
            ))}
          </span>
        )}
        <div className="seg" role="tablist" aria-label="Affichage">
          {([["month", "Mois"], ["week", "Semaine"]] as const).map(([k, n]) => (
            <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="cal-wrap">
        <div className="cal-main">
          {mode === "month" ? (
            <>
              <div className="cal-h">
                {wdNames.map((d, i) => (
                  <div key={i}>{d.replace(".", "")}</div>
                ))}
              </div>
              <div className="cal-g" role="grid" aria-label={label}>
                {days.map((d) => {
                  const ds = iso(d);
                  const items = byDay.get(ds) ?? [];
                  const shown = items.length > MAX_CHIPS + 1 ? items.slice(0, MAX_CHIPS) : items;
                  const we = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div
                      key={ds}
                      role="gridcell"
                      className={`cday${d.getMonth() !== cur.getMonth() ? " out" : ""}${ds === tStr ? " today" : ""}${we ? " we" : ""}${overDay === ds ? " over" : ""}`}
                      onDragOver={over(ds)}
                      onDragLeave={leave(ds)}
                      onDrop={drop(ds)}
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest(".cev, .cmore, .add")) return;
                        create(ds);
                      }}
                      onClick={(e) => {
                        // Sur mobile, les tâches sont des traits : toucher un jour ouvre sa semaine
                        if ((e.target as HTMLElement).closest(".cmore, .add") || !window.matchMedia("(max-width: 760px)").matches) return;
                        setCursor(ds);
                        setMode("week");
                      }}
                    >
                      <div className="dh">
                        <span className="dn" aria-current={ds === tStr ? "date" : undefined}>
                          {d.getDate() === 1 ? fmtDate(d) : d.getDate()}
                        </span>
                        {ws.canWrite && (
                          <button className="add" onClick={() => create(ds)} aria-label={`Ajouter une tâche le ${fmtDate(d, true)}`}>
                            <Plus size={13} />
                          </button>
                        )}
                      </div>
                      {shown.map((t) => (
                        <Chip key={t.id} t={t} onOpen={openTask} {...dnd} />
                      ))}
                      {items.length > shown.length && (
                        <Popover
                          width={272}
                          trigger={(open) => (
                            <button className="cmore" onClick={open}>
                              +{items.length - shown.length} autre{items.length - shown.length > 1 ? "s" : ""}
                            </button>
                          )}
                        >
                          {(close) => (
                            <div className="daypop">
                              <h4>
                                {WDL[d.getDay()]} {fmtDate(d)}
                              </h4>
                              {items.map((t) => (
                                <Chip
                                  key={t.id}
                                  t={t}
                                  onOpen={(id) => {
                                    close();
                                    openTask(id);
                                  }}
                                  {...dnd}
                                />
                              ))}
                            </div>
                          )}
                        </Popover>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="cal-week">
              {days.map((d) => {
                const ds = iso(d);
                const items = byDay.get(ds) ?? [];
                const we = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div key={ds} className={`wcol${we ? " we" : ""}`}>
                    <div className={`wcol-h${ds === tStr ? " today" : ""}`}>
                      <span className="n">{d.getDate()}</span>
                      <span className="d">{WD[d.getDay()]}</span>
                      {ws.canWrite && (
                        <button className="add" onClick={() => create(ds)} aria-label={`Ajouter une tâche le ${fmtDate(d, true)}`}>
                          <Plus size={13} />
                        </button>
                      )}
                    </div>
                    <div
                      className={`wcol-b${overDay === ds ? " over" : ""}`}
                      onDragOver={over(ds)}
                      onDragLeave={leave(ds)}
                      onDrop={drop(ds)}
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest(".wcard")) return;
                        create(ds);
                      }}
                    >
                      {items.map((t) => (
                        <WeekCard key={t.id} t={t} onOpen={openTask} {...dnd} />
                      ))}
                      {!items.length && <span className="none">Rien de prévu</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside
          className={`nodate${noDateOpen === "1" ? "" : " closed"}${overDay === "none" ? " over" : ""}`}
          onDragOver={over("none")}
          onDragLeave={leave("none")}
          onDrop={drop(null)}
          aria-label="Tâches sans date"
        >
          <button className="nodate-h" onClick={() => setNoDateOpen(noDateOpen === "1" ? "0" : "1")} aria-expanded={noDateOpen === "1"}>
            <span>Sans date</span>
            <span className="count">{noDate.length}</span>
            <span className="chev faint">{noDateOpen === "1" ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}</span>
          </button>
          {noDateOpen === "1" && (
            <div className="nodate-b">
              {noDate.length ? (
                <>
                  {ws.canWrite && <p className="hint">Glisse une tâche sur un jour pour la planifier.</p>}
                  {noDate.map((t) => (
                    <Chip key={t.id} t={t} onOpen={openTask} {...dnd} showProject />
                  ))}
                </>
              ) : (
                <p className="hint" style={{ padding: "4px" }}>
                  Toutes les tâches ont une échéance. Dépose une tâche ici pour retirer sa date.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

interface ItemProps {
  t: Task;
  onOpen: (id: string) => void;
  draggable: boolean;
  onStart: (id: string) => void;
  onEnd: () => void;
  dragId: string | null;
  showProject?: boolean;
}

function dragStart(e: DragEvent, t: Task, onStart: (id: string) => void) {
  e.dataTransfer.setData(DRAG_TYPE, t.id);
  e.dataTransfer.setData("text/plain", t.title);
  e.dataTransfer.effectAllowed = "move";
  onStart(t.id);
}

const Chip = memo(function Chip({ t, onOpen, draggable, onStart, onEnd, dragId, showProject }: ItemProps) {
  const ws = useWorkspace();
  const p = ws.project(t.project_id);
  const m = ws.member(t.assignee_id);
  const done = t.status === "done";
  return (
    <button
      type="button"
      className={`cev${done ? " done" : ""}${t.milestone ? " is-ms" : ""}${isOverdue(t) ? " late" : ""}${dragId === t.id ? " dragging" : ""}`}
      style={{ ["--c" as string]: colorOf(p?.color) }}
      draggable={draggable}
      onDragStart={(e) => dragStart(e, t, onStart)}
      onDragEnd={onEnd}
      onClick={() => onOpen(t.id)}
      title={`${p ? `${p.key}-${t.number} · ` : ""}${t.title}${t.due_date ? ` · ${fmtDate(t.due_date)}` : ""}`}
    >
      {t.milestone ? <span className="ms-ic" aria-label="Jalon" /> : <StatusIcon status={t.status} size={12} />}
      <span className="trunc">{t.title}</span>
      {showProject && p && <span className="cal-dot" title={p.name} />}
      {m && <Avatar profile={m.profile} size={16} title={false} />}
    </button>
  );
});

const WeekCard = memo(function WeekCard({ t, onOpen, draggable, onStart, onEnd, dragId }: ItemProps) {
  const ws = useWorkspace();
  const p = ws.project(t.project_id);
  const m = ws.member(t.assignee_id);
  return (
    <button
      type="button"
      className={`wcard${t.status === "done" ? " done" : ""}${dragId === t.id ? " dragging" : ""}`}
      style={{ ["--c" as string]: colorOf(p?.color) }}
      draggable={draggable}
      onDragStart={(e) => dragStart(e, t, onStart)}
      onDragEnd={onEnd}
      onClick={() => onOpen(t.id)}
    >
      <span className="t">
        {t.milestone && <span className="ms-ic" aria-label="Jalon" />}
        <span>{t.title}</span>
      </span>
      <span className="m">
        <StatusIcon status={t.status} size={12} />
        <span className="trunc">{p ? `${p.key}-${t.number} · ${p.name}` : ""}</span>
        {m && <Avatar profile={m.profile} size={16} title={false} />}
      </span>
    </button>
  );
});
