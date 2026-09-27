// Logique pure de l'onboarding (sans dépendance serveur ou React) : progression,
// validation des réponses, remplacement des variables de l'agence dans les tutoriels.
// Utilisée par la page publique, l'app et les routes serveur.

import type { AccessAnswer, AnswerValue, Answers, FormStatus, Question, QuestionType, Section } from "./types";

export const QUESTION_TYPES: { id: QuestionType; name: string; icon: string }[] = [
  { id: "short", name: "Texte court", icon: "type" },
  { id: "long", name: "Texte long", icon: "align-left" },
  { id: "single", name: "Choix unique", icon: "circle-dot" },
  { id: "multi", name: "Choix multiple", icon: "list-checks" },
  { id: "number", name: "Nombre", icon: "hash" },
  { id: "url", name: "Lien (URL)", icon: "link" },
  { id: "date", name: "Date", icon: "calendar" },
  { id: "email", name: "Email", icon: "at-sign" },
  { id: "phone", name: "Téléphone", icon: "phone" },
  { id: "file", name: "Fichiers", icon: "paperclip" },
  { id: "access", name: "Checklist d'accès", icon: "key-round" },
];
export const QUESTION_TYPE = Object.fromEntries(QUESTION_TYPES.map((t) => [t.id, t])) as Record<QuestionType, (typeof QUESTION_TYPES)[number]>;

export const QUESTION_MAPS: { id: string; name: string }[] = [
  { id: "", name: "Aucun" },
  { id: "company.website", name: "Site web de la fiche client" },
  { id: "company.industry", name: "Secteur de la fiche client" },
  { id: "kpi.cpa", name: "KPI cible : CPA" },
  { id: "kpi.roas", name: "KPI cible : ROAS" },
];

export const FORM_STATUS: Record<FormStatus, { name: string; color: string }> = {
  sent: { name: "Envoyé", color: "var(--gray)" },
  in_progress: { name: "En cours", color: "var(--amber)" },
  completed: { name: "Terminé", color: "var(--green)" },
};

// Limites des fichiers déposés par le client
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_FILES_PER_FORM = 60;
export const ACCEPT: Record<string, string> = {
  images: "image/*,.svg,.ai,.eps,.pdf",
  docs: "image/*,.pdf,.doc,.docx,.ppt,.pptx,.key,.zip,.ai,.eps,.fig",
  any: "",
};

/** Espaces insécables de la typographie française (évite « ? » ou « » » seuls en début de ligne) */
export const nb = (s: string) => s.replace(/« /g, "«\u00a0").replace(/ ([»:?!;])/g, "\u00a0$1");

export const uid = (p = "q") => `${p}_${Math.random().toString(36).slice(2, 9)}`;

const isAccess = (v: AnswerValue | undefined): v is AccessAnswer => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: AnswerValue | undefined) => (typeof v === "string" ? v.trim() : "");

/** Nombre décimal saisi à la française (« 3,5 », « 1 200 ») */
export function parseNum(v: AnswerValue | undefined): number | null {
  const s = str(v).replace(/\s| | /g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeUrl(s: string) {
  const t = s.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Une question a-t-elle une réponse ? (fichiers : nombre de fichiers déposés) */
export function isAnswered(q: Question, v: AnswerValue | undefined, fileCount = 0): boolean {
  switch (q.type) {
    case "file":
      return fileCount > 0;
    case "multi":
      return Array.isArray(v) && v.length > 0;
    case "access":
      return isAccess(v) && (q.items ?? []).length > 0 && (q.items ?? []).every((i) => v[i.id]?.done || v[i.id]?.skip);
    default:
      return str(v).length > 0;
  }
}

/** Message d'erreur d'une réponse, ou null si elle est valide */
export function validate(q: Question, v: AnswerValue | undefined, fileCount = 0): string | null {
  const answered = isAnswered(q, v, fileCount);
  if (q.required && !answered) {
    if (q.type === "access") return "Pour chaque accès, cochez « C'est fait » ou indiquez que vous ne pouvez pas le faire.";
    if (q.type === "file") return "Ajoutez au moins un fichier.";
    if (q.type === "single" || q.type === "multi") return "Choisissez une réponse.";
    return "Ce champ est obligatoire.";
  }
  const s = str(v);
  if (!s) return null;
  if (q.type === "number" && parseNum(v) === null) return "Indiquez un nombre (ex. 3,5).";
  if (q.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return "Cette adresse email ne semble pas valide.";
  if (q.type === "url" && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(s)) return "Ce lien ne semble pas valide (ex. monsite.fr).";
  if (q.type === "phone" && s.replace(/\D/g, "").length < 6) return "Ce numéro semble incomplet.";
  if (q.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return "Date invalide.";
  return null;
}

/** Unités de progression : une par question, une par accès pour une checklist */
function units(q: Question, v: AnswerValue | undefined, fileCount: number): [done: number, total: number] {
  if (q.type === "access") {
    const items = q.items ?? [];
    return [items.filter((i) => isAccess(v) && (v[i.id]?.done || v[i.id]?.skip)).length, items.length];
  }
  return [isAnswered(q, v, fileCount) ? 1 : 0, 1];
}

export type FileCounts = Record<string, number>;

export function sectionProgress(s: Section, answers: Answers, files: FileCounts = {}) {
  let done = 0;
  let total = 0;
  let missing = 0;
  for (const q of s.questions) {
    const [d, t] = units(q, answers[q.id], files[q.id] ?? 0);
    done += d;
    total += t;
    if (validate(q, answers[q.id], files[q.id] ?? 0)) missing++;
  }
  return { done, total, missing, pct: total ? Math.round((done / total) * 100) : 100 };
}

export function formProgress(sections: Section[], answers: Answers, files: FileCounts = {}) {
  let done = 0;
  let total = 0;
  for (const s of sections) {
    const p = sectionProgress(s, answers, files);
    done += p.done;
    total += p.total;
  }
  return total ? Math.round((done / total) * 100) : 0;
}

/** Erreurs de validation de tout le formulaire : { questionId: message } */
export function formErrors(sections: Section[], answers: Answers, files: FileCounts = {}) {
  const errs: Record<string, string> = {};
  for (const s of sections)
    for (const q of s.questions) {
      const e = validate(q, answers[q.id], files[q.id] ?? 0);
      if (e) errs[q.id] = e;
    }
  return errs;
}

export const countFiles = (files: { question_id: string }[]): FileCounts =>
  files.reduce<FileCounts>((m, f) => ((m[f.question_id] = (m[f.question_id] ?? 0) + 1), m), {});

/** Nettoie des réponses reçues du client : ne garde que les questions connues, borne les tailles */
export function sanitizeAnswers(sections: Section[], raw: unknown): Answers {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Answers = {};
  const cut = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
  for (const s of sections)
    for (const q of s.questions) {
      const v = input[q.id];
      if (v === undefined || v === null || q.type === "file") continue;
      if (q.type === "multi") {
        if (Array.isArray(v)) out[q.id] = v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, 50);
      } else if (q.type === "access") {
        if (typeof v === "object" && !Array.isArray(v)) {
          const a: AccessAnswer = {};
          for (const item of q.items ?? []) {
            const e = (v as Record<string, unknown>)[item.id];
            if (e && typeof e === "object") {
              const o = e as { done?: unknown; skip?: unknown; value?: unknown };
              a[item.id] = { done: o.done === true, skip: o.done !== true && o.skip === true, value: cut(o.value, 300) };
            }
          }
          out[q.id] = a;
        }
      } else if (typeof v === "string") {
        out[q.id] = v.slice(0, q.type === "long" ? 8000 : 1000);
      }
    }
  return out;
}

// ---------------------------------------------------------------------
// Variables de l'agence dans les tutoriels
// ---------------------------------------------------------------------
export interface AgencyVars {
  name: string;
  meta_business_id: string;
  google_mcc_id: string;
  access_email: string;
}

export const PLACEHOLDERS: { key: string; label: string; of: (a: AgencyVars) => string }[] = [
  { key: "agence", label: "Nom de l'agence", of: (a) => a.name },
  { key: "meta_bm_id", label: "ID du Business Manager de l'agence", of: (a) => a.meta_business_id },
  { key: "google_mcc_id", label: "Compte administrateur Google Ads (MCC)", of: (a) => a.google_mcc_id },
  { key: "email_acces", label: "Email à inviter", of: (a) => a.access_email },
];

export type Segment = { text: string } | { key: string; value: string; missing: boolean; copy: boolean };

/** Découpe un texte en segments : texte brut et variables remplacées (copiables pour les identifiants) */
export function fillSegments(text: string, a: AgencyVars): Segment[] {
  const out: Segment[] = [];
  const re = /\{(agence|meta_bm_id|google_mcc_id|email_acces)\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const ph = PLACEHOLDERS.find((p) => p.key === m![1])!;
    const value = ph.of(a).trim();
    out.push({ key: ph.key, value, missing: !value, copy: ph.key !== "agence" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Variables utilisées par un ensemble de sections et non renseignées dans les réglages */
export function missingVars(sections: Section[], a: AgencyVars) {
  const used = new Set<string>();
  for (const s of sections)
    for (const q of s.questions)
      for (const i of q.items ?? []) for (const st of i.steps) for (const m of st.matchAll(/\{(meta_bm_id|google_mcc_id|email_acces)\}/g)) used.add(m[1]);
  return PLACEHOLDERS.filter((p) => used.has(p.key) && !p.of(a).trim());
}

/** Texte lisible d'une réponse (vue agence, impression) */
export function answerText(q: Question, v: AnswerValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string") {
    if (q.type === "number" && v.trim()) return q.unit ? `${v.trim()} ${q.unit}` : v.trim();
    if (q.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    }
    return v.trim();
  }
  return "";
}

export const questionCount = (sections: Section[]) => sections.reduce((n, s) => n + s.questions.length, 0);
