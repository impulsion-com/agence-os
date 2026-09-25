"use client";

import "@/styles/timeline.css";

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { CalendarPlus, ChevronDown, Crosshair, Layers, Plus } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, ObjIcon } from "@/components/ui/misc";
import { Menu } from "@/components/ui/overlay";
import { StatusIcon } from "@/components/ui/status";
import { STATUS, colorOf } from "@/lib/constants";
import { MONTHS, addDays, diffDays, fmtDate, iso, parseDay, today } from "@/lib/format";
import { groupTasks, isOverdue, taskProgress } from "@/lib/tasks";
import type { Task, TaskStatus } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { defaultProject, useOpenTask, useOptimisticDates, usePref, type DatePatch } from "./calendar-utils";

export type TimelineGroup = "project" | "status" | "assignee" | "none";

type Zoom = "week" | "month";
type Mode = "move" | "start" | "end";
type Row =
  | { type: "ms" }
  | { type: "g"; key: string; count: number }
  | { type: "t"; t: Task }
  | { type: "uh"; count: number }
  | { type: "u"; t: Task };

const RH = 36;
const DW: Record<Zoom, number> = { week: 32, month: 10 };
const GROUP_NAMES: Record<TimelineGroup, string> = { project: "Projet", status: "Statut", assignee: "Responsable", none: "Aucun" };
const UNPLANNED = "__unplanned";

// Début et fin affichés d'une tâche (null si aucune date)
function spanOf(t: Task): [Date, Date] | null {
  const due = parseDay(t.due_date);
  const st = parseDay(t.start_date);
  if (!due && !st) return null;
  const e = due ?? st!;
  return [st && st <= e ? st : e, e];
}
function applyDrag([s, e]: [Date, Date], mode: Mode, d: number): [Date, Date] {
  if (mode === "move") return [addDays(s, d), addDays(e, d)];
  if (mode === "start") {
    const ns = addDays(s, d);
    return [ns > e ? e : ns, e];
  }
  const ne = addDays(e, d);
  return [s, ne < s ? s : ne];
}

// Plage affichée : de quelques semaines avant la première date à quelques semaines après la dernière
function computeRange(list: Task[], zoom: Zoom, weekStart: number, tKey: string) {
  const t0 = parseDay(tKey)!;
  let min = addDays(t0, zoom === "week" ? -21 : -60);
  let max = addDays(t0, zoom === "week" ? 70 : 200);
  for (const t of list) {
    const sp = spanOf(t);
    if (!sp) continue;
    if (sp[0] < min) min = sp[0];
    if (sp[1] > max) max = sp[1];
  }
  const floor = addDays(t0, -730);
  const ceil = addDays(t0, 730);
  if (min < floor) min = floor;
  if (max > ceil) max = ceil;
  min = addDays(min, -7);
  const rs = addDays(min, -((min.getDay() - weekStart + 7) % 7));
  const n = diffDays(max, rs) + (zoom === "week" ? 28 : 60);
  return { rs, nDays: Math.ceil(n / 7) * 7 };
}

interface DragState {
  id: string;
  mode: Mode;
  days: number;
}

/**
 * Timeline (Gantt) : barres du début à l'échéance, jalons, dépendances, glisser pour déplacer
 * ou redimensionner (optimiste puis sauvegarde), tâches non planifiées à planifier.
 */
export function TimelineView({ tasks, group, projectId }: { tasks: Task[]; group?: TimelineGroup; projectId?: string }) {
  const ws = useWorkspace();
  const ui = useUI();
  const openTask = useOpenTask();
  const { list, save } = useOptimisticDates(tasks);
  const singleProject = useMemo(() => new Set(tasks.map((t) => t.project_id)).size <= 1, [tasks]);
  const [zoom, setZoom] = usePref<Zoom>("gt-zoom", ["week", "month"] as const, "week");
  const [ownGroup, setOwnGroup] = usePref<TimelineGroup>("gt-group", ["project", "status", "assignee", "none"] as const, "project");
  const g0: TimelineGroup = group ?? ownGroup;
  const g: TimelineGroup = g0 === "project" && singleProject ? "status" : g0;
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const weekStart = ws.me.prefs?.weekStart ?? 1;
  const dw = DW[zoom];
  const proj = defaultProject(tasks, projectId);

  // ----- Plage de dates -----
  const tKey = iso(today());
  const { rs, nDays } = useMemo(() => computeRange(list, zoom, weekStart, tKey), [list, zoom, weekStart, tKey]);
  const W = nDays * dw;
  const X = useCallback((d: Date) => diffDays(d, rs) * dw, [rs, dw]);
  const todayX = diffDays(today(), rs) * dw;

  // ----- Lignes -----
  const { rows, milestones, unplanned } = useMemo(() => {
    const planned = list.filter((t) => spanOf(t));
    const unplanned = list.filter((t) => !spanOf(t));
    const milestones = planned.filter((t) => t.milestone);
    const byStart = (a: Task, b: Task) => spanOf(a)![0].getTime() - spanOf(b)![0].getTime() || spanOf(a)![1].getTime() - spanOf(b)![1].getTime() || a.number - b.number;
    const rows: Row[] = [];
    if (milestones.length) rows.push({ type: "ms" });
    const groups = groupTasks(planned, g).filter((x) => x.tasks.length);
    if (g === "project") groups.sort((a, b) => (ws.project(a.key)?.name ?? "").localeCompare(ws.project(b.key)?.name ?? "", "fr"));
    if (g === "assignee") groups.sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : (ws.member(a.key)?.profile.full_name ?? "").localeCompare(ws.member(b.key)?.profile.full_name ?? "", "fr")));
    for (const G of groups) {
      if (g !== "none") rows.push({ type: "g", key: G.key, count: G.tasks.length });
      if (g === "none" || !closed.has(G.key)) for (const t of [...G.tasks].sort(byStart)) rows.push({ type: "t", t });
    }
    if (unplanned.length) {
      rows.push({ type: "uh", count: unplanned.length });
      if (!closed.has(UNPLANNED)) for (const t of unplanned) rows.push({ type: "u", t });
    }
    return { rows, milestones, unplanned };
  }, [list, g, closed, ws]);

  const H = rows.length * RH;
  const rowY = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r, i) => {
      if (r.type === "t") m[r.t.id] = i * RH + RH / 2;
    });
    return m;
  }, [rows]);

  // Dates affichées (avec l'éventuel glisser en cours)
  const spanNow = useCallback(
    (t: Task): [Date, Date] | null => {
      const sp = spanOf(t);
      if (!sp) return null;
      return drag && drag.id === t.id ? applyDrag(sp, drag.mode, drag.days) : sp;
    },
    [drag],
  );

  // ----- Défilement et hauteur -----
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const centerToday = (smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const lw = el.querySelector<HTMLElement>(".gt-corner")?.offsetWidth ?? 300;
    el.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - lw) * 0.3), behavior: smooth ? "smooth" : "auto" });
  };
  useLayoutEffect(() => {
    centerToday(false);
    // Recentrage uniquement au montage et au changement d'échelle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      const scroller = el.closest(".content") as HTMLElement | null;
      const top = el.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
      el.style.setProperty("--gt-top", `${Math.round(top)}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // ----- Glisser (pointeur) -----
  const live = useRef({ list, dw, save, openTask, canWrite: ws.canWrite });
  useLayoutEffect(() => {
    live.current = { list, dw, save, openTask, canWrite: ws.canWrite };
  });
  const gesture = useRef<{ id: string; mode: Mode; x0: number; sl0: number; moved: boolean; days: number } | null>(null);

  const commit = useCallback((id: string, mode: Mode, days: number) => {
    const t = live.current.list.find((x) => x.id === id);
    const sp = t && spanOf(t);
    if (!t || !sp || !days) return;
    const [s, e] = applyDrag(sp, mode, days);
    const patch: DatePatch = { due_date: iso(e) };
    if (t.start_date || mode === "start" || diffDays(e, s) > 0) patch.start_date = iso(s);
    const msg = t.milestone || iso(s) === iso(e) ? `Échéance au ${fmtDate(e)}` : `Du ${fmtDate(s)} au ${fmtDate(e)}`;
    void live.current.save(t, patch, { success: msg });
  }, []);

  const handlers = useMemo(
    () => ({
      down(e: RPointerEvent<HTMLElement>, id: string) {
        if (e.button !== 0) return;
        const hd = (e.target as HTMLElement).closest<HTMLElement>(".hd");
        const mode: Mode = hd ? (hd.classList.contains("l") ? "start" : "end") : "move";
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = { id, mode, x0: e.clientX, sl0: scrollRef.current?.scrollLeft ?? 0, moved: false, days: 0 };
      },
      move(e: RPointerEvent<HTMLElement>) {
        const gs = gesture.current;
        if (!gs || !live.current.canWrite) return;
        const sc = scrollRef.current;
        // Défilement automatique près des bords
        if (sc) {
          const r = sc.getBoundingClientRect();
          if (e.clientX > r.right - 40) sc.scrollLeft += 12;
          else if (e.clientX < r.left + (sc.querySelector<HTMLElement>(".gt-corner")?.offsetWidth ?? 0) + 40) sc.scrollLeft -= 12;
        }
        const dx = e.clientX - gs.x0 + ((sc?.scrollLeft ?? 0) - gs.sl0);
        if (!gs.moved && Math.abs(dx) < 4) return;
        const first = !gs.moved;
        gs.moved = true;
        const days = Math.round(dx / live.current.dw);
        if (days !== gs.days || first) {
          gs.days = days;
          setDrag({ id: gs.id, mode: gs.mode, days });
        }
      },
      up() {
        const gs = gesture.current;
        gesture.current = null;
        setDrag(null);
        if (!gs) return;
        if (!gs.moved) live.current.openTask(gs.id);
        else commit(gs.id, gs.mode, gs.days);
      },
      cancel() {
        gesture.current = null;
        setDrag(null);
      },
      key(e: KeyboardEvent<HTMLElement>, id: string) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          live.current.openTask(id);
        } else if (live.current.canWrite && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          commit(id, e.shiftKey ? "end" : "move", e.key === "ArrowLeft" ? -1 : 1);
        }
      },
    }),
    [commit],
  );

  const schedule = (t: Task) => {
    const s = today();
    const e = t.milestone ? s : addDays(s, 2);
    void save(t, { start_date: t.milestone ? null : iso(s), due_date: iso(e) }, { success: `Planifiée du ${fmtDate(s)} au ${fmtDate(e)}` });
  };
  const toggle = (k: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // ----- Couleurs -----
  const barColor = useCallback(
    (t: Task) => (g === "project" || singleProject ? `var(--st-${t.status})` : colorOf(ws.project(t.project_id)?.color)),
    [g, singleProject, ws],
  );

  // ----- En-tête -----
  const scale = useMemo(() => {
    const months: { d: Date; n: number }[] = [];
    for (let i = 0; i < nDays; i++) {
      const d = addDays(rs, i);
      const last = months[months.length - 1];
      if (!last || last.d.getMonth() !== d.getMonth()) months.push({ d, n: 1 });
      else last.n++;
    }
    return months;
  }, [rs, nDays]);
  const tIso = tKey;

  // Arrière-plan : week-ends, séparateurs de semaines et lignes, en dégradés répétés (léger avec 200 tâches)
  const weIdx = (6 - weekStart + 7) % 7;
  const bg = {
    backgroundImage: [
      `repeating-linear-gradient(180deg, transparent 0 ${RH - 1}px, var(--divider) ${RH - 1}px ${RH}px)`,
      `repeating-linear-gradient(90deg, var(--divider) 0 1px, transparent 1px ${7 * dw}px)`,
      `repeating-linear-gradient(90deg, color-mix(in srgb, var(--text) 3.5%, transparent) 0 ${2 * dw}px, transparent ${2 * dw}px ${7 * dw}px)`,
    ].join(","),
    backgroundPosition: `0 0, 0 0, ${weIdx * dw}px 0`,
  };

  // ----- Dépendances -----
  const deps = useMemo(() => {
    const out: { d: string; bad: boolean; hi: boolean; key: string }[] = [];
    const byId = new Map(list.map((t) => [t.id, t]));
    for (const t of list) {
      if (!t.depends_on.length || rowY[t.id] === undefined) continue;
      const st = spanNow(t);
      if (!st) continue;
      for (const pid of t.depends_on) {
        const p = byId.get(pid);
        if (!p || rowY[pid] === undefined) continue;
        const sp = spanNow(p);
        if (!sp) continue;
        const x1 = p.milestone ? X(sp[1]) + dw / 2 + 8 : X(sp[1]) + dw;
        const y1 = rowY[pid];
        const x2 = t.milestone ? X(st[1]) + dw / 2 - 8 : X(st[0]);
        const y2 = rowY[t.id];
        const bad = st[0] < sp[1] || (st[0].getTime() === sp[1].getTime() && !p.milestone && !t.milestone);
        let d: string;
        if (x2 - x1 >= 20) {
          const mx = (x1 + x2) / 2;
          d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 2} ${y2}`;
        } else {
          const ym = y2 > y1 ? y2 - RH / 2 : y2 + RH / 2;
          d = `M${x1} ${y1} h8 Q${x1 + 12} ${y1} ${x1 + 12} ${y1 + (ym > y1 ? 4 : -4)} V${ym + (ym > y1 ? -4 : 4)} Q${x1 + 12} ${ym} ${x1 + 8} ${ym} H${x2 - 12} Q${x2 - 16} ${ym} ${x2 - 16} ${ym + (y2 > ym ? 4 : -4)} V${y2 + (y2 > ym ? -4 : 4)} Q${x2 - 16} ${y2} ${x2 - 12} ${y2} H${x2 - 2}`;
        }
        out.push({ d, bad, hi: hover === t.id || hover === pid, key: `${pid}-${t.id}` });
      }
    }
    return out;
  }, [list, rowY, spanNow, X, dw, hover]);

  // Étiquettes des jalons sans chevauchement
  const msLabels = useMemo(() => {
    const pts = milestones.map((t) => ({ t, x: X(spanNow(t)![1]) + dw / 2, max: 260 })).sort((a, b) => a.x - b.x);
    pts.forEach((p, i) => {
      if (pts[i + 1]) p.max = Math.min(260, pts[i + 1].x - p.x - 26);
    });
    return pts;
  }, [milestones, X, spanNow, dw]);

  // ----- Rendu -----
  if (!tasks.length)
    return (
      <div className="gantt" ref={rootRef} style={{ height: "auto", minHeight: 0 }}>
        <EmptyState icon="chart-gantt" title="Rien sur la timeline" text="Donne une date de début et une échéance à tes tâches pour les voir ici.">
          {ws.canWrite && (
            <button className="btn btn-primary btn-sm" onClick={() => ui.create({ kind: "task", defaults: { project_id: proj } })}>
              <Plus size={14} />
              Nouvelle tâche
            </button>
          )}
        </EmptyState>
      </div>
    );

  const groupLabel = (key: string) => {
    if (g === "project") {
      const p = ws.project(key);
      return { icon: p ? <ObjIcon icon={p.icon} color={p.color} size={18} /> : null, name: p?.name ?? "Projet" };
    }
    if (g === "status") return { icon: <StatusIcon status={key as TaskStatus} size={13} />, name: STATUS[key as TaskStatus]?.name ?? key };
    const m = ws.member(key);
    return { icon: <Avatar profile={m?.profile ?? null} size={18} title={false} />, name: m?.profile.full_name ?? "Non assigné" };
  };

  return (
    <div className="gantt" ref={rootRef}>
      <div className="gt-tools">
        <div className="seg" role="tablist" aria-label="Échelle">
          {([["week", "Semaines"], ["month", "Mois"]] as const).map(([k, n]) => (
            <button key={k} role="tab" aria-selected={zoom === k} className={zoom === k ? "on" : ""} onClick={() => setZoom(k)}>
              {n}
            </button>
          ))}
        </div>
        {!group && (
          <Menu
            trigger={(open) => (
              <button className="btn btn-sm" onClick={open}>
                <Layers size={13} />
                Regrouper : {GROUP_NAMES[g]}
                <ChevronDown size={13} className="faint" />
              </button>
            )}
            items={(["project", "status", "assignee", "none"] as const).map((k) => ({ label: GROUP_NAMES[k], checked: g0 === k, onSelect: () => setOwnGroup(k) }))}
          />
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => centerToday(true)}>
          <Crosshair size={14} />
          Aujourd&apos;hui
        </button>
        <span className="sp" />
        {ws.canWrite && <span className="hint">Glisse une barre pour la déplacer, ses bords pour changer les dates.</span>}
      </div>

      <div className="gt-scroll" ref={scrollRef}>
        <div className="gt-inner" style={{ width: `calc(var(--gt-lw) + ${W}px)` }}>
          <div className="gt-head">
            <div className="gt-corner">
              <span>Tâche</span>
              <span className="num">{list.length}</span>
            </div>
            <div className="gt-scale" style={{ width: W }}>
              <div className="gt-months">
                {scale.map((m) => (
                  <div key={iso(m.d)} style={{ width: m.n * dw }}>
                    {m.n * dw > 60 ? `${MONTHS[m.d.getMonth()]} ${m.d.getFullYear()}` : ""}
                  </div>
                ))}
              </div>
              {zoom === "week" ? (
                <div className="gt-days">
                  {Array.from({ length: nDays }, (_, i) => {
                    const d = addDays(rs, i);
                    const ds = iso(d);
                    const we = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <div key={ds} style={{ width: dw }} className={`${d.getDay() === weekStart ? "wk" : ""}${we ? " we" : ""}${ds === tIso ? " today" : ""}`}>
                        {d.getDate()}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="gt-days m">
                  {Array.from({ length: nDays / 7 }, (_, i) => {
                    const d = addDays(rs, i * 7);
                    return (
                      <div key={i} style={{ width: dw * 7 }}>
                        {d.getDate()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="gt-body">
            <div className="gt-left">
              {rows.map((r) => {
                if (r.type === "ms")
                  return (
                    <div key="ms" className="gt-row msr">
                      <span className="ms-ic" style={{ ["--c" as string]: "var(--text-2)" }} />
                      Jalons
                      <span className="faint" style={{ fontWeight: 500 }}>{milestones.length}</span>
                    </div>
                  );
                if (r.type === "g") {
                  const gl = groupLabel(r.key);
                  const isClosed = closed.has(r.key);
                  return (
                    <button key={`g-${r.key}`} className={`gt-row g${isClosed ? " closed" : ""}`} onClick={() => toggle(r.key)} aria-expanded={!isClosed}>
                      <span className="chev"><ChevronDown size={13} /></span>
                      {gl.icon}
                      <span className="trunc" style={{ flex: "0 1 auto" }}>{gl.name}</span>
                      <span className="cnt">{r.count}</span>
                    </button>
                  );
                }
                if (r.type === "uh") {
                  const isClosed = closed.has(UNPLANNED);
                  return (
                    <button key="uh" className={`gt-row g${isClosed ? " closed" : ""}`} onClick={() => toggle(UNPLANNED)} aria-expanded={!isClosed}>
                      <span className="chev"><ChevronDown size={13} /></span>
                      <CalendarPlus size={13} />
                      <span className="trunc" style={{ flex: "0 1 auto" }}>Non planifiées</span>
                      <span className="cnt">{r.count}</span>
                    </button>
                  );
                }
                return <LeftRow key={r.t.id} t={r.t} onOpen={openTask} showKey={!singleProject} onHover={setHover} />;
              })}
            </div>

            <div className="gt-grid" style={{ width: W, height: H, ...bg }}>
              {rows.map((r, i) =>
                r.type === "g" || r.type === "uh" ? <div key={`b${i}`} className="gt-gband" style={{ top: i * RH }} /> : null,
              )}
              <div className="gt-today" style={{ left: todayX + dw / 2 }} title="Aujourd'hui" />

              {rows.map((r, i) => {
                const y = i * RH;
                if (r.type === "ms")
                  return msLabels.map(({ t, x, max }) => (
                    <MsLabel key={`msl-${t.id}`} t={t} x={x} y={y} max={max} color={colorOf(ws.project(t.project_id)?.color)} onOpen={openTask} />
                  ));
                if (r.type === "u")
                  return ws.canWrite ? (
                    <button key={`u-${r.t.id}`} className="gt-ghost" style={{ left: todayX + 6, top: y + 6 }} onClick={() => schedule(r.t)}>
                      <CalendarPlus size={12} />
                      Planifier à partir d&apos;aujourd&apos;hui
                    </button>
                  ) : null;
                if (r.type !== "t") return null;
                const t = r.t;
                const sp = spanNow(t)!;
                const isDrag = drag?.id === t.id;
                return (
                  <Bar
                    key={t.id}
                    t={t}
                    s={iso(sp[0])}
                    e={iso(sp[1])}
                    x={X(sp[0])}
                    w={(diffDays(sp[1], sp[0]) + 1) * dw}
                    xe={X(sp[1])}
                    dw={dw}
                    y={y}
                    color={barColor(t)}
                    dragging={isDrag}
                    tip={isDrag ? (drag.mode === "move" || t.milestone ? `${fmtDate(sp[0])} au ${fmtDate(sp[1])}` : drag.mode === "start" ? fmtDate(sp[0]) : fmtDate(sp[1])) : null}
                    canWrite={ws.canWrite}
                    h={handlers}
                    onHover={setHover}
                  />
                );
              })}

              <svg className="gt-deps" width={W} height={H} aria-hidden>
                <defs>
                  <marker id="gt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M1 1L7 4L1 7" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--text-4)" }} />
                  </marker>
                  <marker id="gt-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M1 1L7 4L1 7" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--red)", strokeDasharray: "none" }} />
                  </marker>
                  <marker id="gt-arrow-hi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M1 1L7 4L1 7" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--accent)" }} />
                  </marker>
                </defs>
                {deps.map((p) => (
                  <path key={p.key} d={p.d} className={p.hi ? "hi" : p.bad ? "bad" : ""} markerEnd={`url(#${p.hi ? "gt-arrow-hi" : p.bad ? "gt-arrow-bad" : "gt-arrow"})`} />
                ))}
              </svg>
            </div>
          </div>
          {!rows.some((r) => r.type === "t") && unplanned.length > 0 && (
            <div style={{ position: "sticky", left: 0, width: "min(100%, 100vw)" }}>
              <EmptyState icon="chart-gantt" title="Aucune tâche planifiée" text="Planifie une tâche pour la voir apparaître sur la timeline." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const LeftRow = memo(function LeftRow({ t, onOpen, showKey, onHover }: { t: Task; onOpen: (id: string) => void; showKey: boolean; onHover: (id: string | null) => void }) {
  const ws = useWorkspace();
  const p = ws.project(t.project_id);
  const m = ws.member(t.assignee_id);
  const done = t.subtasks.filter((s) => s.done).length;
  return (
    <button
      className={`gt-row${t.status === "done" ? " done" : ""}`}
      onClick={() => onOpen(t.id)}
      onMouseEnter={() => onHover(t.id)}
      onMouseLeave={() => onHover(null)}
      title={t.title}
    >
      {t.milestone ? <span className="ms-ic" style={{ ["--c" as string]: colorOf(p?.color) }} aria-label="Jalon" /> : <StatusIcon status={t.status} size={13} />}
      {showKey && p && <span className="key">{p.key}-{t.number}</span>}
      <span className="trunc">{t.title}</span>
      {t.subtasks.length > 0 && (
        <span className="sub" title="Sous-tâches terminées">
          {done}/{t.subtasks.length}
        </span>
      )}
      {m && <Avatar profile={m.profile} size={18} />}
    </button>
  );
});

interface BarProps {
  t: Task;
  s: string;
  e: string;
  x: number;
  w: number;
  xe: number;
  dw: number;
  y: number;
  color: string;
  dragging: boolean;
  tip: string | null;
  canWrite: boolean;
  onHover: (id: string | null) => void;
  h: {
    down: (e: RPointerEvent<HTMLElement>, id: string) => void;
    move: (e: RPointerEvent<HTMLElement>) => void;
    up: () => void;
    cancel: () => void;
    key: (e: KeyboardEvent<HTMLElement>, id: string) => void;
  };
}

const Bar = memo(function Bar({ t, s, e, x, w, xe, dw, y, color, dragging, tip, canWrite, h, onHover }: BarProps) {
  const ws = useWorkspace();
  const m = ws.member(t.assignee_id);
  const done = t.status === "done";
  const common = {
    role: "button",
    tabIndex: 0,
    "aria-label": `${t.title}, ${s === e ? fmtDate(e) : `du ${fmtDate(s)} au ${fmtDate(e)}`}${canWrite ? ". Flèches pour déplacer, Maj + flèches pour changer l'échéance" : ""}`,
    onPointerDown: (ev: RPointerEvent<HTMLElement>) => h.down(ev, t.id),
    onPointerMove: h.move,
    onPointerUp: h.up,
    onPointerCancel: h.cancel,
    onKeyDown: (ev: KeyboardEvent<HTMLElement>) => h.key(ev, t.id),
    onMouseEnter: () => onHover(t.id),
    onMouseLeave: () => onHover(null),
  };
  if (t.milestone) {
    const cx = xe + dw / 2;
    return (
      <>
        <div
          {...common}
          className={`gt-ms${done ? " done" : ""}${canWrite ? "" : " ro"}${dragging ? " dragging" : ""}`}
          style={{ left: cx, top: y + 11, ["--c" as string]: color }}
          title={`${t.title} · ${fmtDate(e)}`}
        />
        <div className="gt-out" style={{ left: cx + 14, top: y + 6 }}>
          <span className="trunc" style={{ maxWidth: 260 }}>{t.title}</span>
        </div>
        {tip && <div className="gt-tip" style={{ left: cx, top: y + 6 }}>{tip}</div>}
      </>
    );
  }
  const prog = taskProgress(t);
  const inside = w >= 120;
  return (
    <>
      <div
        {...common}
        className={`gt-bar${done ? " done" : ""}${isOverdue(t) ? " late" : ""}${canWrite ? "" : " ro"}${dragging ? " dragging" : ""}`}
        style={{ left: x, top: y + 6, width: w, ["--c" as string]: color }}
        title={`${t.title} · ${s === e ? fmtDate(e) : `${fmtDate(s)} au ${fmtDate(e)}`}`}
      >
        {prog > 0 && <span className={`pf${prog >= 100 ? " full" : ""}`} style={{ width: `${prog}%` }} />}
        {inside && (
          <span className="lbl">
            {m && <Avatar profile={m.profile} size={16} title={false} />}
            <span className="trunc">{t.title}</span>
          </span>
        )}
        {canWrite && (
          <>
            <span className="hd l" aria-hidden />
            <span className="hd r" aria-hidden />
          </>
        )}
      </div>
      {!inside && (
        <div className="gt-out" style={{ left: x + w + 8, top: y + 6 }}>
          {m && <Avatar profile={m.profile} size={16} title={false} />}
          <span>{t.title}</span>
        </div>
      )}
      {tip && <div className="gt-tip" style={{ left: x + w / 2, top: y + 6 }}>{tip}</div>}
    </>
  );
});

const MsLabel = memo(function MsLabel({ t, x, y, max, color, onOpen }: { t: Task; x: number; y: number; max: number; color: string; onOpen: (id: string) => void }) {
  return (
    <>
      <button className={`gt-ms ro${t.status === "done" ? " done" : ""}`} style={{ left: x, top: y + 11, ["--c" as string]: color }} onClick={() => onOpen(t.id)} title={`${t.title} · ${fmtDate(t.due_date)}`} aria-label={`Jalon ${t.title}`} />
      {max > 36 && (
        <span className="gt-msl trunc" style={{ left: x + 13, top: y + 11, maxWidth: max }}>
          {t.title}
        </span>
      )}
    </>
  );
});
