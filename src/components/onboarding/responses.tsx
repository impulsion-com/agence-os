"use client";

import "@/styles/onboarding.css";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Check, CircleAlert, CircleCheck, Copy, Download, Ellipsis, ExternalLink, FileText, FolderKanban, KeyRound, Printer,
  RotateCcw, Send, Trash2, Zap,
} from "lucide-react";

import { SetCrumbs } from "@/components/shell/crumbs";
import { Badge, Progress } from "@/components/ui/misc";
import { ConfirmModal, Menu } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { colorOf } from "@/lib/constants";
import { fileSize } from "@/lib/format";
import { answerText, FORM_STATUS, normalizeUrl } from "@/lib/onboarding/logic";
import type { AccessAnswer, AutomationResult, OnboardingFile, OnboardingForm, Verified } from "@/lib/onboarding/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { PLATFORM_ICON } from "./public-form";
import { accessStats, copyText, deleteForm, formUrl, sendForm, useOrigin } from "./shared";

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** Vue agence des réponses : lisible, imprimable, fichiers téléchargeables, accès à vérifier */
export function OnboardingResponses({
  form, files, contact, template, emailOn,
}: {
  form: OnboardingForm;
  files: OnboardingFile[];
  contact: { id: string; first_name: string; last_name: string; email: string; phone: string } | null;
  template: { id: string; name: string } | null;
  emailOn: boolean;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const mutate = useMutate();
  const origin = useOrigin();
  const [verified, setVerified] = useState<Verified>(form.verified ?? {});
  const [confirm, setConfirm] = useState<"delete" | "reopen" | null>(null);
  const [running, setRunning] = useState(false);
  const company = ws.company(form.company_id);
  const project = ws.project(form.project_id);
  const url = formUrl(origin, form.token);
  const st = FORM_STATUS[form.status];
  const access = accessStats(form.sections, form.answers, verified);
  const creator = ws.member(form.created_by);
  const auto = form.automation as AutomationResult;
  const contactName = contact ? `${contact.first_name} ${contact.last_name}`.trim() : "";

  async function download(f: OnboardingFile, open = false) {
    const { data, error } = await supabaseBrowser().storage.from("attachments").createSignedUrl(f.path, 120, open ? undefined : { download: f.name });
    if (error || !data) return toast("Fichier introuvable", { error: true });
    if (open) window.open(data.signedUrl, "_blank", "noopener");
    else window.location.assign(data.signedUrl);
  }

  async function toggleVerified(key: string, on: boolean) {
    const next: Verified = { ...verified };
    if (on) next[key] = { at: new Date().toISOString(), by: ws.me.id };
    else delete next[key];
    setVerified(next);
    const ok = await mutate(async (sb) => must(await sb.from("onboarding_forms").update({ verified: next }).eq("id", form.id)), { refresh: false });
    if (ok === undefined) setVerified(verified);
  }

  async function remind() {
    try {
      const r = await sendForm(form.id, true);
      if (r.sent) toast(`Relance envoyée à ${r.email}`);
      else toast((await copyText(r.url)) ? "Lien copié : colle-le dans ton message de relance" : "Relance enregistrée");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    }
  }

  async function rerun() {
    setRunning(true);
    const res = await fetch("/api/onboarding/automate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form_id: form.id }) });
    const body = (await res.json().catch(() => ({}))) as { automation?: AutomationResult; error?: string };
    setRunning(false);
    if (!res.ok) return toast(body.error ?? "Échec des automatisations", { error: true });
    const a = body.automation!;
    toast(a.tasks ? `${a.tasks} tâche${a.tasks > 1 ? "s" : ""} ajoutée${a.tasks > 1 ? "s" : ""}` : "Automatisations relancées, rien de nouveau à créer");
    router.refresh();
  }

  const timeline = [
    { label: "Envoyé", at: form.email_sent_at ?? form.sent_at },
    { label: "Ouvert par le client", at: form.opened_at },
    ...(form.reminded_at ? [{ label: `Relancé${form.remind_count > 1 ? ` (${form.remind_count} fois)` : ""}`, at: form.reminded_at }] : []),
    { label: form.status === "completed" ? "Dernière réponse" : "Dernière activité", at: form.last_activity_at },
    { label: "Terminé", at: form.completed_at },
  ];

  return (
    <div className="page wide" style={{ maxWidth: 1240, margin: "0 auto" }}>
      <SetCrumbs items={[{ label: "Onboarding clients", href: `${ws.base}/onboarding` }, { label: company?.name ?? form.title }]} />
      <div className="onb-print-only" style={{ marginBottom: 12, fontSize: 12, color: "#666" }}>
        {ws.workspace.name} · Onboarding · imprimé le {new Date().toLocaleDateString("fr-FR")}
      </div>

      <header className="onb-resp-head">
        <Link href={`${ws.base}/onboarding`} className="btn btn-ghost btn-sm onb-noprint" style={{ alignSelf: "flex-start", marginLeft: -8 }}>
          <ArrowLeft size={14} />
          Tous les formulaires
        </Link>
        <h1>{company?.name ?? form.title}</h1>
        <div className="onb-resp-meta">
          <Badge color={st.color}>{form.status === "in_progress" ? `En cours · ${form.progress} %` : st.name}</Badge>
          <span>{template?.name ?? form.title.split(" · ")[0]}</span>
          {contact && (
            <span>
              {contactName || contact.email}
              {contact.email && contactName && <span className="faint"> · {contact.email}</span>}
            </span>
          )}
          {creator && <span className="faint">Envoyé par {creator.profile.full_name}</span>}
        </div>
        {form.status !== "completed" && (
          <div style={{ maxWidth: 360 }}>
            <Progress value={form.progress} color="var(--amber)" />
          </div>
        )}
        <div className="onb-resp-actions onb-noprint">
          <button className="btn" onClick={() => void copyText(url).then((ok) => toast(ok ? "Lien copié" : "Copie impossible"))}>
            <Copy size={14} />
            Copier le lien
          </button>
          {form.status !== "completed" && ws.canWrite && (
            <button className="btn" onClick={() => void remind()}>
              <Send size={14} />
              {emailOn && contact?.email ? "Relancer par email" : "Relancer"}
            </button>
          )}
          <a className="btn" href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            Page client
          </a>
          <button className="btn" onClick={() => window.print()}>
            <Printer size={14} />
            Imprimer
          </button>
          {ws.canWrite && (
            <Menu
              trigger={(open) => (
                <button className="btn btn-icon" onClick={open} aria-label="Plus d'actions">
                  <Ellipsis size={15} />
                </button>
              )}
              items={[
                ...(form.status === "completed"
                  ? [
                      { label: "Relancer les automatisations", icon: <Zap size={14} />, onSelect: () => void rerun() },
                      { label: "Rouvrir au client", icon: <RotateCcw size={14} />, onSelect: () => setConfirm("reopen") },
                    ]
                  : []),
                { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirm("delete") },
              ]}
            />
          )}
        </div>
      </header>

      <div className="onb-resp">
        <div className="onb-resp-main">
          {form.sections.map((s) => {
            const answered = s.questions.filter((q) => (q.type === "file" ? files.some((f) => f.question_id === q.id) : !!answerText(q, form.answers[q.id]) || q.type === "access")).length;
            return (
              <section key={s.id} className="card onb-rsec">
                <h2>
                  {s.title}
                  <span className="count">
                    {answered}/{s.questions.length}
                  </span>
                </h2>
                <dl style={{ margin: "8px 0 0" }}>
                  {s.questions.map((q) => {
                    if (q.type === "access") {
                      const a = (form.answers[q.id] ?? {}) as AccessAnswer;
                      return (q.items ?? []).map((item) => (
                        <div className="onb-qa" key={`${q.id}:${item.id}`}>
                          <dt>{item.name}</dt>
                          <dd className={a[item.id]?.done ? "" : "empty"}>
                            {a[item.id]?.done ? "Accès donné" : a[item.id]?.skip ? "Impossible pour le client pour l'instant" : "Pas encore fait"}
                            {a[item.id]?.value && <span className="mono"> · {a[item.id]?.value}</span>}
                            {verified[`${q.id}:${item.id}`] && <span style={{ color: "var(--green)" }}> · vérifié</span>}
                          </dd>
                        </div>
                      ));
                    }
                    if (q.type === "file") {
                      const list = files.filter((f) => f.question_id === q.id);
                      return (
                        <div className="onb-qa" key={q.id}>
                          <dt>{q.label}</dt>
                          <dd className={list.length ? "" : "empty"}>
                            {list.length ? (
                              <div className="onb-qa-files">
                                {list.map((f) => (
                                  <span key={f.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <button type="button" className="onb-fbtn" onClick={() => void download(f, true)} title="Ouvrir">
                                      <FileText size={14} />
                                      <span className="trunc">{f.name}</span>
                                    </button>
                                    <span className="fainter num" style={{ fontSize: "var(--fs-xs)" }}>{fileSize(f.size)}</span>
                                    <button type="button" className="btn btn-ghost btn-sm btn-icon onb-noprint" onClick={() => void download(f)} aria-label={`Télécharger ${f.name}`}>
                                      <Download size={13} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              "Aucun fichier"
                            )}
                          </dd>
                        </div>
                      );
                    }
                    const text = answerText(q, form.answers[q.id]);
                    return (
                      <div className="onb-qa" key={q.id}>
                        <dt>{q.label}</dt>
                        <dd className={text ? "" : "empty"}>
                          {!text ? "Sans réponse" : q.type === "url" ? (
                            <a href={normalizeUrl(text)} target="_blank" rel="noreferrer">
                              {text}
                            </a>
                          ) : q.type === "email" ? (
                            <a href={`mailto:${text}`}>{text}</a>
                          ) : (
                            text
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            );
          })}
        </div>

        <aside className="onb-resp-side">
          {access.total > 0 && (
            <section className="card onb-side-card">
              <div className="card-h">
                <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <KeyRound size={15} /> Accès
                </h3>
                <span className="faint num" style={{ fontSize: "var(--fs-xs)" }}>
                  {access.checked} / {access.total} vérifiés
                </span>
              </div>
              <ul className="onb-chk">
                {form.sections.flatMap((s) =>
                  s.questions
                    .filter((q) => q.type === "access")
                    .flatMap((q) =>
                      (q.items ?? []).map((item) => {
                        const a = ((form.answers[q.id] ?? {}) as AccessAnswer)[item.id];
                        const key = `${q.id}:${item.id}`;
                        const v = verified[key];
                        return (
                          <li key={key}>
                            <span className="obj-ic" style={{ ["--s" as string]: "26px", ["--c" as string]: v ? "var(--green)" : "var(--text-3)" }}>
                              {PLATFORM_ICON[item.platform]}
                            </span>
                            <span className="onb-chk-t">
                              <strong>{item.name}</strong>
                              {a?.value && <span className="mono">{a.value}</span>}
                              {v ? (
                                <span className="onb-chk-s ok">
                                  <CircleCheck size={12} /> Vérifié{ws.member(v.by)?.profile.full_name ? ` par ${ws.member(v.by)!.profile.full_name.split(" ")[0]}` : ""}
                                </span>
                              ) : a?.done ? (
                                <span className="onb-chk-s warn">
                                  <Check size={12} /> Déclaré fait par le client
                                </span>
                              ) : a?.skip ? (
                                <span className="onb-chk-s warn">
                                  <CircleAlert size={12} /> Le client ne peut pas pour l&apos;instant
                                </span>
                              ) : (
                                <span className="onb-chk-s no">Pas encore fait</span>
                              )}
                            </span>
                            {ws.canWrite && (
                              <label className="onb-verify onb-noprint" title="Tu as vérifié que l'accès fonctionne">
                                <input type="checkbox" className="check" checked={!!v} onChange={(e) => void toggleVerified(key, e.target.checked)} />
                                Vérifié
                              </label>
                            )}
                          </li>
                        );
                      }),
                    ),
                )}
              </ul>
            </section>
          )}

          {form.status === "completed" && (
            <section className="card onb-side-card">
              <div className="card-h">
                <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Zap size={15} /> Automatisations
                </h3>
              </div>
              <div className="onb-auto-res">
                {auto?.at ? (
                  <>
                    {project && (
                      <div>
                        <FolderKanban size={14} />
                        <span>
                          {auto.project_created ? "Projet créé : " : "Projet : "}
                          <Link href={`${ws.base}/projects/${project.key}`} style={{ textDecoration: "underline" }}>
                            <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: colorOf(project.color), marginRight: 5 }} />
                            {project.name}
                          </Link>
                        </span>
                      </div>
                    )}
                    {!!auto.tasks && (
                      <div>
                        <Check size={14} />
                        <span>
                          {auto.tasks} tâche{auto.tasks > 1 ? "s" : ""} « Vérifier l&apos;accès » ajoutée{auto.tasks > 1 ? "s" : ""}
                        </span>
                      </div>
                    )}
                    {auto.kpis && Object.keys(auto.kpis).length > 0 && (
                      <div>
                        <Check size={14} />
                        <span>
                          KPI cibles enregistrés :{" "}
                          {Object.entries(auto.kpis)
                            .map(([k, v]) => `${k.toUpperCase()} ${String(v).replace(".", ",")}${k === "cpa" ? " €" : ""}`)
                            .join(", ")}
                        </span>
                      </div>
                    )}
                    {auto.company && auto.company.length > 0 && (
                      <div>
                        <Check size={14} />
                        <span>Fiche client complétée : {auto.company.join(" et ")}</span>
                      </div>
                    )}
                    {auto.errors?.map((e) => (
                      <div key={e} className="err">
                        <CircleAlert size={14} />
                        <span>{e}</span>
                      </div>
                    ))}
                    {!project && !auto.tasks && !Object.keys(auto.kpis ?? {}).length && !auto.company?.length && !auto.errors?.length && (
                      <span className="faint">Rien à faire : options désactivées ou informations déjà présentes.</span>
                    )}
                  </>
                ) : (
                  <span className="faint">Pas encore exécutées.</span>
                )}
                {ws.canWrite && (
                  <button className="btn btn-sm onb-noprint" style={{ alignSelf: "flex-start", marginTop: 4 }} disabled={running} onClick={() => void rerun()}>
                    <Zap size={13} />
                    {running ? "En cours…" : "Relancer"}
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="card onb-side-card onb-noprint">
            <div className="card-h">
              <h3>Suivi</h3>
            </div>
            <ul className="onb-timeline">
              {timeline.map((t) => (
                <li key={t.label} className={t.at ? "on" : ""}>
                  <span />
                  {t.label}
                  {t.at && <span className="faint" style={{ position: "static", border: 0, background: "none", width: "auto", height: "auto" }}> · {dt(t.at)}</span>}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {confirm === "delete" && (
        <ConfirmModal
          title="Supprimer ce formulaire ?"
          text="Les réponses et les fichiers déposés par le client seront définitivement supprimés, et le lien ne fonctionnera plus."
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const ok = await mutate((sb) => deleteForm(sb, form.id).then(() => true), { success: "Formulaire supprimé", refresh: false });
            if (ok) router.push(`${ws.base}/onboarding`);
          }}
        />
      )}
      {confirm === "reopen" && (
        <ConfirmModal
          title="Rouvrir le formulaire ?"
          text="Le client pourra de nouveau modifier ses réponses avec le même lien. Il devra le renvoyer pour le terminer."
          confirmLabel="Rouvrir"
          danger={false}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("onboarding_forms").update({ status: "in_progress", completed_at: null }).eq("id", form.id)), { success: "Formulaire rouvert" });
          }}
        />
      )}
    </div>
  );
}
