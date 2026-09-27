"use client";

import "@/styles/onboarding.css";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlignLeft, ArrowDown, ArrowLeft, ArrowUp, AtSign, Calendar, ChevronDown, ChevronRight, CircleAlert, CircleDot, Copy, Eye, Hash,
  KeyRound, Link as LinkIcon, ListChecks, LoaderCircle, Paperclip, Phone, Plus, Trash2, Type, X,
} from "lucide-react";

import { SetCrumbs } from "@/components/shell/crumbs";
import { Icon } from "@/components/ui/icon";
import { Menu, type MenuItem } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { missingVars, PLACEHOLDERS, QUESTION_MAPS, QUESTION_TYPE, QUESTION_TYPES, questionCount, uid } from "@/lib/onboarding/logic";
import type { AccessItem, AccessPlatform, OnboardingSettings, OnboardingTemplate, PublicFormData, Question, QuestionMap, QuestionType, Section } from "@/lib/onboarding/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import { PublicForm } from "./public-form";

const TYPE_ICON: Record<QuestionType, React.ReactNode> = {
  short: <Type size={14} />,
  long: <AlignLeft size={14} />,
  single: <CircleDot size={14} />,
  multi: <ListChecks size={14} />,
  number: <Hash size={14} />,
  url: <LinkIcon size={14} />,
  date: <Calendar size={14} />,
  email: <AtSign size={14} />,
  phone: <Phone size={14} />,
  file: <Paperclip size={14} />,
  access: <KeyRound size={14} />,
};

const PLATFORMS: { id: AccessPlatform; name: string }[] = [
  { id: "meta_bm", name: "Business Manager Meta" },
  { id: "meta_ads", name: "Compte publicitaire Meta" },
  { id: "google_ads", name: "Google Ads" },
  { id: "ga4", name: "Google Analytics 4" },
  { id: "gtm", name: "Google Tag Manager" },
  { id: "search_console", name: "Search Console" },
  { id: "gbp", name: "Fiche d'établissement Google" },
  { id: "cms", name: "Site / CMS / Shopify" },
  { id: "other", name: "Autre outil" },
];

const TEMPLATE_ICONS = ["list-checks", "shopping-bag", "target", "calendar", "briefcase", "rocket", "globe", "megaphone", "sparkles", "heart"];

type Save = "saved" | "pending" | "saving" | "error";

/** Éditeur d'un modèle de formulaire : sections, questions, checklist d'accès, sauvegarde automatique */
export function TemplateEditor({ template, settings, usedBy }: { template: OnboardingTemplate; settings: OnboardingSettings | null; usedBy: number }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [icon, setIcon] = useState(template.icon);
  const [sections, setSections] = useState<Section[]>(template.sections ?? []);
  const [open, setOpen] = useState<string | null>(null);
  const [save, setSave] = useState<Save>("saved");
  const [preview, setPreview] = useState(false);
  const [presets, setPresets] = useState<AccessItem[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ name, description, icon, sections });
  const ro = !ws.canWrite;

  // Accès types proposés à l'ajout : ceux des modèles fournis
  useEffect(() => {
    void supabaseBrowser()
      .rpc("onboarding_default_templates")
      .then(({ data }) => {
        const map = new Map<string, AccessItem>();
        for (const t of (data ?? []) as unknown as { sections: Section[] }[])
          for (const s of t.sections) for (const q of s.questions) for (const i of q.items ?? []) if (!map.has(i.id)) map.set(i.id, i);
        setPresets([...map.values()]);
      });
  }, []);

  const persist = async () => {
    timer.current = null;
    setSave("saving");
    const v = latest.current;
    const { error } = await supabaseBrowser()
      .from("onboarding_templates")
      .update({ name: v.name.trim() || "Sans titre", description: v.description, icon: v.icon, sections: JSON.parse(JSON.stringify(v.sections)) })
      .eq("id", template.id);
    if (error) {
      setSave("error");
      toast(error.message, { error: true });
    } else setSave("saved");
  };

  const schedule = (patch: Partial<typeof latest.current>) => {
    latest.current = { ...latest.current, ...patch };
    if (ro) return;
    setSave("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), 700);
  };

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void persist();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const setSecs = (next: Section[]) => {
    setSections(next);
    schedule({ sections: next });
  };
  const updSec = (si: number, patch: Partial<Section>) => setSecs(sections.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const updQ = (si: number, qi: number, patch: Partial<Question>) =>
    updSec(si, { questions: sections[si].questions.map((q, i) => (i === qi ? cleanQ({ ...q, ...patch }) : q)) });
  const move = <T,>(arr: T[], i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return arr;
    const c = [...arr];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  };

  const addQuestion = (si: number, type: QuestionType) => {
    const q: Question = cleanQ({
      id: uid(),
      type,
      label: "",
      ...(type === "single" || type === "multi" ? { options: ["Option 1", "Option 2"] } : {}),
      ...(type === "access" ? { label: "Donnez-nous accès à vos comptes", required: true, items: presets.slice(0, 2).map((p) => ({ ...p, id: uid("a") })) } : {}),
      ...(type === "file" ? { accept: "any" as const } : {}),
    });
    updSec(si, { questions: [...sections[si].questions, q] });
    setOpen(q.id);
  };

  const typeItems = (si: number): MenuItem[] => QUESTION_TYPES.map((t) => ({ label: t.name, icon: TYPE_ICON[t.id], onSelect: () => addQuestion(si, t.id) }));

  const agency = {
    name: ws.workspace.name,
    accent: ws.workspace.accent,
    meta_business_id: settings?.meta_business_id ?? "",
    google_mcc_id: settings?.google_mcc_id ?? "",
    access_email: settings?.access_email ?? "",
  };
  const missing = missingVars(sections, agency);
  const previewData: PublicFormData = {
    preview: true,
    token: "apercu",
    title: name,
    intro: settings?.intro ?? "",
    sections,
    answers: {},
    status: "sent",
    completed_at: null,
    files: [],
    agency,
    company: "Client exemple",
    contact: { first_name: "Claire", email: "" },
    owner: { full_name: ws.me.full_name, email: ws.me.email },
  };

  return (
    <>
      <SetCrumbs items={[{ label: "Onboarding clients", href: `${ws.base}/onboarding?tab=templates` }, { label: name || "Modèle" }]} />
      <div className="onb-ed-bar">
        <Link href={`${ws.base}/onboarding?tab=templates`} className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} />
          Modèles
        </Link>
        <span className="onb-save" role="status">
          {ro ? "Lecture seule" : save === "saved" ? "Enregistré" : save === "error" ? <span style={{ color: "var(--red)" }}>Erreur d&apos;enregistrement</span> : (
            <>
              <LoaderCircle size={12} className="onb-spin" /> Enregistrement…
            </>
          )}
        </span>
        <div className="actions">
          <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            {sections.length} étapes · {questionCount(sections)} questions
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => setPreview(true)}>
            <Eye size={14} />
            Aperçu client
          </button>
        </div>
      </div>

      <div className="onb-ed">
        <div className="onb-ed-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Menu
              trigger={(o) => (
                <button className="obj-ic" style={{ ["--s" as string]: "38px", ["--c" as string]: "var(--accent)" }} onClick={o} disabled={ro} aria-label="Icône du modèle">
                  <Icon name={icon} size={20} />
                </button>
              )}
              items={TEMPLATE_ICONS.map((i) => ({ label: i, icon: <Icon name={i} size={14} />, checked: i === icon, onSelect: () => { setIcon(i); schedule({ icon: i }); } }))}
            />
            <input
              className="input bare onb-ed-name"
              value={name}
              readOnly={ro}
              placeholder="Nom du modèle"
              aria-label="Nom du modèle"
              onChange={(e) => {
                setName(e.target.value);
                schedule({ name: e.target.value });
              }}
            />
          </div>
          <input
            className="input bare onb-ed-desc"
            value={description}
            readOnly={ro}
            placeholder="Description (visible par ton équipe uniquement)"
            aria-label="Description"
            onChange={(e) => {
              setDescription(e.target.value);
              schedule({ description: e.target.value });
            }}
          />
        </div>

        {usedBy > 0 && (
          <div className="onb-warn" style={{ background: "var(--surface-2)" }}>
            <CircleAlert size={15} />
            <span>
              {usedBy} formulaire{usedBy > 1 ? "s" : ""} déjà envoyé{usedBy > 1 ? "s" : ""} avec ce modèle : ils gardent leurs questions d&apos;origine, tes modifications
              s&apos;appliquent aux prochains envois.
            </span>
          </div>
        )}
        {missing.length > 0 && (
          <div className="onb-warn">
            <CircleAlert size={15} />
            <span>
              À renseigner dans les{" "}
              <Link href={`${ws.base}/onboarding?tab=settings`} style={{ textDecoration: "underline" }}>
                réglages
              </Link>{" "}
              : {missing.map((m) => (/^[A-Z]{2}/.test(m.label) ? m.label : m.label[0].toLowerCase() + m.label.slice(1))).join(", ")}.
            </span>
          </div>
        )}

        {sections.map((s, si) => (
          <section key={s.id} className="onb-ed-sec">
            <div className="onb-ed-sec-h">
              <div>
                <span className="onb-ed-sec-n">Étape {si + 1}</span>
                <input className="input bare onb-ed-sec-t" value={s.title} readOnly={ro} placeholder="Titre de l'étape" aria-label="Titre de l'étape" onChange={(e) => updSec(si, { title: e.target.value })} />
                <input
                  className="input bare onb-ed-sec-d"
                  value={s.description ?? ""}
                  readOnly={ro}
                  placeholder="Phrase d'introduction (facultatif)"
                  aria-label="Introduction de l'étape"
                  onChange={(e) => updSec(si, { description: e.target.value })}
                />
              </div>
              {!ro && (
                <div className="onb-ed-tools">
                  <button className="btn btn-ghost btn-sm btn-icon" disabled={si === 0} onClick={() => setSecs(move(sections, si, -1))} aria-label="Monter l'étape">
                    <ArrowUp size={14} />
                  </button>
                  <button className="btn btn-ghost btn-sm btn-icon" disabled={si === sections.length - 1} onClick={() => setSecs(move(sections, si, 1))} aria-label="Descendre l'étape">
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => {
                      if (s.questions.length === 0 || window.confirm(`Supprimer l'étape « ${s.title} » et ses ${s.questions.length} questions ?`)) setSecs(sections.filter((_, i) => i !== si));
                    }}
                    aria-label="Supprimer l'étape"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>

            <div className="onb-ed-qs">
              {s.questions.map((q, qi) => {
                const isOpen = open === q.id;
                return (
                  <div key={q.id} className="onb-ed-q">
                    <div className="onb-ed-q-h" onClick={() => setOpen(isOpen ? null : q.id)} role="button" tabIndex={0} aria-expanded={isOpen} onKeyDown={(e) => e.key === "Enter" && setOpen(isOpen ? null : q.id)}>
                      {isOpen ? <ChevronDown size={14} className="faint" /> : <ChevronRight size={14} className="faint" />}
                      <span className="onb-ed-q-ic" title={QUESTION_TYPE[q.type].name}>
                        {TYPE_ICON[q.type]}
                      </span>
                      <span className={`onb-ed-q-l trunc${q.label ? "" : " empty"}`}>{q.label || "Question sans titre"}</span>
                      {q.required && <span className="faint" style={{ fontSize: "var(--fs-2xs)" }}>Obligatoire</span>}
                      {q.map && <span className="chip">{QUESTION_MAPS.find((m) => m.id === q.map)?.name.replace(" de la fiche client", "")}</span>}
                      {!ro && (
                        <span className="onb-ed-tools" onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-ghost btn-sm btn-icon" disabled={qi === 0} onClick={() => updSec(si, { questions: move(s.questions, qi, -1) })} aria-label="Monter">
                            <ArrowUp size={13} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon" disabled={qi === s.questions.length - 1} onClick={() => updSec(si, { questions: move(s.questions, qi, 1) })} aria-label="Descendre">
                            <ArrowDown size={13} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => updSec(si, { questions: [...s.questions.slice(0, qi + 1), { ...q, id: uid() }, ...s.questions.slice(qi + 1)] })}
                            aria-label="Dupliquer"
                          >
                            <Copy size={13} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => updSec(si, { questions: s.questions.filter((_, i) => i !== qi) })} aria-label="Supprimer">
                            <Trash2 size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                    {isOpen && <QuestionEditor q={q} ro={ro} presets={presets} onChange={(patch) => updQ(si, qi, patch)} />}
                  </div>
                );
              })}
            </div>
            {!ro && (
              <div className="onb-ed-add">
                <Menu
                  trigger={(o) => (
                    <button className="btn btn-sm" onClick={o}>
                      <Plus size={13} />
                      Ajouter une question
                    </button>
                  )}
                  items={typeItems(si)}
                />
              </div>
            )}
          </section>
        ))}

        {!ro && (
          <button
            className="btn onb-ed-add-sec"
            onClick={() => setSecs([...sections, { id: uid("s"), title: "Nouvelle étape", description: "", questions: [] }])}
          >
            <Plus size={14} />
            Ajouter une étape
          </button>
        )}
      </div>

      {preview && <PublicForm data={previewData} onClosePreview={() => setPreview(false)} />}
    </>
  );
}

/** Retire les champs sans objet pour le type de question */
function cleanQ(q: Question): Question {
  const c: Question = { id: q.id, type: q.type, label: q.label };
  if (q.help) c.help = q.help;
  if (q.required) c.required = true;
  if (q.placeholder && ["short", "long", "url", "email", "phone", "number"].includes(q.type)) c.placeholder = q.placeholder;
  if ((q.type === "single" || q.type === "multi") && q.options) c.options = q.options;
  if (q.type === "number" && q.unit) c.unit = q.unit;
  if (q.type === "file") c.accept = q.accept ?? "any";
  if (q.type === "access") c.items = q.items ?? [];
  if (q.map && ["short", "url", "single", "number"].includes(q.type)) c.map = q.map;
  return c;
}

function QuestionEditor({ q, ro, presets, onChange }: { q: Question; ro: boolean; presets: AccessItem[]; onChange: (p: Partial<Question>) => void }) {
  const mapOk = ["short", "url", "single", "number"].includes(q.type);
  return (
    <div className="onb-ed-q-b">
      <div className="onb-ed-row" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(150px, 1fr)" }}>
        <div className="field">
          <label>Question</label>
          <input className="input" value={q.label} readOnly={ro} autoFocus={!q.label} placeholder="Intitulé vu par le client (vouvoiement)" onChange={(e) => onChange({ label: e.target.value })} />
        </div>
        <div className="field">
          <label>Type</label>
          <select className="select" value={q.type} disabled={ro} onChange={(e) => onChange({ type: e.target.value as QuestionType, ...(e.target.value === "single" || e.target.value === "multi" ? { options: q.options ?? ["Option 1", "Option 2"] } : {}) })}>
            {QUESTION_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Aide (facultatif)</label>
        <input className="input" value={q.help ?? ""} readOnly={ro} placeholder="Précision affichée sous la question" onChange={(e) => onChange({ help: e.target.value })} />
      </div>
      <div className="onb-ed-row">
        {["short", "long", "url", "email", "phone", "number"].includes(q.type) && (
          <div className="field">
            <label>Exemple dans le champ</label>
            <input className="input" value={q.placeholder ?? ""} readOnly={ro} onChange={(e) => onChange({ placeholder: e.target.value })} />
          </div>
        )}
        {q.type === "number" && (
          <div className="field">
            <label>Unité</label>
            <input className="input" value={q.unit ?? ""} readOnly={ro} placeholder="€, %, km, x" onChange={(e) => onChange({ unit: e.target.value })} />
          </div>
        )}
        {q.type === "file" && (
          <div className="field">
            <label>Fichiers acceptés</label>
            <select className="select" value={q.accept ?? "any"} disabled={ro} onChange={(e) => onChange({ accept: e.target.value as Question["accept"] })}>
              <option value="images">Images et logos</option>
              <option value="docs">Documents (PDF, présentations, images)</option>
              <option value="any">Tous (vidéos comprises)</option>
            </select>
          </div>
        )}
        {mapOk && (
          <div className="field">
            <label>Relier la réponse à</label>
            <select className="select" value={q.map ?? ""} disabled={ro} onChange={(e) => onChange({ map: (e.target.value || undefined) as QuestionMap | undefined })}>
              {QUESTION_MAPS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {(q.type === "single" || q.type === "multi") && (
        <div className="field">
          <label>Choix proposés</label>
          <div className="onb-ed-opts">
            {(q.options ?? []).map((o, i) => (
              <div key={i} className="onb-ed-opt">
                <input className="input" value={o} readOnly={ro} aria-label={`Choix ${i + 1}`} onChange={(e) => onChange({ options: (q.options ?? []).map((x, k) => (k === i ? e.target.value : x)) })} />
                {!ro && (
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onChange({ options: (q.options ?? []).filter((_, k) => k !== i) })} aria-label="Retirer ce choix">
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
            {!ro && (
              <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ options: [...(q.options ?? []), `Option ${(q.options?.length ?? 0) + 1}`] })}>
                <Plus size={13} />
                Ajouter un choix
              </button>
            )}
          </div>
        </div>
      )}

      {q.type === "access" && <AccessEditor q={q} ro={ro} presets={presets} onChange={onChange} />}

      <div className="onb-ed-flags">
        <label>
          <input type="checkbox" className="toggle" checked={!!q.required} disabled={ro} onChange={(e) => onChange({ required: e.target.checked })} />
          Obligatoire
        </label>
      </div>
    </div>
  );
}

function AccessEditor({ q, ro, presets, onChange }: { q: Question; ro: boolean; presets: AccessItem[]; onChange: (p: Partial<Question>) => void }) {
  const items = q.items ?? [];
  const set = (i: number, patch: Partial<AccessItem>) => onChange({ items: items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const add = (p?: AccessItem) =>
    onChange({ items: [...items, p ? { ...p, id: items.some((x) => x.id === p.id) ? uid("a") : p.id } : { id: uid("a"), name: "Nouvel accès", platform: "other", steps: ["Première étape"] }] });
  return (
    <div className="field">
      <label>Accès demandés</label>
      <div className="onb-ed-items">
        {items.map((item, i) => (
          <div key={item.id} className="onb-ed-item">
            <div className="onb-ed-item-h">
              <input className="input" value={item.name} readOnly={ro} aria-label="Nom de l'accès" onChange={(e) => set(i, { name: e.target.value })} />
              <select className="select" style={{ width: 190 }} value={item.platform} disabled={ro} aria-label="Plateforme" onChange={(e) => set(i, { platform: e.target.value as AccessPlatform })}>
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {!ro && (
                <>
                  <button className="btn btn-ghost btn-sm btn-icon" disabled={i === 0} onClick={() => onChange({ items: items.map((x, k, a) => (k === i - 1 ? a[i] : k === i ? a[i - 1] : x)) })} aria-label="Monter">
                    <ArrowUp size={13} />
                  </button>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onChange({ items: items.filter((_, k) => k !== i) })} aria-label="Retirer cet accès">
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
            <div className="onb-ed-row">
              <input className="input" value={item.link ?? ""} readOnly={ro} placeholder="Lien à ouvrir (https://…)" aria-label="Lien" onChange={(e) => set(i, { link: e.target.value || undefined })} />
              <input className="input" value={item.idLabel ?? ""} readOnly={ro} placeholder="Identifiant demandé (vide : aucun)" aria-label="Identifiant demandé" onChange={(e) => set(i, { idLabel: e.target.value || undefined })} />
            </div>
            <textarea
              className="textarea"
              value={item.steps.join("\n")}
              readOnly={ro}
              aria-label="Étapes du tutoriel, une par ligne"
              placeholder="Une étape par ligne"
              onChange={(e) => set(i, { steps: e.target.value.split("\n") })}
              onBlur={(e) => set(i, { steps: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })}
            />
            <div className="onb-ed-vars">
              Variables :
              {PLACEHOLDERS.map((p) => (
                <code key={p.key} title={p.label}>{`{${p.key}}`}</code>
              ))}
            </div>
          </div>
        ))}
        {!ro && (
          <Menu
            trigger={(o) => (
              <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={o}>
                <Plus size={13} />
                Ajouter un accès
              </button>
            )}
            items={[
              ...presets.map((p) => ({ label: p.name, onSelect: () => add(p) })),
              { separator: true, label: "" },
              { label: "Accès personnalisé", icon: <Plus size={13} />, onSelect: () => add() },
            ]}
          />
        )}
      </div>
    </div>
  );
}
