"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import "@/styles/workspace.css";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { MONTHS, WDL, diffDays, today } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import { ActivityList, activityKind, type ActivityKind } from "./activity-line";
import type { ActivityRow } from "./lite";

const TYPES: { id: ActivityKind | "all"; name: string }[] = [
  { id: "all", name: "Tout" },
  { id: "task", name: "Tâches" },
  { id: "project", name: "Projets" },
  { id: "crm", name: "CRM" },
  { id: "proposal", name: "Propositions" },
];

function dayLabel(ts: string) {
  const d = new Date(ts);
  const n = diffDays(d, today());
  if (n === 0) return "Aujourd'hui";
  if (n === -1) return "Hier";
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${WDL[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}

export function ActivityView({ items, hasMore, limit }: { items: ActivityRow[]; hasMore: boolean; limit: number }) {
  const ws = useWorkspace();
  const [type, setType] = useState<ActivityKind | "all">("all");
  const [who, setWho] = useState<string>("all");

  const groups = useMemo(() => {
    const shown = items.filter((a) => (type === "all" || activityKind(a.verb) === type) && (who === "all" || a.actor_id === who));
    const g: { label: string; items: ActivityRow[] }[] = [];
    for (const a of shown) {
      const label = dayLabel(a.created_at);
      const last = g[g.length - 1];
      if (last?.label === label) last.items.push(a);
      else g.push({ label, items: [a] });
    }
    return g;
  }, [items, type, who]);

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHeader title="Activité" sub={`Tout ce qui bouge dans ${ws.workspace.name} : tâches, projets, deals et propositions.`} />
      <div className="filters" style={{ marginTop: 0 }}>
        <span className="seg" role="group" aria-label="Filtrer par type">
          {TYPES.map((t) => (
            <button key={t.id} className={type === t.id ? "on" : ""} onClick={() => setType(t.id)} aria-pressed={type === t.id}>
              {t.name}
            </button>
          ))}
        </span>
        <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filtrer par membre">
          <option value="all">Tout le monde</option>
          {ws.members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.profile.full_name}
              {m.user_id === ws.me.id ? " (moi)" : ""}
            </option>
          ))}
        </select>
      </div>

      {groups.length ? (
        groups.map((g) => (
          <section key={g.label} className="act-day" aria-label={g.label}>
            <h2>{g.label}</h2>
            <ActivityList items={g.items} />
          </section>
        ))
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <EmptyState
            icon="activity"
            title={items.length ? "Aucune activité pour ces filtres" : "Pas encore d'activité"}
            text={items.length ? "Élargis le type ou choisis une autre personne." : "Crée un projet, déplace une tâche ou fais avancer un deal : tout sera retracé ici."}
          />
        </div>
      )}

      {hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
          <Link className="btn" href={`${ws.base}/activity?n=${limit + 200}`} scroll={false}>
            Afficher plus d&apos;activité
          </Link>
        </div>
      )}
    </div>
  );
}
