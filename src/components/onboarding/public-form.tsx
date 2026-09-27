"use client";

import "@/styles/onboarding.css";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Building2, ChartColumn, Check, ChevronDown, CircleAlert, CircleCheck, Clock, CloudCheck, CloudOff,
  CloudUpload, Copy, ExternalLink, Eye, FileText, Globe, KeyRound, ListChecks, LoaderCircle, Lock, MapPin, Megaphone, Search,
  SearchCheck, Send, ShoppingBag, Tags, Trash2, X,
} from "lucide-react";

import { fileSize } from "@/lib/format";
import {
  ACCEPT, MAX_FILE_SIZE, countFiles, nb, fillSegments, formErrors, formProgress, sectionProgress, type AgencyVars,
} from "@/lib/onboarding/logic";
import type { AccessAnswer, AccessItem, AccessPlatform, AnswerValue, Answers, PublicFormData, Question } from "@/lib/onboarding/types";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = "welcome" | number | "review" | "done";
type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
type PubFile = PublicFormData["files"][number] & { uploading?: boolean };

export const PLATFORM_ICON: Record<AccessPlatform, ReactNode> = {
  meta_bm: <Building2 size={17} />,
  meta_ads: <Megaphone size={17} />,
  google_ads: <Search size={17} />,
  ga4: <ChartColumn size={17} />,
  gtm: <Tags size={17} />,
  cms: <ShoppingBag size={17} />,
  search_console: <SearchCheck size={17} />,
  gbp: <MapPin size={17} />,
  other: <KeyRound size={17} />,
};

/** Durée estimée : 30 s par question, 2 min par accès */
function estimate(data: PublicFormData) {
  let s = 0;
  for (const sec of data.sections)
    for (const q of sec.questions) s += q.type === "access" ? (q.items?.length ?? 0) * 120 : q.type === "long" ? 60 : 30;
  return Math.max(5, Math.round(s / 60 / 5) * 5);
}

/**
 * Formulaire d'onboarding côté client final (/f/[token]).
 * Mobile d'abord, une section par écran, sauvegarde automatique, reprise avec le même lien.
 * En aperçu (membre connecté ou éditeur de modèle), rien n'est enregistré.
 */
export function PublicForm({ data, onClosePreview }: { data: PublicFormData; onClosePreview?: () => void }) {
  const { sections } = data;
  const agency: AgencyVars = data.agency;
  const [answers, setAnswers] = useState<Answers>(data.answers ?? {});
  const [files, setFiles] = useState<PubFile[]>(data.files ?? []);
  const [step, setStep] = useState<Step>(data.status === "completed" ? "done" : "welcome");
  const [save, setSave] = useState<SaveState>("idle");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [completedAt, setCompletedAt] = useState(data.completed_at);
  const answersRef = useRef(answers);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);
  const mnavRef = useRef<HTMLDetailsElement>(null);

  const fileCounts = useMemo(() => countFiles(files.filter((f) => !f.uploading)), [files]);
  const progress = formProgress(sections, answers, fileCounts);
  const errors = useMemo(() => ({ ...formErrors(sections, answers, fileCounts) }), [sections, answers, fileCounts]);
  const started = progress > 0;
  const api = (p: string) => `/api/onboarding/${data.token}/${p}`;

  // ---------------- Sauvegarde automatique ----------------
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    if (data.preview) {
      dirty.current = false;
      setSave("saved");
      return;
    }
    dirty.current = false;
    setSave("saving");
    try {
      const res = await fetch(api("save"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: answersRef.current }) });
      if (!res.ok) throw new Error();
      setSave("saved");
    } catch {
      dirty.current = true;
      setSave("error");
      timer.current = setTimeout(() => void flush(), 5000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.preview, data.token]);

  const setAnswer = (id: string, v: AnswerValue) => {
    const next = { ...answersRef.current, [id]: v };
    answersRef.current = next;
    setAnswers(next);
    setServerErrors((e) => (e[id] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== id)) : e));
    dirty.current = true;
    setSave("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 900);
  };

  // Dernière sauvegarde si l'onglet est fermé ou masqué
  useEffect(() => {
    if (data.preview) return;
    const beacon = () => {
      if (!dirty.current) return;
      dirty.current = false;
      navigator.sendBeacon?.(api("save"), new Blob([JSON.stringify({ answers: answersRef.current })], { type: "application/json" }));
    };
    const onHide = () => document.visibilityState === "hidden" && beacon();
    window.addEventListener("pagehide", beacon);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", beacon);
      document.removeEventListener("visibilitychange", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.preview, data.token]);

  const go = (s: Step) => {
    void flush();
    setStep(s);
    if (mnavRef.current) mnavRef.current.open = false;
    requestAnimationFrame(() => {
      if (onClosePreview) topRef.current?.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  /** Première section incomplète (reprise) */
  const resumeAt = () => {
    const i = sections.findIndex((s) => sectionProgress(s, answers, fileCounts).pct < 100);
    return i === -1 ? "review" : i;
  };

  async function submit() {
    setShowErrors(true);
    setSubmitError(null);
    if (Object.keys(errors).length) {
      setSubmitError("Quelques réponses obligatoires manquent encore.");
      return;
    }
    if (data.preview) {
      setSubmitError("Aperçu : l'envoi est désactivé.");
      return;
    }
    setSubmitting(true);
    await flush();
    try {
      const res = await fetch(api("submit"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: answersRef.current }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: Record<string, string> };
      if (!res.ok) {
        setServerErrors(body.errors ?? {});
        setSubmitError(body.error ?? "Envoi impossible, réessayez dans un instant.");
      } else {
        setCompletedAt(new Date().toISOString());
        go("done");
      }
    } catch {
      setSubmitError("Connexion perdue : vos réponses sont enregistrées, réessayez dans un instant.");
    }
    setSubmitting(false);
  }

  // ---------------- Fichiers ----------------
  async function upload(q: Question, list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
      if (file.size > MAX_FILE_SIZE) {
        setServerErrors((e) => ({ ...e, [q.id]: `« ${file.name} » dépasse ${Math.round(MAX_FILE_SIZE / 1048576)} Mo. Pour une vidéo lourde, partagez plutôt un lien.` }));
        continue;
      }
      if (data.preview) {
        setServerErrors((e) => ({ ...e, [q.id]: "Aperçu : l'envoi de fichiers est désactivé." }));
        return;
      }
      setFiles((f) => [...f, { id: tempId, question_id: q.id, name: file.name, size: file.size, mime: file.type, uploading: true }]);
      try {
        const r1 = await fetch(api("upload"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: q.id, name: file.name, size: file.size }) });
        const signed = (await r1.json()) as { path?: string; token?: string; error?: string };
        if (!r1.ok || !signed.path || !signed.token) throw new Error(signed.error);
        const up = await supabaseBrowser().storage.from("attachments").uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || undefined });
        if (up.error) throw new Error("L'envoi du fichier a échoué, réessayez.");
        const r2 = await fetch(api("files"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question_id: q.id, path: signed.path, name: file.name, size: file.size, mime: file.type }),
        });
        const conf = (await r2.json()) as { file?: PubFile; error?: string };
        if (!r2.ok || !conf.file) throw new Error(conf.error);
        setFiles((f) => f.map((x) => (x.id === tempId ? conf.file! : x)));
        setSave("saved");
      } catch (e) {
        setFiles((f) => f.filter((x) => x.id !== tempId));
        setServerErrors((er) => ({ ...er, [q.id]: (e instanceof Error && e.message) || "L'envoi du fichier a échoué, réessayez." }));
      }
    }
  }

  async function removeFile(f: PubFile) {
    setFiles((l) => l.filter((x) => x.id !== f.id));
    if (data.preview) return;
    const res = await fetch(api("files"), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }) });
    if (!res.ok) setFiles((l) => [...l, f]);
  }

  // ---------------- Rendu ----------------
  const errOf = (q: Question) => serverErrors[q.id] ?? (showErrors ? errors[q.id] : undefined);
  const idx = typeof step === "number" ? step : -1;
  const sec = idx >= 0 ? sections[idx] : null;
  const firstName = data.contact?.first_name?.trim();

  const nav = (
    <ol className="onb-nav-list">
      {sections.map((s, i) => {
        const p = sectionProgress(s, answers, fileCounts);
        const miss = showErrors && s.questions.some((q) => errors[q.id]);
        return (
          <li key={s.id}>
            <button type="button" className={`onb-nav-item${i === idx ? " on" : ""}${miss ? " miss" : ""}`} onClick={() => go(i)} aria-current={i === idx ? "step" : undefined}>
              <span className={`onb-nav-n${p.pct === 100 ? " ok" : ""}`}>{p.pct === 100 ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
              <span className="onb-nav-t">{s.title}</span>
              {miss ? <CircleAlert size={14} className="onb-nav-warn" /> : p.pct > 0 && p.pct < 100 ? <span className="onb-nav-p num">{p.pct} %</span> : null}
            </button>
          </li>
        );
      })}
      <li>
        <button type="button" className={`onb-nav-item${step === "review" ? " on" : ""}`} onClick={() => go("review")}>
          <span className="onb-nav-n">
            <Send size={11} />
          </span>
          <span className="onb-nav-t">Vérifier et envoyer</span>
        </button>
      </li>
    </ol>
  );

  return (
    <div className={`onb-pub${onClosePreview ? " is-preview-overlay" : ""}`} data-accent={data.agency.accent} ref={topRef}>
      <header className="onb-top">
        <div className="onb-top-in">
          <span className="onb-brand">
            <span className="onb-mark" aria-hidden>
              {(data.agency.name || "A").slice(0, 1).toUpperCase()}
            </span>
            <span className="trunc">{data.agency.name}</span>
          </span>
          {step !== "done" && <SaveBadge state={data.preview ? "preview" : save} />}
          {onClosePreview && (
            <button type="button" className="btn btn-sm" onClick={onClosePreview}>
              <X size={14} />
              Fermer l&apos;aperçu
            </button>
          )}
        </div>
        {step !== "done" && (
          <div className="onb-bar" role="progressbar" aria-label="Progression du formulaire" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ ["--p" as string]: progress / 100 }} />
          </div>
        )}
      </header>

      {data.preview && !onClosePreview && (
        <div className="onb-preview-note" role="status">
          <Eye size={14} />
          <span>Aperçu : vous êtes connecté à l&apos;espace de l&apos;agence, vos saisies ne sont pas enregistrées et cette visite ne compte pas comme une ouverture.</span>
        </div>
      )}

      {step === "welcome" && (
        <main className="onb-wrap onb-narrow">
          <section className="onb-card onb-welcome">
            <p className="onb-eyebrow">{data.company ? `Onboarding · ${data.company}` : "Onboarding"}</p>
            <h1>{firstName ? `Bienvenue ${firstName} !` : "Bienvenue !"}</h1>
            <p className="onb-lead">
              {data.intro?.trim() ||
                `Ce formulaire permet à ${data.agency.name || "l'agence"} de préparer vos campagnes : votre activité, vos objectifs, vos créations et l'accès à vos comptes.`}
            </p>
            <ul className="onb-facts">
              <li>
                <Clock size={15} />
                Environ {estimate(data)} minutes
              </li>
              <li>
                <CloudCheck size={15} />
                Enregistrement automatique
              </li>
              <li>
                <Lock size={15} />
                Aucun mot de passe demandé
              </li>
            </ul>
            <ol className="onb-toc">
              {sections.map((s, i) => {
                const p = sectionProgress(s, answers, fileCounts);
                return (
                  <li key={s.id}>
                    <span className={`onb-nav-n${p.pct === 100 ? " ok" : ""}`}>{p.pct === 100 ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
                    <span>{s.title}</span>
                  </li>
                );
              })}
            </ol>
            <div className="onb-welcome-cta">
              <button type="button" className="btn btn-primary onb-btn-lg" onClick={() => go(started ? resumeAt() : 0)}>
                {started ? `Reprendre où j'en étais (${progress} %)` : "Commencer"}
                <ArrowRight size={16} />
              </button>
              <p className="onb-muted">Vous pouvez vous arrêter à tout moment et revenir plus tard avec le même lien.</p>
            </div>
          </section>
        </main>
      )}

      {sec && (
        <div className="onb-wrap onb-layout">
          <aside className="onb-aside" aria-label="Étapes">
            <p className="onb-aside-h">
              <ListChecks size={14} /> {progress} % complété
            </p>
            {nav}
          </aside>
          <main className="onb-main">
            <details className="onb-mnav" ref={mnavRef}>
              <summary>
                <span>
                  Étape {idx + 1} sur {sections.length}
                </span>
                <span className="onb-mnav-p num">{progress} %</span>
                <ChevronDown size={16} />
              </summary>
              {nav}
            </details>

            <section className="onb-card onb-sec" aria-labelledby={`sec-${sec.id}`} key={sec.id}>
              <p className="onb-eyebrow">
                Étape {idx + 1} sur {sections.length}
              </p>
              <h2 id={`sec-${sec.id}`}>{nb(sec.title)}</h2>
              {sec.description && <p className="onb-lead">{nb(sec.description)}</p>}
              <div className="onb-qs">
                {sec.questions.map((q) => (
                  <QuestionField
                    key={q.id}
                    q={q}
                    value={answers[q.id]}
                    onChange={(v) => setAnswer(q.id, v)}
                    error={errOf(q)}
                    agency={agency}
                    files={files.filter((f) => f.question_id === q.id)}
                    onUpload={(l) => void upload(q, l)}
                    onRemoveFile={(f) => void removeFile(f)}
                  />
                ))}
              </div>
            </section>

            <nav className="onb-steps-nav" aria-label="Navigation entre les étapes">
              <button type="button" className="btn onb-btn-lg" onClick={() => go(idx === 0 ? "welcome" : idx - 1)}>
                <ArrowLeft size={16} />
                <span className="onb-hide-xs">Précédent</span>
              </button>
              <span className="onb-steps-count num">
                {idx + 1} / {sections.length}
              </span>
              <button type="button" className="btn btn-primary onb-btn-lg" onClick={() => go(idx === sections.length - 1 ? "review" : idx + 1)}>
                {idx === sections.length - 1 ? "Vérifier et envoyer" : "Suivant"}
                <ArrowRight size={16} />
              </button>
            </nav>
          </main>
        </div>
      )}

      {step === "review" && (
        <div className="onb-wrap onb-layout">
          <aside className="onb-aside" aria-label="Étapes">
            <p className="onb-aside-h">
              <ListChecks size={14} /> {progress} % complété
            </p>
            {nav}
          </aside>
          <main className="onb-main">
            <section className="onb-card onb-review">
              <p className="onb-eyebrow">Dernière étape</p>
              <h2>Vérifier et envoyer</h2>
              <p className="onb-lead">
                Une fois envoyées, vos réponses sont transmises à {data.agency.name || "l'agence"}. Les champs facultatifs peuvent rester vides.
              </p>
              <ul className="onb-recap">
                {sections.map((s, i) => {
                  const p = sectionProgress(s, answers, fileCounts);
                  const missing = s.questions.filter((q) => errors[q.id]);
                  return (
                    <li key={s.id} className={missing.length ? "miss" : ""}>
                      <span className={`onb-nav-n${missing.length ? " warn" : p.pct === 100 ? " ok" : ""}`}>
                        {missing.length ? <CircleAlert size={13} /> : <Check size={12} strokeWidth={3} />}
                      </span>
                      <div>
                        <strong>{s.title}</strong>
                        <span>
                          {missing.length
                            ? nb(`${missing.length} réponse${missing.length > 1 ? "s" : ""} obligatoire${missing.length > 1 ? "s" : ""} à compléter : ${missing.map((q) => q.label).join(", ")}`)
                            : p.pct === 100
                              ? "Complet"
                              : "Prêt à envoyer (champs facultatifs laissés vides)"}
                        </span>
                      </div>
                      <button type="button" className="btn btn-sm" onClick={() => { setShowErrors(true); go(i); }}>
                        {missing.length ? "Compléter" : "Modifier"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {submitError && (
                <p className="onb-err-box" role="alert">
                  <CircleAlert size={16} />
                  {submitError}
                </p>
              )}
              <div className="onb-submit">
                <button type="button" className="btn btn-primary onb-btn-lg" disabled={submitting} onClick={() => void submit()}>
                  {submitting ? <LoaderCircle size={16} className="onb-spin" /> : <Send size={16} />}
                  {submitting ? "Envoi en cours…" : "Envoyer mes réponses"}
                </button>
                <p className="onb-muted">Vous pouvez encore revenir sur chaque étape avant l&apos;envoi.</p>
              </div>
            </section>
          </main>
        </div>
      )}

      {step === "done" && (
        <main className="onb-wrap onb-narrow">
          <section className="onb-card onb-done">
            <span className="onb-done-ic">
              <CircleCheck size={28} />
            </span>
            <h1>Merci{firstName ? ` ${firstName}` : ""}, c&apos;est envoyé !</h1>
            <p className="onb-lead">
              {data.agency.name || "L'agence"} a bien reçu vos réponses
              {completedAt && <> le {new Date(completedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</>}.{" "}
              {data.owner ? `${data.owner.full_name} revient vers vous` : "Nous revenons vers vous"} très rapidement pour vérifier les accès et lancer la suite.
            </p>
            {data.owner?.email && (
              <a className="btn" href={`mailto:${data.owner.email}`}>
                Écrire à {data.owner.full_name.split(" ")[0]}
              </a>
            )}
            <p className="onb-muted">Vous pouvez fermer cette page.</p>
          </section>
        </main>
      )}

      <p className="onb-foot">Formulaire sécurisé · {data.agency.name}</p>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState | "preview" }) {
  if (state === "preview")
    return (
      <span className="onb-save">
        <Eye size={13} /> Aperçu
      </span>
    );
  if (state === "idle") return <span className="onb-save faint"><CloudCheck size={13} /> Enregistrement auto</span>;
  if (state === "error")
    return (
      <span className="onb-save err" role="status">
        <CloudOff size={13} /> Hors ligne, nouvel essai…
      </span>
    );
  if (state === "saved")
    return (
      <span className="onb-save ok" role="status">
        <CloudCheck size={13} /> Enregistré
      </span>
    );
  return (
    <span className="onb-save" role="status">
      <LoaderCircle size={13} className="onb-spin" /> Enregistrement…
    </span>
  );
}

// ---------------------------------------------------------------------
// Question
// ---------------------------------------------------------------------
function QuestionField({
  q, value, onChange, error, agency, files, onUpload, onRemoveFile,
}: {
  q: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  error?: string;
  agency: AgencyVars;
  files: PubFile[];
  onUpload: (l: FileList | File[]) => void;
  onRemoveFile: (f: PubFile) => void;
}) {
  const id = `q-${q.id}`;
  const s = typeof value === "string" ? value : "";
  const describedBy = [q.help ? `${id}-help` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, "aria-invalid": !!error || undefined, "aria-describedby": describedBy, "aria-required": q.required || undefined };
  const group = q.type === "single" || q.type === "multi" || q.type === "access" || q.type === "file";

  let input: ReactNode = null;
  switch (q.type) {
    case "long":
      input = <textarea {...common} className="textarea onb-input onb-auto" rows={3} value={s} placeholder={q.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "number":
      input = (
        <div className="onb-num">
          <input {...common} className="input onb-input" inputMode="decimal" value={s} placeholder={q.placeholder ?? "0"} onChange={(e) => onChange(e.target.value)} />
          {q.unit && <span className="onb-unit">{q.unit}</span>}
        </div>
      );
      break;
    case "date":
      input = <input {...common} type="date" className="input onb-input onb-date" value={s} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "single":
      input = (
        <div className="onb-opts" role="radiogroup" aria-labelledby={`${id}-l`}>
          {(q.options ?? []).map((o) => (
            <label key={o} className={`onb-opt${s === o ? " on" : ""}`}>
              <input type="radio" name={id} checked={s === o} onChange={() => onChange(o)} />
              <span className="onb-radio" aria-hidden />
              <span>{o}</span>
            </label>
          ))}
        </div>
      );
      break;
    case "multi": {
      const arr = Array.isArray(value) ? value : [];
      input = (
        <div className="onb-opts chips" role="group" aria-labelledby={`${id}-l`}>
          {(q.options ?? []).map((o) => {
            const on = arr.includes(o);
            return (
              <label key={o} className={`onb-chip${on ? " on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])} />
                {on && <Check size={13} strokeWidth={2.6} />}
                <span>{o}</span>
              </label>
            );
          })}
        </div>
      );
      break;
    }
    case "file":
      input = <FileField q={q} files={files} onUpload={onUpload} onRemove={onRemoveFile} />;
      break;
    case "access":
      input = <AccessList q={q} value={(value && typeof value === "object" && !Array.isArray(value) ? value : {}) as AccessAnswer} onChange={onChange} agency={agency} />;
      break;
    default: {
      const t = q.type;
      input = (
        <input
          {...common}
          className="input onb-input"
          type={t === "email" ? "email" : t === "url" ? "url" : t === "phone" ? "tel" : "text"}
          inputMode={t === "email" ? "email" : t === "url" ? "url" : t === "phone" ? "tel" : undefined}
          autoComplete={t === "email" ? "email" : t === "phone" ? "tel" : t === "url" ? "url" : "off"}
          value={s}
          placeholder={q.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }

  const Label = group ? "p" : "label";
  return (
    <div className={`onb-q${error ? " has-err" : ""}`} data-q={q.id}>
      <Label className="onb-q-l" id={`${id}-l`} {...(group ? {} : { htmlFor: id })}>
        {nb(q.label)}
        {!q.required && <span className="onb-opt-tag">facultatif</span>}
      </Label>
      {q.help && (
        <p className="onb-q-help" id={`${id}-help`}>
          {nb(q.help)}
        </p>
      )}
      {input}
      {error && (
        <p className="onb-q-err" id={`${id}-err`} role="alert">
          <CircleAlert size={13} />
          {error}
        </p>
      )}
    </div>
  );
}

function FileField({ q, files, onUpload, onRemove }: { q: Question; files: PubFile[]; onUpload: (l: FileList | File[]) => void; onRemove: (f: PubFile) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="onb-files">
      <div
        className={`onb-drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files);
        }}
      >
        <CloudUpload size={22} />
        <span>
          <button type="button" className="onb-link" onClick={() => inputRef.current?.click()}>
            Choisir des fichiers
          </button>
          <span className="onb-hide-xs"> ou glissez-les ici</span>
        </span>
        <span className="onb-muted">{Math.round(MAX_FILE_SIZE / 1048576)} Mo maximum par fichier</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={ACCEPT[q.accept ?? "any"] || undefined}
          aria-label={q.label}
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="onb-file-list">
          {files.map((f) => (
            <li key={f.id}>
              <span className="onb-file-ic">{f.uploading ? <LoaderCircle size={15} className="onb-spin" /> : <FileText size={15} />}</span>
              <span className="trunc">{f.name}</span>
              <span className="onb-muted num">{f.uploading ? "Envoi…" : fileSize(f.size)}</span>
              {!f.uploading && (
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Retirer ${f.name}`} onClick={() => onRemove(f)}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Checklist d'accès avec mini-tutoriels
// ---------------------------------------------------------------------
function AccessList({ q, value, onChange, agency }: { q: Question; value: AccessAnswer; onChange: (v: AccessAnswer) => void; agency: AgencyVars }) {
  const items = q.items ?? [];
  const settled = (e?: { done?: boolean; skip?: boolean }) => !!(e?.done || e?.skip);
  const [open, setOpen] = useState<string | null>(() => items.find((i) => !settled(value[i.id]))?.id ?? null);
  const doneCount = items.filter((i) => value[i.id]?.done).length;
  const update = (item: AccessItem, patch: { done?: boolean; skip?: boolean; value?: string }) => {
    const next = { ...value, [item.id]: { ...value[item.id], ...patch } };
    onChange(next);
    if (patch.done || patch.skip) setOpen(items.find((i) => i.id !== item.id && !settled(next[i.id]))?.id ?? null);
  };
  return (
    <div className="onb-access">
      <div className="onb-access-sum">
        <span className="num">
          {doneCount} / {items.length} accès donnés
        </span>
        <span className="onb-mini-bar">
          <i style={{ ["--p" as string]: items.length ? doneCount / items.length : 0 }} />
        </span>
      </div>
      {items.map((item) => {
        const a = value[item.id] ?? {};
        const isOpen = open === item.id;
        const host = item.link ? item.link.replace(/^https?:\/\//, "").split("/")[0] : "";
        return (
          <div key={item.id} className={`onb-acc${a.done ? " done" : a.skip ? " skip" : ""}${isOpen ? " open" : ""}`}>
            <button type="button" className="onb-acc-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.id)}>
              <span className="onb-acc-ic">{PLATFORM_ICON[item.platform] ?? <Globe size={17} />}</span>
              <span className="onb-acc-name">
                <strong>{item.name}</strong>
                <small>{a.done ? "C'est fait, merci !" : a.skip ? "Signalé : pas possible pour l'instant" : `${item.steps.length} étape${item.steps.length > 1 ? "s" : ""}`}</small>
              </span>
              <span className="onb-acc-state">{a.done ? <Check size={15} strokeWidth={2.8} /> : a.skip ? <CircleAlert size={16} /> : <ChevronDown size={16} />}</span>
            </button>
            {isOpen && (
              <div className="onb-acc-b">
                <ol className="onb-steps">
                  {item.steps.map((st, i) => (
                    <li key={i}>
                      <span className="onb-step-n">{i + 1}</span>
                      <p>
                        {fillSegments(st, agency).map((seg, k) =>
                          "text" in seg ? <span key={k}>{nb(seg.text)}</span> : <VarChip key={k} seg={seg} />,
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
                {item.link && (
                  <a className="btn onb-open" href={item.link} target="_blank" rel="noopener noreferrer">
                    Ouvrir {host}
                    <ExternalLink size={13} />
                  </a>
                )}
                {item.idLabel && (
                  <div className="field onb-acc-id">
                    <label htmlFor={`acc-${q.id}-${item.id}`}>
                      {item.idLabel} <span className="onb-opt-tag">facultatif</span>
                    </label>
                    <input id={`acc-${q.id}-${item.id}`} className="input onb-input" value={a.value ?? ""} onChange={(e) => update(item, { value: e.target.value })} />
                  </div>
                )}
                <label className={`onb-done-check${a.done ? " on" : ""}`}>
                  <input type="checkbox" className="check" checked={!!a.done} onChange={(e) => update(item, { done: e.target.checked, skip: false })} />
                  <span>C&apos;est fait</span>
                </label>
                {!a.done && (
                  <button type="button" className="onb-skip" aria-pressed={!!a.skip} onClick={() => update(item, { skip: !a.skip })}>
                    {a.skip ? "Finalement, je vais le faire" : "Je ne peux pas le faire pour l'instant (pas concerné, pas les droits…)"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VarChip({ seg }: { seg: { key: string; value: string; missing: boolean; copy: boolean } }) {
  const [copied, setCopied] = useState(false);
  if (seg.missing) return <span className="onb-var missing">[information communiquée par l&apos;agence]</span>;
  if (!seg.copy) return <strong>{seg.value}</strong>;
  return (
    <button
      type="button"
      className={`onb-var${copied ? " copied" : ""}`}
      title="Copier"
      onClick={() => {
        void navigator.clipboard?.writeText(seg.value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <span className="mono">{seg.value}</span>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span className="sr">{copied ? "Copié" : "Copier"}</span>
    </button>
  );
}
