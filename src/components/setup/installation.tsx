"use client";

import { useState } from "react";
import { CalendarClock, CircleCheck, CircleDashed, Copy, FlaskConical, Info, Loader2, TriangleAlert } from "lucide-react";

import "@/styles/reporting.css";
import "@/styles/setup.css";
import { Crumbs } from "@/components/reporting/common";
import { Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { SETUP_ITEMS, type SetupCtx, type SetupItem } from "@/lib/setup/items";
import type { CheckResult, CronJob } from "@/lib/setup/types";
import { useWorkspace } from "@/lib/workspace/context";

interface Props {
  items: string[];
  envSet: Record<string, boolean>;
  schema: { db: number; code: number };
  jobs: CronJob[] | null;
  ctx: SetupCtx;
  edition: string;
}

type State = "ok" | "todo" | "optional";

/**
 * Réglages > Installation : chaque réglage du serveur avec son état, un test réel et le prompt
 * à coller dans Claude in Chrome ou Claude Code pour le faire à ta place.
 */
export function Installation({ items, envSet, schema, jobs: initialJobs, ctx, edition }: Props) {
  const ws = useWorkspace();
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [jobs, setJobs] = useState(initialJobs);
  const list = SETUP_ITEMS.filter((i) => items.includes(i.id));

  const state = (i: SetupItem): State => {
    const r = i.check ? results[i.check] : undefined;
    if (r) return r.ok ? "ok" : i.required || i.env.some((k) => envSet[k]) ? "todo" : "optional";
    if (i.id === "schema") return schema.db >= schema.code ? "ok" : "todo";
    if (i.id === "cron")
      return envSet.CRON_SECRET && jobs?.length && jobs.every((j) => j.scheduled) && !jobs.some((j) => j.last_error || (j.last_http && j.last_http !== 200)) ? "ok" : "todo";
    if (!i.env.length) return i.required ? "todo" : "optional";
    if (i.env.every((k) => envSet[k])) return "ok";
    return i.required || i.env.some((k) => envSet[k]) ? "todo" : "optional";
  };
  const required = list.filter((i) => i.required);
  const done = required.filter((i) => state(i) === "ok").length;

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <Crumbs items={[{ label: "Réglages", href: `${ws.base}/settings` }, { label: "Installation" }]} />
      <div className="ph">
        <div>
          <h1>Installation</h1>
          <p>
            {edition}, réglages du serveur. Pour chaque étape, copie le prompt dans Claude in Chrome (ou Claude Code) : il fait les manipulations à ta place, puis tu cliques sur « Tester ». Les étapes affichées
            suivent les modules actifs de l&apos;espace.
          </p>
        </div>
        <div className="actions">
          <Badge color={done === required.length ? "var(--green)" : "var(--amber)"}>
            {done} / {required.length} indispensables
          </Badge>
        </div>
      </div>

      <div className="rp-note" style={{ marginBottom: 16 }}>
        <Info size={15} />
        <span>
          Les clés et secrets vont dans les variables d&apos;environnement de ton hébergement ({ctx.host === "vercel" ? "Vercel" : "Hostinger, VPS…"}), jamais dans le code ni dans cette page. Après un ajout, redéploie
          l&apos;app pour qu&apos;elle les lise.
        </span>
      </div>

      <div className="setup-list">
        {list.map((i) => (
          <Step key={i.id} item={i} state={state(i)} envSet={envSet} ctx={ctx} result={i.check ? results[i.check] : undefined} onResult={(r) => setResults((s) => ({ ...s, [i.check!]: r }))}>
            {i.id === "schema" && schema.db < schema.code && (
              <p className="setup-detail">
                Base à la migration {schema.db || "antérieure à 0120"}, code à la {schema.code} : exécute dans l&apos;ordre les fichiers de <code>supabase/migrations</code> de numéro supérieur.
              </p>
            )}
            {i.id === "cron" && (
              <CronBlock
                jobs={jobs}
                canInstall={envSet.CRON_SECRET}
                onJobs={(j) => {
                  setJobs(j);
                  // L'ancien résultat du test ne vaut plus après une (re)programmation
                  setResults((r) => {
                    const next = { ...r };
                    delete next.cron;
                    return next;
                  });
                }}
              />
            )}
          </Step>
        ))}
      </div>
    </div>
  );
}

function Step({
  item,
  state,
  envSet,
  ctx,
  result,
  onResult,
  children,
}: {
  item: SetupItem;
  state: State;
  envSet: Record<string, boolean>;
  ctx: SetupCtx;
  result?: CheckResult;
  onResult: (r: CheckResult) => void;
  children?: React.ReactNode;
}) {
  const ws = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const prompt = item.prompt?.(ctx);

  const test = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/setup/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws: ws.workspace.slug, check: item.check }) });
      const body = (await res.json().catch(() => ({}))) as CheckResult & { error?: string };
      onResult(res.ok ? body : { ok: false, message: body.error ?? `Erreur ${res.status}` });
    } catch {
      onResult({ ok: false, message: "Le serveur ne répond pas. Réessaie dans un instant." });
    } finally {
      setBusy(false);
    }
  };
  const copy = () =>
    navigator.clipboard.writeText(prompt ?? "").then(
      () => toast("Prompt copié : colle-le dans Claude"),
      () => toast("Copie impossible", { error: true }),
    );

  return (
    <section className={`card setup-step ${state}`}>
      <div className="setup-head">
        <span className="setup-icon" aria-hidden>
          {state === "ok" ? <CircleCheck size={18} /> : state === "todo" ? <TriangleAlert size={18} /> : <CircleDashed size={18} />}
        </span>
        <div className="setup-txt">
          <h2>
            {item.title} {!item.required && <span className="faint setup-opt">facultatif</span>}
          </h2>
          <p>{item.why}</p>
          {item.env.length > 0 && (
            <div className="setup-env">
              {item.env.map((k) => (
                <code key={k} className={envSet[k] ? "on" : ""} title={envSet[k] ? "Renseignée sur le serveur" : "Absente du serveur"}>
                  {envSet[k] ? "✓ " : ""}
                  {k}
                </code>
              ))}
            </div>
          )}
        </div>
        <div className="setup-actions">
          {prompt && (
            <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? "Masquer le prompt" : item.tool === "code" ? "Prompt Claude Code" : "Prompt Claude in Chrome"}
            </button>
          )}
          {item.check && (
            <button className="btn btn-sm" onClick={test} disabled={busy}>
              {busy ? <Loader2 size={13} className="spin" /> : <FlaskConical size={13} />} Tester
            </button>
          )}
        </div>
      </div>
      {result && (
        <div className={`rp-note ${result.ok ? "" : "err"} setup-result`} role="status">
          {result.ok ? <CircleCheck size={15} style={{ color: "var(--green)" }} /> : <TriangleAlert size={15} style={{ color: "var(--red)" }} />}
          <span>{result.message}</span>
        </div>
      )}
      {children}
      {open && prompt && (
        <div className="setup-prompt">
          <pre>{prompt}</pre>
          <button className="btn btn-primary btn-sm" onClick={copy}>
            <Copy size={13} /> Copier le prompt
          </button>
        </div>
      )}
    </section>
  );
}

function CronBlock({ jobs, canInstall, onJobs }: { jobs: CronJob[] | null; canInstall: boolean; onJobs: (j: CronJob[] | null) => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!jobs) return <p className="setup-detail">La programmation demande la migration 0120 : mets d&apos;abord la base à jour.</p>;

  const run = async (action: "install" | "uninstall") => {
    setBusy(true);
    try {
      const res = await fetch("/api/setup/cron", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws: ws.workspace.slug, action }) });
      const body = (await res.json().catch(() => ({}))) as { jobs?: CronJob[]; error?: string };
      if (!res.ok) return toast(body.error ?? `Erreur ${res.status}`, { error: true });
      onJobs(body.jobs ?? null);
      toast(action === "install" ? "Tâches programmées : clique sur « Tester » pour un appel réel" : "Tâches retirées");
    } catch {
      toast("Le serveur ne répond pas. Réessaie dans un instant.", { error: true });
    } finally {
      setBusy(false);
    }
  };
  const scheduled = jobs.some((j) => j.scheduled);

  return (
    <div className="setup-detail">
      <table className="setup-jobs">
        <tbody>
          {jobs.map((j) => (
            <tr key={j.name}>
              <td>
                <code>{j.path}</code>
              </td>
              <td className="muted">{j.schedule === "*/15 * * * *" ? "toutes les 15 min" : `chaque jour à ${j.schedule.split(" ")[1]} h ${j.schedule.split(" ")[0].padStart(2, "0")} (UTC)`}</td>
              <td>
                {!j.scheduled ? (
                  <span className="faint">non programmée</span>
                ) : j.last_run ? (
                  <span className={j.last_error || (j.last_http && j.last_http !== 200) ? "setup-ko" : "muted"}>
                    dernier appel {fmtDate(j.last_run)}
                    {j.last_error ? `, ${j.last_error}` : j.last_http === 200 ? ", réponse 200" : j.last_http ? `, réponse ${j.last_http}` : ""}
                  </span>
                ) : (
                  <span className="muted">programmée, pas encore passée</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" onClick={() => run("install")} disabled={busy || !canInstall} title={canInstall ? undefined : "Ajoute d'abord CRON_SECRET sur le serveur"}>
          <CalendarClock size={13} /> {scheduled ? "Reprogrammer" : "Programmer dans Supabase"}
        </button>
        {scheduled && (
          <button className="btn btn-ghost btn-sm" onClick={() => run("uninstall")} disabled={busy}>
            Retirer
          </button>
        )}
      </div>
    </div>
  );
}
