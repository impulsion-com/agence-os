"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { GripVertical, Star } from "lucide-react";

import "@/styles/workspace.css";
import { AvatarStack } from "@/components/ui/avatar";
import { Badge, EmptyState, ObjIcon, PageHeader, Progress } from "@/components/ui/misc";
import { PROJECT_STATUS, colorOf } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import { isOverdue } from "@/lib/tasks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Profile, Project } from "@/lib/types";
import type { LiteTask } from "./lite";

export function FavoritesView({ tasks }: { tasks: LiteTask[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  // Ordre local (optimiste) : ids des projets favoris
  const [order, setOrder] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const favIds = (order ?? ws.favorites).filter((id) => {
    const p = ws.project(id);
    return p && !p.archived_at;
  });

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; done: number; overdue: number; people: Profile[] }>();
    for (const p of ws.projects) {
      const ts = tasks.filter((t) => t.project_id === p.id);
      const people = [...new Set([p.lead_id, ...ts.filter((t) => t.status !== "done").map((t) => t.assignee_id)].filter(Boolean) as string[])]
        .map((id) => ws.member(id)?.profile)
        .filter(Boolean) as Profile[];
      m.set(p.id, { total: ts.length, done: ts.filter((t) => t.status === "done").length, overdue: ts.filter((t) => isOverdue(t)).length, people });
    }
    return m;
  }, [ws, tasks]);

  const save = (ids: string[]) => {
    setOrder(ids);
    return mutate(async (sb) => {
      must(await sb.from("project_favorites").upsert(ids.map((project_id, i) => ({ project_id, user_id: ws.me.id, position: i })), { onConflict: "project_id,user_id" }).select("project_id"));
    });
  };

  const drop = (target: string) => {
    if (!drag || drag === target) return;
    const ids = favIds.filter((id) => id !== drag);
    ids.splice(ids.indexOf(target), 0, drag);
    save(ids);
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = favIds.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= favIds.length) return;
    const ids = [...favIds];
    [ids[i], ids[j]] = [ids[j], ids[i]];
    save(ids);
  };

  const unfav = (p: Project) => {
    setOrder(favIds.filter((id) => id !== p.id));
    mutate(async (sb) => must(await sb.from("project_favorites").delete().eq("project_id", p.id).eq("user_id", ws.me.id).select("project_id")), {
      success: `${p.name} retiré des favoris`,
      undo: async () => {
        setOrder(null);
        await supabaseBrowser().from("project_favorites").insert({ project_id: p.id, user_id: ws.me.id, position: favIds.indexOf(p.id) });
      },
    });
  };

  const fav = (p: Project) => {
    setOrder([...favIds, p.id]);
    mutate(async (sb) => must(await sb.from("project_favorites").insert({ project_id: p.id, user_id: ws.me.id, position: favIds.length }).select("project_id")), {
      success: `${p.name} ajouté aux favoris`,
    });
  };

  const suggestions = ws.projects.filter((p) => !p.archived_at && !favIds.includes(p.id)).slice(0, 6);

  return (
    <div className="page">
      <PageHeader title="Favoris" sub="Tes projets épinglés. Glisse les cartes pour les réordonner, l'ordre est repris dans la barre latérale." />

      {favIds.length ? (
        <div className="fav-grid" role="list">
          {favIds.map((id, i) => {
            const p = ws.project(id)!;
            const st = stats.get(id)!;
            const progress = st.total ? Math.round((st.done / st.total) * 100) : 0;
            const company = ws.company(p.company_id);
            return (
              <div
                key={id}
                role="listitem"
                className={`fav${drag === id ? " dragging" : ""}${over === id && drag !== id ? " over" : ""}`}
                draggable
                tabIndex={0}
                aria-label={`${p.name}, position ${i + 1} sur ${favIds.length}. Alt + flèches pour déplacer.`}
                onDragStart={(e) => {
                  setDrag(id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (over !== id) setOver(id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(id);
                  setOver(null);
                }}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowUp")) {
                    e.preventDefault();
                    move(id, -1);
                  } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    move(id, 1);
                  }
                }}
              >
                <div className="fav-h">
                  <GripVertical size={14} className="grip" aria-hidden />
                  <ObjIcon icon={p.icon} color={p.color} size={28} />
                  <Link href={`${ws.base}/projects/${p.key}/board`} className="trunc" title="Alt + flèches pour déplacer">
                    {p.name}
                  </Link>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => unfav(p)} aria-label={`Retirer ${p.name} des favoris`} title="Retirer des favoris">
                    <Star size={14} fill="var(--amber)" color="var(--amber)" />
                  </button>
                </div>
                <div className="fav-meta">
                  <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge>
                  {company && <span className="trunc">{company.name}</span>}
                  {p.due_date && <span className="num">Échéance {fmtDate(p.due_date)}</span>}
                </div>
                <div className="fav-meta">
                  <span>{st.total - st.done} tâche{st.total - st.done > 1 ? "s" : ""} ouverte{st.total - st.done > 1 ? "s" : ""}</span>
                  {st.overdue > 0 && <span style={{ color: "var(--red)" }}>{st.overdue} en retard</span>}
                </div>
                <div className="fav-foot">
                  <Progress value={progress} color={colorOf(p.color)} />
                  <span className="faint num" style={{ fontSize: "var(--fs-xs)" }}>{progress} %</span>
                  {st.people.length > 0 && <AvatarStack profiles={st.people} size={20} max={3} />}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState icon="star" title="Aucun favori pour l'instant" text="Épingle les projets que tu suis de près : ils restent en haut de la barre latérale et se retrouvent ici." />
        </div>
      )}

      {suggestions.length > 0 && (
        <section className="card" style={{ marginTop: 24 }} aria-labelledby="h-sugg">
          <div className="card-h">
            <h2 id="h-sugg">{favIds.length ? "Autres projets" : "Suggestions"}</h2>
          </div>
          {suggestions.map((p) => (
            <div key={p.id} className="sugg">
              <ObjIcon icon={p.icon} color={p.color} size={22} />
              <Link href={`${ws.base}/projects/${p.key}/board`} className="trunc" style={{ flex: 1 }}>{p.name}</Link>
              <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge>
              <button className="btn btn-sm" onClick={() => fav(p)}>
                <Star size={13} />
                Ajouter
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
