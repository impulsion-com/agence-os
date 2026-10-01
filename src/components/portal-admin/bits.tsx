"use client";

import { Eye } from "lucide-react";

import "@/styles/portal-admin.css";
import { CLIENT_REVIEW, taskVisibleToClient } from "@/lib/portal-admin/features";
import type { ClientReview, Task } from "@/lib/types";
import { useWorkspace, type Person } from "@/lib/workspace/context";

/** Pastille posée à côté du nom d'un auteur qui est une personne d'un client. */
export function ClientPill({ person, company = true }: { person?: Person; company?: boolean }) {
  if (!person?.isClient) return null;
  return (
    <span className="pa-pill" title={person.company ? `Compte client de ${person.company.name}` : "Compte client"}>
      Client{company && person.company ? ` · ${person.company.name}` : ""}
    </span>
  );
}

/** Pastille des éléments partagés avec le client (commentaire, fichier). */
export function SharedPill({ label = "Visible client" }: { label?: string }) {
  return (
    <span className="pa-pill shared" title="Le client voit cet élément sur son portail">
      <Eye size={11} aria-hidden />
      {label}
    </span>
  );
}

/** La tâche est-elle visible sur le portail ? (false si le module Portail est désactivé) */
export function useTaskVisible() {
  const ws = useWorkspace();
  const on = ws.has("portal");
  return (t: Pick<Task, "client_visible" | "archived_at" | "project_id">) => on && taskVisibleToClient(t, ws.project(t.project_id));
}

/** Œil discret sur les cartes et les lignes des tâches que le client voit. */
export function ClientEye({ t, size = 12 }: { t: Pick<Task, "client_visible" | "archived_at" | "project_id">; size?: number }) {
  const visible = useTaskVisible();
  if (!visible(t)) return null;
  return (
    <span className="pa-eye" title="Visible par le client" aria-label="Visible par le client">
      <Eye size={size} />
    </span>
  );
}

/** Statut de validation d'une créa par le client. */
export function ReviewBadge({ review, short }: { review: ClientReview | null | undefined; short?: boolean }) {
  if (!review) return null;
  const r = CLIENT_REVIEW[review];
  return (
    <span className="badge" style={{ ["--c" as string]: r.color }} title={r.name}>
      {short ? r.short : r.name}
    </span>
  );
}
