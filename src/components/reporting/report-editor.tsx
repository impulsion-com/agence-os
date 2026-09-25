"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Link2, Link2Off, Trash2 } from "lucide-react";

import "@/styles/reporting.css";
import { ConfirmModal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { rangeLabel } from "@/lib/ads/metrics";
import type { ReportData } from "@/lib/ads/load";
import { Crumbs } from "./common";
import { ReportView } from "./report-view";

export function ReportEditor({ data, publicUrl }: { data: ReportData; publicUrl: string }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const router = useRouter();
  const r = data.report;
  const [form, setForm] = useState({
    title: r.title,
    period_start: r.period_start,
    period_end: r.period_end,
    commentary: r.commentary,
    next_steps: r.next_steps,
  });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const dirty =
    form.title !== r.title ||
    form.period_start !== r.period_start ||
    form.period_end !== r.period_end ||
    form.commentary !== r.commentary ||
    form.next_steps !== r.next_steps;
  const periodChanged = form.period_start !== r.period_start || form.period_end !== r.period_end;
  const validPeriod = !!form.period_start && !!form.period_end && form.period_start <= form.period_end;
  const link = publicUrl;
  const ro = !ws.canWrite;

  // Avertit avant de quitter avec des modifications non enregistrées
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = async () => {
    if (!validPeriod || !form.title.trim()) return;
    setSaving(true);
    await mutate(async (sb) => must(await sb.from("reports").update({ ...form, title: form.title.trim() }).eq("id", r.id)), { success: "Rapport enregistré" });
    setSaving(false);
  };

  const setShared = (shared: boolean) =>
    mutate(async (sb) => must(await sb.from("reports").update({ shared }).eq("id", r.id)), {
      success: shared ? "Partage activé : le lien est public" : "Partage désactivé : le lien ne fonctionne plus",
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Copie impossible : sélectionne le lien manuellement", { error: true });
    }
  };

  const share = async () => {
    if (!r.shared) await setShared(true);
    await copy();
    toast("Lien copié dans le presse-papiers");
  };

  const preview: ReportData = { ...data, report: { ...r, title: form.title, commentary: form.commentary, next_steps: form.next_steps } };
  const company = ws.company(r.company_id);

  return (
    <div className="page wide">
      <Crumbs
        items={[
          { label: "Reporting", href: `${ws.base}/reporting?tab=reports` },
          ...(company ? [{ label: company.name, href: `${ws.base}/reporting/${company.id}` }] : []),
          { label: form.title || "Rapport" },
        ]}
      />
      <div className="rp-editor">
        <div className="card form">
          <label className="field">
            <span className="label">Titre</span>
            <input className="input" value={form.title} disabled={ro} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label className="field">
              <span className="label">Du</span>
              <input className="input" type="date" value={form.period_start} max={form.period_end} disabled={ro} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Au</span>
              <input className="input" type="date" value={form.period_end} min={form.period_start} disabled={ro} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
            </label>
          </div>
          {periodChanged && validPeriod && <p className="hint faint" style={{ fontSize: 12, marginTop: -6 }}>Enregistre pour recalculer l&apos;aperçu sur {rangeLabel(form.period_start, form.period_end)}.</p>}
          {!validPeriod && <p className="err" style={{ fontSize: 12, color: "var(--red)", marginTop: -6 }}>La date de début doit précéder la date de fin.</p>}
          <label className="field">
            <span className="label">Ce qu&apos;il faut retenir</span>
            <textarea
              className="textarea"
              rows={6}
              value={form.commentary}
              disabled={ro}
              placeholder="Les faits marquants de la période, expliqués simplement au client (le rapport le vouvoie)."
              onChange={(e) => setForm({ ...form, commentary: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">Prochaines étapes</span>
            <textarea
              className="textarea"
              rows={5}
              value={form.next_steps}
              disabled={ro}
              placeholder="Tests prévus, budgets, créas à produire…"
              onChange={(e) => setForm({ ...form, next_steps: e.target.value })}
            />
          </label>
          {!ro && (
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving || !validPeriod || !form.title.trim()}>
              {saving ? "Enregistrement…" : dirty ? "Enregistrer" : "Enregistré"}
            </button>
          )}

          <div className="divider" style={{ margin: "4px -16px" }} />
          <div className="field">
            <span className="label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              Partage au client
              <span className={r.shared ? "rp-state good" : "rp-state"} style={{ fontWeight: 500 }}>
                {r.shared ? "Lien actif" : "Non partagé"}
              </span>
            </span>
            {r.shared ? (
              <>
                <div className="rp-share-link">
                  <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Lien public du rapport" />
                  <button className="btn btn-icon" onClick={copy} title="Copier le lien" aria-label="Copier le lien">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <a className="btn btn-icon" href={link} target="_blank" rel="noreferrer" title="Ouvrir" aria-label="Ouvrir le rapport public">
                    <ExternalLink size={14} />
                  </a>
                </div>
                <span className="hint">Toute personne disposant du lien voit ce rapport, sans connexion.</span>
                {!ro && (
                  <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setShared(false)}>
                    <Link2Off size={13} /> Désactiver le partage
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="hint">Le client consulte le rapport en ligne et peut le télécharger en PDF.</span>
                {!ro && (
                  <button className="btn" style={{ alignSelf: "flex-start" }} onClick={share} disabled={dirty}>
                    <Link2 size={14} /> Partager et copier le lien
                  </button>
                )}
                {dirty && !ro && <span className="hint">Enregistre d&apos;abord tes modifications.</span>}
              </>
            )}
          </div>
          {!ro && (
            <>
              <div className="divider" style={{ margin: "4px -16px" }} />
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--red)" }} onClick={() => setConfirm(true)}>
                <Trash2 size={13} /> Supprimer le rapport
              </button>
            </>
          )}
        </div>

        <section className="preview" aria-label="Aperçu du rapport client">
          <div className="bar">
            <span>Aperçu, identique à la version client</span>
            {r.shared && (
              <a href={link} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                Ouvrir <ExternalLink size={12} />
              </a>
            )}
          </div>
          <ReportView data={preview} embedded />
        </section>
      </div>

      {confirm && (
        <ConfirmModal
          title="Supprimer ce rapport ?"
          text="Le lien partagé cessera de fonctionner. Les données publicitaires ne sont pas supprimées."
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const ok = await mutate(async (sb) => must(await sb.from("reports").delete().eq("id", r.id)), { success: "Rapport supprimé", refresh: false });
            if (ok !== undefined) router.push(company ? `${ws.base}/reporting/${company.id}` : `${ws.base}/reporting?tab=reports`);
          }}
        />
      )}
    </div>
  );
}
