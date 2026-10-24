// Prospection : fiches d'entreprises importées (export CSV de gosom/google-maps-scraper ou
// d'un autre outil, ou outil MCP import_prospects), puis ajoutées au CRM une par une ou par lot.
// Lecture et nettoyage dans prospects-parse.ts (pur) ; importProspects et addProspectsToCrm
// écrivent avec le client fourni (navigateur sous RLS, ou service role côté MCP, qui filtre
// alors lui-même par espace).
import type { SupabaseClient } from "@supabase/supabase-js";

import { colorForName } from "@/lib/constants";
import type { Database } from "@/lib/database.types";
import { bestEmail, prospectKey, type ProspectInput } from "./prospects-parse";

export * from "./prospects-parse";

type DB = SupabaseClient<Database>;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export type Prospect = Omit<Database["public"]["Tables"]["prospects"]["Row"], "status"> & { status: "new" | "added" | "ignored" };

export const PROSPECT_STATUS: Record<Prospect["status"], { name: string; color: string }> = {
  new: { name: "À trier", color: "blue" },
  added: { name: "Au CRM", color: "green" },
  ignored: { name: "Écarté", color: "slate" },
};

// ---------------------------------------------------------------------
// Import en base : écarte les fiches déjà connues de l'espace (et les doublons du lot)
// ---------------------------------------------------------------------
export async function importProspects(sb: DB, a: { workspaceId: string; userId: string; rows: ProspectInput[] }) {
  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("prospects").select("source, external_id, name, postal_code, address").eq("workspace_id", a.workspaceId).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) known.add(prospectKey(p));
    if ((data ?? []).length < 1000) break;
  }
  const fresh: ProspectInput[] = [];
  for (const p of a.rows) {
    const k = prospectKey(p);
    if (known.has(k)) continue;
    known.add(k);
    fresh.push(p);
  }
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await sb.from("prospects").insert(fresh.slice(i, i + 500).map((p) => ({ ...p, workspace_id: a.workspaceId, created_by: a.userId })));
    if (error) throw new Error(error.message);
  }
  return { imported: fresh.length, duplicates: a.rows.length - fresh.length };
}

// ---------------------------------------------------------------------
// Ajout au CRM : entreprise (prospect), contact si email ou téléphone, deal facultatif
// ---------------------------------------------------------------------
export function prospectNotes(p: Pick<Prospect, "address" | "phone" | "emails" | "rating" | "reviews" | "maps_url" | "search" | "category">) {
  return [
    "Trouvé par la prospection Google Maps" + (p.search ? ` (« ${p.search} »)` : "") + ".",
    p.category && `Catégorie : ${p.category}`,
    p.address && `Adresse : ${p.address}`,
    p.phone && `Téléphone : ${p.phone}`,
    p.emails.length > 0 && `Emails trouvés : ${p.emails.join(", ")}`,
    p.rating !== null && `Note Google : ${String(p.rating).replace(".", ",")}${p.reviews !== null ? ` (${p.reviews} avis)` : ""}`,
    p.maps_url && `Fiche Google Maps : ${p.maps_url}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface AddToCrmResult {
  companies: { id: string; name: string; created: boolean }[];
  contacts: number;
  deals: { id: string; title: string }[];
}

export async function addProspectsToCrm(sb: DB, a: { workspaceId: string; ownerId: string; ids: string[]; withDeal: boolean }): Promise<AddToCrmResult> {
  const ws = a.workspaceId;
  const ok = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const ps = (ok(await sb.from("prospects").select("*").eq("workspace_id", ws).in("id", a.ids)) ?? []).filter((p) => p.status !== "added");
  const res: AddToCrmResult = { companies: [], contacts: 0, deals: [] };
  if (!ps.length) return res;

  // Entreprises : une homonyme déjà au CRM est réutilisée plutôt que dupliquée
  const existing = new Map((ok(await sb.from("companies").select("id, name").eq("workspace_id", ws)) ?? []).map((c) => [norm(c.name), c.id]));
  const toCreate = Array.from(new Map(ps.filter((p) => !existing.has(norm(p.name))).map((p) => [norm(p.name), p])).values());
  const created = toCreate.length
    ? ok(
        await sb
          .from("companies")
          .insert(toCreate.map((p) => ({ workspace_id: ws, name: p.name, status: "lead", website: p.website, industry: p.category, owner_id: a.ownerId, color: colorForName(p.name), notes: prospectNotes(p) })))
          .select("id, name"),
      ) ?? []
    : [];
  const createdIds = new Set(created.map((c) => c.id));
  for (const c of created) existing.set(norm(c.name), c.id);
  const companyOf = (p: { name: string }) => existing.get(norm(p.name))!;

  // Contacts : le meilleur email et le téléphone, sauf si l'email est déjà au CRM
  const wanted = ps.map((p) => ({ p, email: bestEmail(p.emails) })).filter((x) => x.email || x.p.phone);
  const emails = wanted.map((x) => x.email).filter(Boolean);
  const taken = new Set(emails.length ? (ok(await sb.from("contacts").select("email").eq("workspace_id", ws).in("email", emails)) ?? []).map((c) => c.email.toLowerCase()) : []);
  const contacts = wanted.filter((x) => !x.email || !taken.has(x.email));
  const contactOf = new Map<string, string>();
  if (contacts.length) {
    const made =
      ok(
        await sb
          .from("contacts")
          .insert(contacts.map((x) => ({ workspace_id: ws, company_id: companyOf(x.p), email: x.email, phone: x.p.phone, notes: x.p.emails.length > 1 ? `Autres emails : ${x.p.emails.filter((e) => e !== x.email).join(", ")}` : "" })))
          .select("id, company_id"),
      ) ?? [];
    for (const c of made) if (c.company_id && !contactOf.has(c.company_id)) contactOf.set(c.company_id, c.id);
    res.contacts = made.length;
  }

  // Deals : à la première étape ouverte, source « Prospection », un par entreprise
  if (a.withDeal) {
    const stages = ok(await sb.from("pipeline_stages").select("id, kind").eq("workspace_id", ws).order("position")) ?? [];
    const stage = stages.find((s) => s.kind === "open") ?? stages[0];
    const last = stage ? ok(await sb.from("deals").select("position").eq("workspace_id", ws).eq("stage_id", stage.id).order("position", { ascending: false }).limit(1)) : [];
    let pos = last?.[0]?.position ?? 0;
    const seen = new Set<string>();
    const rows = ps.filter((p) => !seen.has(companyOf(p)) && seen.add(companyOf(p)));
    res.deals =
      ok(
        await sb
          .from("deals")
          .insert(rows.map((p) => ({ workspace_id: ws, title: p.name, company_id: companyOf(p), contact_id: contactOf.get(companyOf(p)) ?? null, stage_id: stage?.id ?? null, owner_id: a.ownerId, value: 0, billing: "monthly", source: "Prospection", position: (pos += 1000) })))
          .select("id, title"),
      ) ?? [];
  }

  await Promise.all(ps.map((p) => sb.from("prospects").update({ status: "added", company_id: companyOf(p) }).eq("id", p.id).eq("workspace_id", ws)));
  res.companies = Array.from(new Map(ps.map((p) => [companyOf(p), { id: companyOf(p), name: p.name, created: createdIds.has(companyOf(p)) }])).values());
  return res;
}
