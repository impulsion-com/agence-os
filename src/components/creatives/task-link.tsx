"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Plus, X } from "lucide-react";

import "@/styles/creatives.css";
import { Menu } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import type { ConceptFormat, ConceptStatus } from "@/lib/creatives/constants";
import { ConceptCreateModal } from "./concept-create";
import { Cover, StatusBadge } from "./parts";

interface Row {
  id: string;
  title: string;
  hook: string;
  format: ConceptFormat;
  status: ConceptStatus;
  company_id: string | null;
  task_id: string | null;
}

/** Une tâche porte-t-elle l'étiquette « Créa » ? (à utiliser pour afficher CreativeTaskLink) */
export const isCreativeTask = (labelNames: string[]) => labelNames.some((n) => /^cr[ée]a/i.test(n.trim()));

/**
 * Concepts créatifs liés à une tâche : liste, liaison d'un concept existant, création
 * d'un concept pré-rempli (client et projet de la tâche). Autonome : charge et écrit
 * lui-même via le client navigateur (RLS). À placer dans le tiroir ou la page d'une tâche.
 *
 *   {isCreativeTask(labels.map((l) => l.name)) && <CreativeTaskLink taskId={task.id} projectId={task.project_id} />}
 */
export function CreativeTaskLink({ taskId, projectId, taskTitle }: { taskId: string; projectId: string; taskTitle?: string }) {
  const ws = useWorkspace();
  const toast = useToast();
  const company = ws.project(projectId)?.company_id ?? null;
  const [linked, setLinked] = useState<Row[] | null>(null);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const cols = "id, title, hook, format, status, company_id, task_id";
    let q = sb.from("creative_concepts").select(cols).eq("workspace_id", ws.workspace.id).order("updated_at", { ascending: false }).limit(200);
    if (company) q = q.eq("company_id", company);
    const [mine, all] = await Promise.all([sb.from("creative_concepts").select(cols).eq("task_id", taskId).order("created_at"), q]);
    setLinked((mine.data ?? []) as Row[]);
    setCandidates(((all.data ?? []) as Row[]).filter((r) => r.task_id !== taskId));
  }, [taskId, company, ws.workspace.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const setTask = async (r: Row, task: string | null) => {
    const { error } = await supabaseBrowser()
      .from("creative_concepts")
      .update({ task_id: task, ...(task ? { project_id: projectId } : {}) })
      .eq("id", r.id);
    if (error) return toast(error.message, { error: true });
    toast(task ? "Concept lié à la tâche" : "Concept délié");
    void load();
  };

  return (
    <div className="crv-tasklink">
      {linked?.map((r) => (
        <div className="it" key={r.id}>
          <Cover title={r.title} hook={r.hook} format={r.format} color={ws.company(r.company_id)?.color} size="sm" />
          <Link href={`${ws.base}/creatives/${r.id}`} className="trunc" style={{ flex: 1, fontWeight: 500 }}>
            {r.title}
          </Link>
          <StatusBadge status={r.status} />
          {ws.canWrite && (
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setTask(r, null)} aria-label={`Délier ${r.title}`} title="Délier de la tâche">
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      {ws.canWrite && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Menu
            search="Rechercher un concept…"
            width={300}
            items={
              candidates.length
                ? candidates.map((r) => ({ label: r.title, sub: r.task_id ? "lié à une autre tâche" : undefined, onSelect: () => setTask(r, taskId) }))
                : [{ label: "Aucun concept pour ce client", heading: true }]
            }
            trigger={(open) => (
              <button type="button" className="btn btn-sm" onClick={open}>
                <Link2 size={13} /> Lier un concept
              </button>
            )}
          />
          <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
            <Plus size={13} /> Nouveau concept
          </button>
        </div>
      )}
      {creating && (
        <ConceptCreateModal
          onClose={() => setCreating(false)}
          defaults={{ task_id: taskId, project_id: projectId, company_id: company, status: "brief", title: taskTitle ? "" : undefined }}
        />
      )}
    </div>
  );
}
