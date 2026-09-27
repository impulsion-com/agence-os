"use client";

import { useSyncExternalStore } from "react";

import type { DB } from "@/lib/workspace/context";
import type { AccessAnswer, Answers, Section, Verified } from "@/lib/onboarding/types";

const noop = () => () => {};

/** Origine de l'app : celle du navigateur, ou NEXT_PUBLIC_APP_URL au rendu serveur */
export function useOrigin() {
  return useSyncExternalStore(noop, () => window.location.origin, () => process.env.NEXT_PUBLIC_APP_URL || "");
}

export const formUrl = (origin: string, token: string) => `${(process.env.NEXT_PUBLIC_APP_URL || origin).replace(/\/+$/, "")}/f/${token}`;

/** Accès demandés, déclarés faits par le client, vérifiés par l'agence */
export function accessStats(sections: Section[], answers: Answers, verified: Verified) {
  let total = 0;
  let declared = 0;
  let checked = 0;
  for (const s of sections)
    for (const q of s.questions) {
      if (q.type !== "access") continue;
      const a = (answers?.[q.id] ?? {}) as AccessAnswer;
      for (const i of q.items ?? []) {
        total++;
        if (a[i.id]?.done) declared++;
        if (verified?.[`${q.id}:${i.id}`]) checked++;
      }
    }
  return { total, declared, checked };
}

export interface SendResult {
  sent: boolean;
  url: string;
  email?: string;
  error?: string;
  emailEnabled: boolean;
}

/** Envoie (ou relance) le lien par email via la route serveur */
export async function sendForm(formId: string, reminder = false): Promise<SendResult> {
  const res = await fetch("/api/onboarding/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ form_id: formId, reminder }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<SendResult> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Envoi impossible");
  return body as SendResult;
}

/** Supprime un formulaire et ses fichiers du stockage */
export async function deleteForm(sb: DB, formId: string) {
  const { data: files } = await sb.from("onboarding_files").select("path").eq("form_id", formId);
  if (files?.length) await sb.storage.from("attachments").remove(files.map((f) => f.path));
  const { error } = await sb.from("onboarding_forms").delete().eq("id", formId);
  if (error) throw new Error(error.message);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
