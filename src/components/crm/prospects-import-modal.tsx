"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { parseCsv } from "@/lib/csv-grid";
import { useMutate, useWorkspace } from "@/lib/workspace/context";
import { bestEmail, importProspects, parseProspectsGrid, type ProspectsCsv } from "@/lib/prospects";

// Nom du fichier → recherche probable (« agence-marketing-lyon.csv » → « agence marketing lyon »)
const searchFromFile = (name: string) => (/^results?\.csv$/i.test(name) ? "" : name.replace(/\.csv$/i, "").replace(/[-_]+/g, " ").trim());

export function ProspectsImportModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [search, setSearch] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const parsed: ProspectsCsv | null = grid ? parseProspectsGrid(grid, search.trim()) : null;
  const rows = parsed?.rows ?? [];
  const withEmail = rows.filter((r) => r.emails.length).length;

  const load = async (file: File) => {
    setError("");
    setFileName(file.name);
    const g = parseCsv(await file.text());
    if (g.length < 2) {
      setGrid(null);
      setError("Le fichier ne contient pas de lignes à importer. La première ligne doit contenir les en-têtes de colonnes.");
      return;
    }
    if (!parseProspectsGrid(g.slice(0, 1)).recognized.includes("name")) {
      setGrid(null);
      setError("Colonne du nom introuvable. Le fichier doit avoir une colonne « title » (export gosom), « name » ou « nom ».");
      return;
    }
    setGrid(g);
    setSearch((s) => s || searchFromFile(file.name));
  };

  const run = async () => {
    if (!rows.length || busy) return;
    setBusy(true);
    const res = await mutate((sb) => importProspects(sb, { workspaceId: ws.workspace.id, userId: ws.me.id, rows }));
    setBusy(false);
    if (!res) return;
    toast(`${res.imported} fiche${res.imported > 1 ? "s" : ""} importée${res.imported > 1 ? "s" : ""}${res.duplicates ? `, ${res.duplicates} déjà présente${res.duplicates > 1 ? "s" : ""}` : ""}`);
    onClose();
  };

  return (
    <Modal
      title="Importer des fiches"
      size="lg"
      onClose={onClose}
      footer={
        <>
          {parsed && (
            <span className="faint" style={{ marginRight: "auto", fontSize: "var(--fs-sm)" }}>
              {rows.length} fiche{rows.length > 1 ? "s" : ""}, dont {withEmail} avec email
              {parsed.closed ? `, ${parsed.closed} fermée${parsed.closed > 1 ? "s" : ""} écartée${parsed.closed > 1 ? "s" : ""}` : ""}
            </span>
          )}
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!rows.length || busy} onClick={run}>
            {busy ? "Import en cours…" : `Importer ${rows.length || ""} fiche${rows.length > 1 ? "s" : ""}`}
          </button>
        </>
      }
    >
      <div
        className={`crm-drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) load(f);
        }}
      >
        <FileUp size={22} className="faint" />
        <span>{fileName ? <b style={{ color: "var(--text)" }}>{fileName}</b> : "Glisse ton fichier CSV ici"}</span>
        <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}>
          {fileName ? "Choisir un autre fichier" : "Parcourir"}
        </button>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        <span className="fainter" style={{ fontSize: "var(--fs-xs)" }}>
          Export CSV de google-maps-scraper (gosom), ou tout fichier avec au moins une colonne nom. Les fiches déjà importées sont ignorées.
        </span>
      </div>

      {error && <p className="err" style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }}>{error}</p>}

      {parsed && (
        <>
          <div className="field">
            <label htmlFor="pr-search">Recherche d&apos;origine (facultatif)</label>
            <input id="pr-search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="agence marketing Lyon" maxLength={200} />
          </div>
          <div className="crm-preview">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th className="crm-hide-sm">Ville</th>
                  <th className="crm-hide-sm">Note</th>
                  <th>Email</th>
                  <th className="crm-hide-sm">Téléphone</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td>
                      <span className="trunc" style={{ display: "block", maxWidth: 240 }}>{r.name}</span>
                      {r.category && <span className="fainter" style={{ fontSize: "var(--fs-xs)" }}>{r.category}</span>}
                    </td>
                    <td className="crm-hide-sm">{r.city || <span className="fainter">-</span>}</td>
                    <td className="crm-hide-sm num">{r.rating !== null ? `${String(r.rating).replace(".", ",")} (${r.reviews ?? 0})` : <span className="fainter">-</span>}</td>
                    <td className="trunc" style={{ maxWidth: 200 }}>{bestEmail(r.emails) || <span className="fainter">-</span>}</td>
                    <td className="crm-hide-sm">{r.phone || <span className="fainter">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && <p className="faint" style={{ fontSize: "var(--fs-xs)" }}>Aperçu limité aux 200 premières lignes, toutes seront importées.</p>}
        </>
      )}
    </Modal>
  );
}
