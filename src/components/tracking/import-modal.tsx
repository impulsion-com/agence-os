"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import type { Stage } from "@/lib/tracking/funnel";
import type { SiteRow } from "@/lib/tracking/load";
import { CONVERSIONS_CSV_TEMPLATE, parseConversionsCsv } from "@/lib/tracking/sources";

const BATCH = 100;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Import d'un fichier de conversions hors ligne (ventes signées, rendez-vous honorés…). */
export function ImportModal({ site, stages, onClose }: { site: SiteRow; stages: Stage[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [report, setReport] = useState<{ created: number; duplicates: number; errors: string[] } | null>(null);

  const parsed = useMemo(() => (file ? parseConversionsCsv(file.text, type) : null), [file, type]);
  const rows = useMemo(() => parsed?.rows ?? [], [parsed]);
  const needType = !!parsed && !parsed.columns.type;
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return [...m.entries()];
  }, [rows]);
  const known = new Set(stages.flatMap((s) => [s.key, ...s.aliases]));
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);

  const run = async () => {
    if (!rows.length) return;
    setBusy(true);
    const out = { created: 0, duplicates: 0, errors: [] as string[] };
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const res = await fetch("/api/tracking/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site_id: site.id, rows: rows.slice(i, i + BATCH) }),
        });
        const body = (await res.json()) as { created?: number; duplicates?: number; errors?: { row: number; error: string }[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "Import impossible");
        out.created += body.created ?? 0;
        out.duplicates += body.duplicates ?? 0;
        for (const e of body.errors ?? []) out.errors.push(`${rows[i + e.row].email ?? rows[i + e.row].phone} : ${e.error}`);
        setDone(Math.min(rows.length, i + BATCH));
      }
      setReport(out);
      router.refresh();
    } catch (e) {
      // Un import interrompu se relance sans risque : les lignes déjà écrites reviennent en doublon ignoré
      toast(`${e instanceof Error ? e.message : String(e)}. ${plural(out.created, "ligne importée", "lignes importées")} avant l'arrêt : tu peux relancer le même fichier.`, { error: true });
    } finally {
      setBusy(false);
    }
  };

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(CONVERSIONS_CSV_TEMPLATE)}`;

  if (report)
    return (
      <Modal title="Import terminé" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Fermer</button>}>
        <p>
          {plural(report.created, "conversion ajoutée", "conversions ajoutées")}
          {report.duplicates > 0 && `, ${plural(report.duplicates, "déjà présente ignorée", "déjà présentes ignorées")}`}
          {report.errors.length > 0 && `, ${plural(report.errors.length, "ligne refusée", "lignes refusées")}`}.
        </p>
        {report.errors.length > 0 && (
          <ul className="trk-import-errors">
            {report.errors.slice(0, 8).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </Modal>
    );

  return (
    <Modal
      title="Importer des conversions (CSV)"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <a className="btn btn-ghost" href={template} download="modele-conversions.csv" style={{ marginRight: "auto" }}>
            <Download size={14} /> Modèle CSV
          </a>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || !rows.length}>
            {busy ? `Import… ${done} / ${rows.length}` : rows.length ? `Importer ${plural(rows.length, "ligne", "lignes")}` : "Importer"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13 }}>
        Pour les ventes et les étapes qui se passent hors du site : export de ton CRM, de ton outil de facturation, ou tableur tenu à la main. Colonnes reconnues :
        email, téléphone, type, valeur, devise, date, identifiant (séparateur ; ou ,). Il faut au moins l&apos;email ou le téléphone. Réimporter le même fichier ne
        double rien.
      </p>
      <label className="field">
        <span className="label">Fichier</span>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="input"
          style={{ paddingTop: 5 }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setFile(f ? { name: f.name, text: await f.text() } : null);
          }}
        />
      </label>
      {needType && (
        <label className="field">
          <span className="label">Étape de ces lignes</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Choisir une étape…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.key}>{s.label}</option>
            ))}
          </select>
          <span className="hint">Ton fichier n&apos;a pas de colonne « type » : toutes ses lignes iront dans cette étape.</span>
        </label>
      )}
      {parsed && parsed.errors.length > 0 && (
        <ul className="trk-import-errors" role="alert">
          {parsed.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="rp-note" role="status">
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <b>
              {plural(rows.length, "ligne prête", "lignes prêtes")}
              {total > 0 && `, ${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(total)} de valeur au total`}
            </b>
            {byType.map(([t, n]) => (
              <span key={t}>
                <code>{t}</code> : {n}
                {!known.has(t) && " (aucune étape ne porte ce nom : ces lignes iront dans « Évènements hors entonnoir »)"}
              </span>
            ))}
          </span>
        </div>
      )}
    </Modal>
  );
}
