"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { PartyPopper, Rocket, Settings2 } from "lucide-react";

import { useUI } from "@/components/shell/ui-context";
import { Modal } from "@/components/ui/overlay";
import { PROJECT_TEMPLATES } from "@/lib/constants";
import { addDays, dayOffset, iso, today } from "@/lib/format";
import { logActivity, must, useMutate, useWorkspace, type DB } from "@/lib/workspace/context";
import type { Deal, PipelineStage } from "@/lib/types";
import { LOST_REASONS, dealAmount, projectKeyFor } from "./lib";

type Patch = Partial<Pick<Deal, "stage_id" | "position" | "closed_at" | "lost_reason">>;

/**
 * Changement d'étape d'un deal avec les effets métier :
 *  - vers « Gagné » : closed_at, journal deal.won, entreprise passée en client, proposition de projet d'onboarding ;
 *  - vers « Perdu » : demande de la raison, journal deal.lost ;
 *  - retour vers une étape ouverte : closed_at effacé, journal deal.stage.
 * `apply` met à jour l'état local (optimiste) ; il est rappelé avec l'état d'origine en cas d'annulation.
 */
export function useDealStageFlow(stages: PipelineStage[], apply: (id: string, patch: Patch) => void) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [lost, setLost] = useState<{ deal: Deal; stage: PipelineStage; position?: number } | null>(null);
  const [won, setWon] = useState<Deal | null>(null);

  const persist = useCallback(
    async (deal: Deal, stage: PipelineStage, patch: Patch, success?: string) => {
      apply(deal.id, patch);
      const prevStage = stages.find((s) => s.id === deal.stage_id);
      const res = await mutate(
        async (sb) => {
          must(await sb.from("deals").update(patch).eq("id", deal.id));
          if (stage.id !== deal.stage_id) {
            const verb = stage.kind === "won" ? "deal.won" : stage.kind === "lost" ? "deal.lost" : "deal.stage";
            await logActivity(sb, {
              workspace_id: ws.workspace.id,
              verb,
              deal_id: deal.id,
              meta: { title: deal.title, from: prevStage?.name ?? null, to: stage.name, value: deal.value, reason: patch.lost_reason ?? null },
            });
          }
          if (stage.kind === "won" && deal.company_id) {
            must(await sb.from("companies").update({ status: "client" }).eq("id", deal.company_id).neq("status", "client"));
          }
          return true;
        },
        { success },
      );
      if (!res) apply(deal.id, { stage_id: deal.stage_id, position: deal.position, closed_at: deal.closed_at, lost_reason: deal.lost_reason });
      return !!res;
    },
    [apply, mutate, stages, ws.workspace.id],
  );

  const move = useCallback(
    async (deal: Deal, stageId: string, position?: number) => {
      const stage = stages.find((s) => s.id === stageId);
      if (!stage) return;
      const pos = position !== undefined ? { position } : {};
      if (stage.id === deal.stage_id) {
        if (position !== undefined && position !== deal.position) {
          apply(deal.id, pos);
          await mutate(async (sb) => must(await sb.from("deals").update(pos).eq("id", deal.id)), { refresh: false });
        }
        return;
      }
      if (stage.kind === "lost") {
        setLost({ deal, stage, position });
        return;
      }
      if (stage.kind === "won") {
        const ok = await persist(deal, stage, { stage_id: stage.id, closed_at: new Date().toISOString(), lost_reason: "", ...pos }, "Deal gagné");
        if (ok) setWon(deal);
        return;
      }
      await persist(deal, stage, { stage_id: stage.id, closed_at: null, lost_reason: "", ...pos }, `Déplacé vers ${stage.name}`);
    },
    [apply, mutate, persist, stages],
  );

  const element = (
    <>
      {lost && (
        <LostModal
          deal={lost.deal}
          onClose={() => setLost(null)}
          onConfirm={async (reason) => {
            const { deal, stage, position } = lost;
            setLost(null);
            await persist(
              deal,
              stage,
              { stage_id: stage.id, closed_at: new Date().toISOString(), lost_reason: reason, ...(position !== undefined ? { position } : {}) },
              "Deal marqué perdu",
            );
          }}
        />
      )}
      {won && <WonModal deal={won} onClose={() => setWon(null)} />}
    </>
  );

  return { move, element };
}

function LostModal({ deal, onClose, onConfirm }: { deal: Deal; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Marquer le deal comme perdu"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-danger" onClick={() => onConfirm(reason.trim())}>Marquer perdu</button>
        </>
      }
    >
      <p className="muted">
        Pourquoi <b style={{ color: "var(--text)" }}>{deal.title}</b> n&apos;a pas abouti ? Noter la raison t&apos;aide à repérer ce qui bloque dans ton pipeline.
      </p>
      <div className="crm-reasons">
        {LOST_REASONS.map((r) => (
          <button key={r} type="button" className={`chip crm-reason${reason === r ? " on" : ""}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="lost-reason">Raison</label>
        <textarea
          id="lost-reason"
          className="textarea"
          autoFocus
          rows={3}
          value={reason}
          placeholder="Ex. budget gelé jusqu'au printemps, à relancer en mars"
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onConfirm(reason.trim());
          }}
        />
      </div>
    </Modal>
  );
}

// Crée directement un projet d'onboarding depuis le modèle, lié au client.
export async function createOnboardingProject(
  sb: DB,
  opts: { workspaceId: string; companyId: string | null; companyName: string; leadId: string | null; takenKeys: string[]; labels: { id: string; name: string }[] },
) {
  const tpl = PROJECT_TEMPLATES.find((t) => t.id === "onboarding")!;
  const key = projectKeyFor(opts.companyName, opts.takenKeys);
  const maxDue = Math.max(...tpl.tasks.map((t) => t.due ?? 0));
  const project = must(
    await sb
      .from("projects")
      .insert({
        workspace_id: opts.workspaceId,
        company_id: opts.companyId,
        key,
        name: `Onboarding ${opts.companyName}`,
        description: tpl.desc,
        status: "active",
        color: "green",
        icon: tpl.icon,
        lead_id: opts.leadId,
        start_date: iso(today()),
        due_date: dayOffset(maxDue),
      })
      .select("id, key")
      .single(),
  )!;
  const tasks = must(
    await sb
      .from("tasks")
      .insert(
        tpl.tasks.map((t, i) => ({
          workspace_id: opts.workspaceId,
          project_id: project.id,
          title: t.title,
          status: "todo",
          assignee_id: opts.leadId,
          due_date: t.due !== undefined ? iso(addDays(today(), t.due)) : null,
          milestone: !!t.milestone,
          position: (i + 1) * 1000,
        })) as never,
      )
      .select("id, title"),
  ) as { id: string; title: string }[];
  const links = tasks
    .map((row) => {
      const def = tpl.tasks.find((t) => t.title === row.title);
      const label = opts.labels.find((l) => l.name === def?.label);
      return label ? { task_id: row.id, label_id: label.id } : null;
    })
    .filter(Boolean) as { task_id: string; label_id: string }[];
  if (links.length) must(await sb.from("task_labels").insert(links));
  await logActivity(sb, { workspace_id: opts.workspaceId, verb: "project.created", project_id: project.id, meta: { name: `Onboarding ${opts.companyName}`, from: "deal.won" } });
  return project;
}

function WonModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const mutate = useMutate();
  const [busy, setBusy] = useState(false);
  const company = ws.company(deal.company_id);
  const existing = ws.projects.filter((p) => p.company_id && p.company_id === deal.company_id && !p.archived_at && p.status !== "complete");
  const tpl = PROJECT_TEMPLATES.find((t) => t.id === "onboarding")!;

  const createDirect = async () => {
    setBusy(true);
    const p = await mutate(
      (sb) =>
        createOnboardingProject(sb, {
          workspaceId: ws.workspace.id,
          companyId: deal.company_id,
          companyName: company?.name ?? deal.title,
          leadId: deal.owner_id ?? ws.me.id,
          takenKeys: ws.projects.map((x) => x.key),
          labels: ws.labels,
        }),
      { success: "Projet d'onboarding créé" },
    );
    setBusy(false);
    if (p) {
      onClose();
      router.push(`${ws.base}/projects/${p.key}/board`);
    }
  };

  return (
    <Modal
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <PartyPopper size={16} style={{ color: "var(--green)" }} /> Deal gagné
        </span>
      }
      onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Plus tard</button>}
    >
      <p className="muted">
        <b style={{ color: "var(--text)" }}>{deal.title}</b> est signé pour {dealAmount(deal, ws.workspace.currency)}.
        {company && <> {company.name} passe en client.</>} Lance l&apos;onboarding tant que l&apos;enthousiasme est là.
      </p>
      {existing.length > 0 && (
        <p className="crm-note">
          {company?.name} a déjà {existing.length} projet{existing.length > 1 ? "s" : ""} en cours : {existing.map((p) => p.name).join(", ")}.
        </p>
      )}
      {ws.canWrite && (
        <div className="crm-choices">
          <button className="crm-choice" onClick={createDirect} disabled={busy} autoFocus>
            <span className="ic"><Rocket size={16} /></span>
            <span>
              <b>Créer le projet d&apos;onboarding</b>
              <span className="faint">
                « Onboarding {company?.name ?? deal.title} » avec les {tpl.tasks.length} tâches du modèle : accès, kick-off, tracking, plan média.
              </span>
            </span>
          </button>
          <button
            className="crm-choice"
            disabled={busy}
            onClick={() => {
              onClose();
              ui.create({ kind: "project", defaults: { company_id: deal.company_id, template: "onboarding", name: `Onboarding ${company?.name ?? deal.title}` } });
            }}
          >
            <span className="ic"><Settings2 size={16} /></span>
            <span>
              <b>Configurer le projet moi-même</b>
              <span className="faint">Ouvre la création de projet pour choisir le modèle, l&apos;équipe et les dates.</span>
            </span>
          </button>
        </div>
      )}
    </Modal>
  );
}
