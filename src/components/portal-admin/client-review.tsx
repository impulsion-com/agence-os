"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RotateCcw, Send, Undo2 } from "lucide-react";

import "@/styles/portal-admin.css";
import { ago, fmtDate } from "@/lib/format";
import type { Concept } from "@/lib/creatives/types";
import { emailClient } from "@/lib/portal-admin/notify";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ClientReview } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { ReviewBadge } from "./bits";

type Review = Pick<Concept, "id" | "title" | "company_id" | "project_id" | "task_id" | "client_review" | "client_feedback" | "client_reviewed_at" | "client_reviewed_by">;

/**
 * Carte « Validation client » d'un concept créatif : envoi en validation sur le portail,
 * statut (en attente, approuvée, modifications demandées), retour du client et renvoi après correction.
 * `onChange` reçoit le nouveau statut pour la mise à jour optimiste de la page.
 */
export function ClientReviewCard({ concept: c, onChange }: { concept: Review; onChange: (patch: { client_review: ClientReview | null }) => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const company = ws.company(c.company_id);
  // Portail du client : la créa n'est visible que s'il est activé avec la fonctionnalité « Créas à valider »
  const [portal, setPortal] = useState<{ enabled: boolean; features: string[] } | null | undefined>(undefined);
  useEffect(() => {
    if (!c.company_id) return;
    let alive = true;
    void supabaseBrowser()
      .from("client_portals")
      .select("enabled, features")
      .eq("company_id", c.company_id)
      .maybeSingle()
      .then(({ data }) => alive && setPortal(data ?? null));
    return () => {
      alive = false;
    };
  }, [c.company_id]);

  if (!ws.has("portal")) return null;
  const ready = !!portal?.enabled && portal.features.includes("creatives");
  const who = ws.client(c.client_reviewed_by);
  const ro = !ws.canWrite;

  const set = async (client_review: ClientReview | null, success: string) => {
    onChange({ client_review });
    const ok = await mutate(
      async (sb) => {
        must(await sb.from("creative_concepts").update({ client_review }).eq("id", c.id).select("id"));
        // Journal : l'historique des envois et des réponses est montré au client sur la fiche de la créa
        if (client_review === "pending")
          await sb.from("activity").insert({
            workspace_id: ws.workspace.id, project_id: c.project_id, task_id: c.task_id, verb: "creative.submitted",
            meta: { concept_id: c.id, title: c.title },
          });
        return true;
      },
      { success },
    );
    if (!ok) onChange({ client_review: c.client_review });
    // La notification du portail est créée par la base ; l'email part d'ici s'il est configuré
    else if (client_review === "pending") emailClient("creative", [c.id]);
  };

  return (
    <section className="card" aria-labelledby="crv-review-h">
      <div className="card-h">
        <h3 id="crv-review-h">Validation client</h3>
        <ReviewBadge review={c.client_review} short />
      </div>
      <div className="pa-review">
        {!company ? (
          <p>Rattache ce concept à un client pour pouvoir le lui envoyer en validation.</p>
        ) : c.client_review === null ? (
          <>
            <p>
              Envoie ce concept à {company.name} : il le retrouve sur son portail, avec le hook, les visuels et le brief, et peut l&apos;approuver ou demander des modifications.
            </p>
            {portal !== undefined && !ready && (
              <p className="faint">
                {portal?.enabled ? "La fonctionnalité « Créas à valider » n'est pas ouverte sur le portail de ce client." : "Le portail de ce client n'est pas encore activé."}{" "}
                <Link href={`${ws.base}/crm/companies/${company.id}?tab=portal`} style={{ color: "var(--accent)" }}>Ouvrir les réglages du portail</Link>
              </p>
            )}
            {!ro && (
              <div className="btns">
                <button type="button" className="btn btn-primary btn-sm" disabled={!ready} onClick={() => void set("pending", `Créa envoyée en validation à ${company.name}`)}>
                  <Send size={13} /> Envoyer en validation client
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {c.client_review === "pending" && (
              <p>
                En attente de la réponse de {company.name}.{" "}
                {!ready && portal !== undefined && <span style={{ color: "var(--amber)" }}>Le client ne la voit pas : son portail n&apos;ouvre pas les créas.</span>}
              </p>
            )}
            {c.client_review === "approved" && <p>{company.name} a approuvé cette créa. Tu peux lancer la production ou la mise en ligne.</p>}
            {c.client_review === "changes" && <p>{company.name} demande des modifications. Reprends la créa, puis renvoie-la en validation.</p>}
            {c.client_feedback && (c.client_review !== "pending" || c.client_reviewed_at) && (
              <div>
                <div className="who" style={{ marginBottom: 4 }}>
                  {c.client_review === "pending" ? "Retour précédent" : "Retour du client"}
                  {who ? ` · ${who.profile.full_name}` : ""}
                  {c.client_reviewed_at && (
                    <>
                      {" · "}
                      <time dateTime={c.client_reviewed_at} title={new Date(c.client_reviewed_at).toLocaleString("fr-FR")}>
                        {fmtDate(c.client_reviewed_at.slice(0, 10))} ({ago(c.client_reviewed_at)})
                      </time>
                    </>
                  )}
                </div>
                <blockquote>{c.client_feedback}</blockquote>
              </div>
            )}
            {!c.client_feedback && c.client_review !== "pending" && c.client_reviewed_at && (
              <div className="who">
                {who ? `${who.profile.full_name} · ` : ""}
                <time dateTime={c.client_reviewed_at}>{fmtDate(c.client_reviewed_at.slice(0, 10))} ({ago(c.client_reviewed_at)})</time>
                {" · sans commentaire"}
              </div>
            )}
            {!ro && (
              <div className="btns">
                {c.client_review === "pending" ? (
                  <button type="button" className="btn btn-sm" onClick={() => void set(null, "Créa retirée de la validation")}>
                    <Undo2 size={13} /> Retirer de la validation
                  </button>
                ) : (
                  <>
                    <button type="button" className={`btn btn-sm${c.client_review === "changes" ? " btn-primary" : ""}`} onClick={() => void set("pending", `Créa renvoyée en validation à ${company.name}`)}>
                      <RotateCcw size={13} /> {c.client_review === "changes" ? "Renvoyer après correction" : "Renvoyer en validation"}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void set(null, "Créa retirée du portail")}>
                      Retirer du portail
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
