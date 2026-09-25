"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileUp } from "lucide-react";

import "@/styles/reporting.css";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import { CSV_TEMPLATE, parseCsv, type CsvResult } from "@/lib/ads/csv";
import { KPI_HELP, MONTHLY, PLATFORM_META, TARGET_METRICS, fmtKpi } from "@/lib/ads/metrics";
import type { AdPlatform, TrackedAccount } from "@/lib/ads/types";
import type { KpiMetric } from "@/lib/types";

// ---------------------------------------------------------------------
// Objectifs du client (kpi_targets)
// ---------------------------------------------------------------------
const TARGET_FIELD: Record<KpiMetric, { label: string; unit: string; step: string }> = {
  spend: { label: "Budget mensuel", unit: "€", step: "1" },
  conversions: { label: "Conversions par mois", unit: "", step: "1" },
  cpa: { label: "CPA cible (maximum)", unit: "€", step: "0.01" },
  roas: { label: "ROAS cible (minimum)", unit: "x", step: "0.1" },
  ctr: { label: "CTR cible (minimum)", unit: "%", step: "0.01" },
  cpc: { label: "CPC cible (maximum)", unit: "€", step: "0.01" },
};

export function TargetsModal({
  companyId,
  targets,
  onClose,
}: {
  companyId: string;
  targets: { id: string; metric: string; target: number }[];
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const mutate = useMutate();
  const currency = workspace.currency || "EUR";
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(TARGET_METRICS.map((m) => [m, String(targets.find((t) => t.metric === m)?.target ?? "")])),
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const upserts: { workspace_id: string; company_id: string; metric: string; target: number }[] = [];
    const removed: string[] = [];
    for (const m of TARGET_METRICS) {
      const raw = vals[m]?.replace(",", ".").trim();
      const n = raw ? Number(raw) : NaN;
      if (raw && Number.isFinite(n) && n > 0) upserts.push({ workspace_id: workspace.id, company_id: companyId, metric: m, target: n });
      else if (targets.some((t) => t.metric === m)) removed.push(m);
    }
    const ok = await mutate(
      async (sb) => {
        if (upserts.length) must(await sb.from("kpi_targets").upsert(upserts, { onConflict: "company_id,metric" }));
        if (removed.length) must(await sb.from("kpi_targets").delete().eq("company_id", companyId).in("metric", removed));
        return true;
      },
      { success: "Objectifs enregistrés" },
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title="Objectifs du client"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13 }}>
        Laisse un champ vide pour ne pas suivre cet indicateur. Le budget et les conversions sont mensuels : ils sont ramenés à la durée de la période affichée.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        {TARGET_METRICS.map((m) => {
          const f = TARGET_FIELD[m];
          const unit = f.unit === "€" ? currency : f.unit;
          return (
            <label className="field" key={m}>
              <span className="label">
                {f.label}
                {unit ? ` (${unit})` : ""}
              </span>
              <input
                className="input num"
                type="number"
                inputMode="decimal"
                min="0"
                step={f.step}
                value={vals[m]}
                placeholder="Aucun"
                onChange={(e) => setVals((v) => ({ ...v, [m]: e.target.value }))}
              />
              <span className="hint">
                {KPI_HELP[m]}
                {MONTHLY[m] ? ", par mois" : ""}
              </span>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Import CSV
// ---------------------------------------------------------------------
const CSV_PLATFORMS: AdPlatform[] = ["tiktok", "linkedin", "snapchat", "pinterest", "chatgpt", "meta", "google", "other"];

export function CsvImportModal({ companyId, accounts, onClose }: { companyId: string | null; accounts: TrackedAccount[]; onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [company, setCompany] = useState<string>(companyId ?? "");
  const csvAccounts = accounts.filter((a) => !a.connection_id && !a.external_id.startsWith("demo-") && (!company || a.company_id === company));
  const [target, setTarget] = useState<string>(csvAccounts[0]?.id ?? "new");
  const [platform, setPlatform] = useState<AdPlatform>("tiktok");
  const [name, setName] = useState("");
  const [file, setFile] = useState<{ name: string; result: CsvResult } | null>(null);
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => {
    if (!file?.result.rows.length) return null;
    const r = file.result.rows;
    const dates = r.map((x) => x.date).sort();
    return {
      n: r.length,
      from: dates[0],
      to: dates.at(-1)!,
      spend: r.reduce((s, x) => s + x.spend, 0),
      campaigns: new Set(r.map((x) => x.campaign_id)).size,
    };
  }, [file]);

  const read = async (f: File) => {
    const text = await f.text();
    setFile({ name: f.name, result: parseCsv(text) });
  };

  const run = async () => {
    if (!file || !summary || !company) return;
    setBusy(true);
    const sb = supabaseBrowser();
    try {
      let accountId = target;
      if (target === "new") {
        const c = ws.company(company);
        const acc = must(
          await sb
            .from("ad_accounts")
            .insert({
              workspace_id: ws.workspace.id,
              company_id: company,
              platform,
              external_id: `csv-${platform}-${crypto.randomUUID().slice(0, 8)}`,
              name: name.trim() || `${c?.name ?? "Client"} · ${PLATFORM_META[platform].short}`,
              currency: ws.workspace.currency || "EUR",
            })
            .select("id")
            .single(),
        );
        accountId = acc!.id;
      }
      const rows = file.result.rows.map((r) => ({ ...r, ad_account_id: accountId, workspace_id: ws.workspace.id }));
      // Fusionne les doublons (même jour, même campagne)
      const merged = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const k = `${r.date}|${r.campaign_id}`;
        const m = merged.get(k);
        if (!m) merged.set(k, { ...r });
        else {
          m.spend += r.spend;
          m.impressions += r.impressions;
          m.clicks += r.clicks;
          m.conversions += r.conversions;
          m.conversion_value += r.conversion_value;
        }
      }
      const list = [...merged.values()];
      for (let i = 0; i < list.length; i += 500)
        must(await sb.from("ad_metrics_daily").upsert(list.slice(i, i + 500), { onConflict: "ad_account_id,date,campaign_id" }));
      must(await sb.from("ad_accounts").update({ last_synced_at: new Date().toISOString(), sync_error: null }).eq("id", accountId));
      toast(`${list.length} ligne${list.length > 1 ? "s" : ""} importée${list.length > 1 ? "s" : ""}`);
      onClose();
      if (companyId) router.refresh();
      else router.push(`${ws.base}/reporting/${company}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(false);
    }
  };

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`;

  return (
    <Modal
      title="Importer des données (CSV)"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <a className="btn btn-ghost" href={template} download="modele-reporting.csv" style={{ marginRight: "auto" }}>
            <Download size={14} /> Modèle CSV
          </a>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || !summary || !company}>
            {busy ? "Import…" : "Importer"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13 }}>
        Pour une régie non connectée (TikTok, LinkedIn…) : exporte un rapport quotidien par campagne et importe-le ici. Colonnes reconnues : date, campagne,
        dépense, impressions, clics, conversions, valeur (séparateur ; ou ,). Une ligne existante (même jour, même campagne) est remplacée.
      </p>
      {!companyId && (
        <label className="field">
          <span className="label">Client</span>
          <select className="select" value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">Choisir un client…</option>
            {ws.companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <label className="field">
          <span className="label">Compte</span>
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">Nouveau compte importé</option>
            {csvAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        {target === "new" && (
          <>
            <label className="field">
              <span className="label">Régie</span>
              <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value as AdPlatform)}>
                {CSV_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_META[p].name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Nom du compte</span>
              <input className="input" value={name} placeholder={`${ws.company(company)?.name ?? "Client"} · ${PLATFORM_META[platform].short}`} onChange={(e) => setName(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <label
        className="rp-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void read(f);
        }}
      >
        <FileUp size={18} />
        <span>{file ? file.name : "Glisse un fichier .csv ici ou clique pour le choisir"}</span>
        <input type="file" accept=".csv,text/csv,text/plain" className="sr" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      {file && (
        <div className={`rp-note${file.result.errors.length ? (summary ? " warn" : " err") : ""}`} role="status">
          <div>
            {summary ? (
              <p>
                <b>{summary.n}</b> lignes, {summary.campaigns} campagne{summary.campaigns > 1 ? "s" : ""}, du {fmtDate(summary.from, true)} au {fmtDate(summary.to, true)}, dépense
                totale <b>{fmtKpi("spend", summary.spend, ws.workspace.currency || "EUR")}</b>.
              </p>
            ) : null}
            {file.result.errors.length > 0 && (
              <ul className="rp-steps">
                {file.result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {summary && (
              <p className="faint" style={{ marginTop: 6, fontSize: 12 }}>
                Colonnes utilisées :{" "}
                {Object.entries(file.result.columns)
                  .filter(([, v]) => v)
                  .map(([, v]) => `« ${v} »`)
                  .join(", ")}
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
