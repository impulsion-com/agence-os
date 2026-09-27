import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { PROJECT_TEMPLATES } from "@/lib/constants";
import type { TablesInsert } from "@/lib/database.types";
import { emailEnabled, emailLayout, sendEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase/server";
import { normalizeUrl, parseNum } from "./logic";
import type { AccessAnswer, Answers, AutomationResult, FormOptions, OnboardingForm, PublicFormData } from "./types";

type Admin = ReturnType<typeof supabaseAdmin>;

export const TOKEN_RE = /^[0-9a-f]{32}$/;
export const BUCKET = "attachments";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Origine publique de l'app (liens envoyés aux clients) */
export function appOrigin(req: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/+$/, "");
}

export const publicLink = (origin: string, token: string) => `${origin}/f/${token}`;

/** Formulaire complet par jeton (service role), ou null */
export async function formByToken(admin: Admin, token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await admin.from("onboarding_forms").select("*").eq("token", token).maybeSingle();
  return (data as unknown as OnboardingForm | null) ?? null;
}

/** Données de la page publique */
export async function loadPublic(admin: Admin, form: OnboardingForm, preview: boolean): Promise<PublicFormData> {
  const [ws, settings, company, contact, owner, files] = await Promise.all([
    admin.from("workspaces").select("name, accent").eq("id", form.workspace_id).single(),
    admin.from("onboarding_settings").select("*").eq("workspace_id", form.workspace_id).maybeSingle(),
    form.company_id ? admin.from("companies").select("name").eq("id", form.company_id).maybeSingle() : Promise.resolve({ data: null }),
    form.contact_id ? admin.from("contacts").select("first_name, email").eq("id", form.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    form.created_by ? admin.from("profiles").select("full_name, email").eq("id", form.created_by).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("onboarding_files").select("id, question_id, name, size, mime").eq("form_id", form.id).order("created_at"),
  ]);
  return {
    preview,
    token: form.token,
    title: form.title,
    intro: form.intro,
    sections: form.sections,
    answers: form.answers ?? {},
    status: form.status,
    completed_at: form.completed_at,
    files: files.data ?? [],
    agency: {
      name: ws.data?.name ?? "",
      accent: ws.data?.accent ?? "indigo",
      meta_business_id: settings.data?.meta_business_id ?? "",
      google_mcc_id: settings.data?.google_mcc_id ?? "",
      access_email: settings.data?.access_email || owner.data?.email || "",
    },
    company: company.data?.name ?? null,
    contact: contact.data ? { first_name: contact.data.first_name, email: contact.data.email } : null,
    owner: owner.data ?? null,
  };
}

// ---------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendInviteEmail(opt: {
  to: string;
  firstName: string;
  agency: string;
  title: string;
  url: string;
  reminder: boolean;
  progress: number;
  replyTo?: string;
  intro?: string;
}) {
  const hello = `Bonjour${opt.firstName ? ` ${esc(opt.firstName)}` : ""},`;
  const body = opt.reminder
    ? `${hello}<br><br>Petit rappel : votre formulaire d'onboarding ${opt.progress > 0 ? `est rempli à ${opt.progress} %` : "n'a pas encore été commencé"}. Il nous permet de préparer vos campagnes et d'obtenir les accès nécessaires.<br><br>Vos réponses sont enregistrées automatiquement : vous reprenez exactement là où vous vous étiez arrêté.`
    : `${hello}<br><br>${opt.intro ? `${esc(opt.intro).replace(/\n/g, "<br>")}<br><br>` : "Pour bien démarrer notre collaboration, merci de remplir ce formulaire : votre activité, vos objectifs, vos créations et les accès à vos comptes publicitaires.<br><br>"}Comptez une vingtaine de minutes. Vos réponses sont enregistrées automatiquement : vous pouvez le compléter en plusieurs fois avec le même lien.`;
  return sendEmail({
    to: opt.to,
    subject: opt.reminder ? `Rappel : ${opt.title}` : `${opt.agency} : votre formulaire d'onboarding`,
    html: emailLayout({ agency: opt.agency, title: opt.reminder ? "Votre formulaire vous attend" : opt.title, body, cta: { label: opt.reminder ? "Reprendre le formulaire" : "Remplir le formulaire", url: opt.url } }),
    text: `${opt.title}\n\n${opt.url}`,
    replyTo: opt.replyTo,
  });
}

// ---------------------------------------------------------------------
// Automatisations à la fin du formulaire
// ---------------------------------------------------------------------
const TASK_LABEL: Record<string, string> = {
  meta_bm: "Média", meta_ads: "Média", google_ads: "Média", ga4: "Tracking", gtm: "Tracking", search_console: "Tracking", cms: "Tracking", gbp: "Client", other: "Client",
};

const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

async function uniqueKey(admin: Admin, ws: string, name: string) {
  const words = deaccent(name).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : (words[0] ?? "").slice(0, 3);
  if (base.length < 2) base = (words.join("") + "ONB").slice(0, 3);
  const { data } = await admin.from("projects").select("key").eq("workspace_id", ws);
  const taken = new Set((data ?? []).map((p) => p.key));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const k = `${base.slice(0, 4)}${i}`;
    if (!taken.has(k)) return k;
  }
  return `ONB${Date.now() % 1000}`;
}

const dayIso = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/**
 * Exécutée à la fin du formulaire (et relançable depuis l'app) :
 * 1. fiche client : site web et secteur s'ils sont vides ;
 * 2. KPI cibles (CPA, ROAS) du client ;
 * 3. projet d'onboarding (modèle « onboarding ») si le client n'a aucun projet actif,
 *    puis une tâche « Vérifier l'accès » par accès non vérifié par l'agence.
 */
export async function runAutomations(admin: Admin, form: OnboardingForm): Promise<AutomationResult> {
  const res: AutomationResult = { at: new Date().toISOString(), tasks: 0, kpis: {}, company: [], errors: [], project_id: null, project_created: false };
  const opts: FormOptions = form.options ?? {};
  const answers: Answers = form.answers ?? {};
  const questions = form.sections.flatMap((s) => s.questions);
  if (!form.company_id) return res;

  const { data: company } = await admin.from("companies").select("id, name, website, industry, color, owner_id").eq("id", form.company_id).maybeSingle();
  if (!company) return res;

  // 1. Fiche client
  if (opts.company !== false) {
    const patch: { website?: string; industry?: string } = {};
    for (const q of questions) {
      const v = typeof answers[q.id] === "string" ? (answers[q.id] as string).trim() : "";
      if (!v) continue;
      if (q.map === "company.website" && !company.website?.trim()) patch.website = normalizeUrl(v).replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (q.map === "company.industry" && !company.industry?.trim()) patch.industry = v.slice(0, 80);
    }
    if (Object.keys(patch).length) {
      const { error } = await admin.from("companies").update(patch).eq("id", company.id);
      if (error) res.errors!.push(`Fiche client : ${error.message}`);
      else res.company = Object.keys(patch).map((k) => (k === "website" ? "site web" : "secteur"));
    }
  }

  // 2. KPI cibles
  if (opts.kpis !== false) {
    for (const q of questions) {
      if (q.map !== "kpi.cpa" && q.map !== "kpi.roas") continue;
      const n = parseNum(answers[q.id]);
      if (n === null || n <= 0) continue;
      const metric = q.map === "kpi.cpa" ? "cpa" : "roas";
      const { error } = await admin
        .from("kpi_targets")
        .upsert({ workspace_id: form.workspace_id, company_id: company.id, metric, target: n }, { onConflict: "company_id,metric" });
      if (error) res.errors!.push(`KPI ${metric.toUpperCase()} : ${error.message}`);
      else res.kpis![metric] = n;
    }
  }

  // 3. Projet et tâches de vérification des accès
  if (opts.project !== false) {
    const { data: active } = await admin
      .from("projects")
      .select("id")
      .eq("company_id", company.id)
      .is("archived_at", null)
      .neq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1);
    let projectId = form.project_id ?? active?.[0]?.id ?? null;
    const { data: labels } = await admin.from("labels").select("id, name").eq("workspace_id", form.workspace_id);
    const labelId = (name?: string) => labels?.find((l) => l.name === name)?.id;

    if (!projectId) {
      const tpl = PROJECT_TEMPLATES.find((t) => t.id === "onboarding")!;
      const key = await uniqueKey(admin, form.workspace_id, company.name);
      const { data: p, error } = await admin
        .from("projects")
        .insert({
          workspace_id: form.workspace_id,
          company_id: company.id,
          key,
          name: `${company.name} · Onboarding`,
          description: `Projet créé automatiquement à la fin du formulaire « ${form.title} ».`,
          status: "active",
          color: company.color || "indigo",
          icon: tpl.icon,
          lead_id: form.created_by,
          start_date: dayIso(0),
          due_date: dayIso(Math.max(...tpl.tasks.map((t) => t.due ?? 0), 10)),
        })
        .select("id, name")
        .single();
      if (error || !p) res.errors!.push(`Projet : ${error?.message ?? "création impossible"}`);
      else {
        projectId = p.id;
        res.project_created = true;
        let pos = 1000;
        for (const t of tpl.tasks) {
          const { data: task } = await admin
            .from("tasks")
            .insert({ workspace_id: form.workspace_id, project_id: p.id, title: t.title, status: "todo", due_date: t.due != null ? dayIso(t.due) : null, milestone: !!t.milestone, position: pos, created_by: form.created_by } as unknown as TablesInsert<"tasks">)
            .select("id")
            .single();
          pos += 1000;
          const l = labelId(t.label);
          if (task && l) await admin.from("task_labels").insert({ task_id: task.id, label_id: l });
        }
        await admin.from("activity").insert({
          workspace_id: form.workspace_id,
          project_id: p.id,
          actor_id: form.created_by,
          verb: "project.created",
          meta: { name: p.name, via: "onboarding" },
        });
      }
    }

    if (projectId) {
      res.project_id = projectId;
      // Pas de doublon si les automatisations sont relancées
      const { data: existing } = await admin.from("tasks").select("title").eq("project_id", projectId).like("title", "Vérifier l'accès : %");
      const already = new Set((existing ?? []).map((t) => t.title));
      const { data: last } = await admin.from("tasks").select("position").eq("project_id", projectId).order("position", { ascending: false }).limit(1);
      let pos = (last?.[0]?.position ?? 0) + 1000;
      for (const q of questions) {
        if (q.type !== "access") continue;
        const a = (answers[q.id] ?? {}) as AccessAnswer;
        for (const item of q.items ?? []) {
          if (form.verified?.[`${q.id}:${item.id}`]) continue;
          const title = `Vérifier l'accès : ${item.name}`;
          if (already.has(title)) continue;
          const declared = !!a[item.id]?.done;
          const value = a[item.id]?.value?.trim();
          const description = [
            declared
              ? "Le client a indiqué avoir donné l'accès."
              : a[item.id]?.skip
                ? "Le client a signalé ne pas pouvoir donner cet accès pour l'instant : voir avec lui (notes du formulaire)."
                : "Le client n'a pas confirmé cet accès : à relancer.",
            value ? `Identifiant fourni : ${value}` : "",
            `Formulaire : ${form.title}`,
          ]
            .filter(Boolean)
            .join("\n");
          const { data: task, error } = await admin
            .from("tasks")
            .insert({ workspace_id: form.workspace_id, project_id: projectId, title, description, status: "todo", priority: declared ? "medium" : "high", due_date: dayIso(2), position: pos, created_by: form.created_by } as unknown as TablesInsert<"tasks">)
            .select("id")
            .single();
          pos += 1000;
          if (error) {
            res.errors!.push(`Tâche ${item.name} : ${error.message}`);
            continue;
          }
          res.tasks!++;
          const l = labelId(TASK_LABEL[item.platform] ?? "Client");
          if (task && l) await admin.from("task_labels").insert({ task_id: task.id, label_id: l });
        }
      }
    }
  }
  if (!res.errors!.length) delete res.errors;
  return res;
}

/** Notification in-app (et email si configuré) au créateur du formulaire et au responsable du client */
export async function notifyCompleted(admin: Admin, form: OnboardingForm, origin: string) {
  const { data: company } = form.company_id ? await admin.from("companies").select("name, owner_id").eq("id", form.company_id).maybeSingle() : { data: null };
  const who = company?.name ?? form.title;
  const users = [...new Set([form.created_by, company?.owner_id].filter(Boolean) as string[])];
  if (!users.length) return;
  await admin.from("notifications").insert(
    users.map((u) => ({
      workspace_id: form.workspace_id,
      user_id: u,
      kind: "onboarding",
      project_id: form.project_id,
      body: `Onboarding terminé : ${who}`,
    })),
  );
  if (!emailEnabled()) return;
  const [{ data: ws }, { data: profiles }] = await Promise.all([
    admin.from("workspaces").select("name, slug").eq("id", form.workspace_id).single(),
    admin.from("profiles").select("email").in("id", users),
  ]);
  const to = (profiles ?? []).map((p) => p.email).filter(Boolean);
  if (!ws || !to.length) return;
  await sendEmail({
    to,
    subject: `Onboarding terminé : ${who}`,
    html: emailLayout({
      agency: ws.name,
      title: `${who} a terminé son onboarding`,
      body: `Les réponses, les fichiers et la checklist des accès sont disponibles dans ${esc(ws.name)}.`,
      cta: { label: "Voir les réponses", url: `${origin}/w/${ws.slug}/onboarding/${form.id}` },
    }),
  });
}
