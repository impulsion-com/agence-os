"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Contact } from "@/lib/types";
import { colorForName } from "./lib";

type Field = "first_name" | "last_name" | "email" | "phone" | "job_title" | "company";
const FIELDS: { id: Field; name: string; aliases: string[] }[] = [
  { id: "first_name", name: "Prénom", aliases: ["prenom", "first name", "firstname", "first_name", "given name"] },
  { id: "last_name", name: "Nom", aliases: ["nom", "last name", "lastname", "last_name", "family name", "nom de famille"] },
  { id: "email", name: "Email", aliases: ["email", "e-mail", "mail", "courriel", "adresse email"] },
  { id: "phone", name: "Téléphone", aliases: ["telephone", "tel", "phone", "mobile", "portable", "numero"] },
  { id: "job_title", name: "Poste", aliases: ["poste", "fonction", "job title", "job_title", "title", "titre"] },
  { id: "company", name: "Entreprise", aliases: ["entreprise", "societe", "company", "organisation", "organization", "client"] },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Analyse CSV simple : guillemets, séparateur « , » ou « ; » détecté sur la première ligne.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : first.includes("\t") && !first.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

interface Parsed {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  company: string;
  status: "new" | "dup" | "empty";
  newCompany: boolean;
}

export function CsvImportModal({ existing, onClose }: { existing: Pick<Contact, "email">[]; onClose: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Parsed[] | null>(null);
  const [missing, setMissing] = useState<Field[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async (file: File) => {
    setError("");
    setFileName(file.name);
    const grid = parseCsv(await file.text());
    if (grid.length < 2) {
      setRows(null);
      setError("Le fichier ne contient pas de lignes à importer. La première ligne doit contenir les en-têtes de colonnes.");
      return;
    }
    const head = grid[0].map(norm);
    const idx = Object.fromEntries(FIELDS.map((f) => [f.id, head.findIndex((h) => f.aliases.includes(h))])) as Record<Field, number>;
    setMissing(FIELDS.filter((f) => idx[f.id] < 0).map((f) => f.id));
    if (idx.first_name < 0 && idx.last_name < 0 && idx.email < 0) {
      setRows(null);
      setError("Colonnes introuvables. Utilise les en-têtes : prénom, nom, email, téléphone, poste, entreprise.");
      return;
    }
    const known = new Set(existing.map((c) => c.email.toLowerCase()).filter(Boolean));
    const coNames = new Set(ws.companies.map((c) => norm(c.name)));
    const seen = new Set<string>();
    setRows(
      grid.slice(1).map((r) => {
        const get = (f: Field) => (idx[f] >= 0 ? (r[idx[f]] ?? "").trim() : "");
        const email = get("email").toLowerCase();
        const p = { first_name: get("first_name"), last_name: get("last_name"), email, phone: get("phone"), job_title: get("job_title"), company: get("company") };
        const status: Parsed["status"] = !p.first_name && !p.last_name && !email ? "empty" : email && (known.has(email) || seen.has(email)) ? "dup" : "new";
        if (email) seen.add(email);
        return { ...p, status, newCompany: !!p.company && !coNames.has(norm(p.company)) };
      }),
    );
  };

  const toImport = rows?.filter((r) => r.status === "new") ?? [];
  const newCos = Array.from(new Map(toImport.filter((r) => r.newCompany).map((r) => [norm(r.company), r.company])).values());

  const run = async () => {
    if (!toImport.length || busy) return;
    setBusy(true);
    const ok = await mutate(
      async (sb) => {
        const map = new Map(ws.companies.map((c) => [norm(c.name), c.id]));
        if (newCos.length) {
          const created = must(
            await sb
              .from("companies")
              .insert(newCos.map((name) => ({ workspace_id: ws.workspace.id, name, status: "lead", owner_id: ws.me.id, color: colorForName(name) })))
              .select("id, name"),
          );
          for (const c of created ?? []) map.set(norm(c.name), c.id);
        }
        must(
          await sb.from("contacts").insert(
            toImport.map((r) => ({
              workspace_id: ws.workspace.id,
              first_name: r.first_name,
              last_name: r.last_name,
              email: r.email,
              phone: r.phone,
              job_title: r.job_title,
              company_id: r.company ? (map.get(norm(r.company)) ?? null) : null,
            })),
          ),
        );
        return true;
      },
      { success: `${toImport.length} contact${toImport.length > 1 ? "s" : ""} importé${toImport.length > 1 ? "s" : ""}` },
    );
    setBusy(false);
    if (ok) onClose();
  };

  const dup = rows?.filter((r) => r.status === "dup").length ?? 0;

  return (
    <Modal
      title="Importer des contacts"
      size="lg"
      onClose={onClose}
      footer={
        <>
          {rows && (
            <span className="faint" style={{ marginRight: "auto", fontSize: "var(--fs-sm)" }}>
              {toImport.length} à importer{dup ? `, ${dup} déjà présent${dup > 1 ? "s" : ""}` : ""}
              {newCos.length ? `, ${newCos.length} entreprise${newCos.length > 1 ? "s" : ""} créée${newCos.length > 1 ? "s" : ""}` : ""}
            </span>
          )}
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!toImport.length || busy} onClick={run}>
            {busy ? "Import en cours…" : `Importer ${toImport.length || ""} contact${toImport.length > 1 ? "s" : ""}`}
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
        <span>
          {fileName ? <b style={{ color: "var(--text)" }}>{fileName}</b> : "Glisse ton fichier CSV ici"}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}>
          {fileName ? "Choisir un autre fichier" : "Parcourir"}
        </button>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        <span className="fainter" style={{ fontSize: "var(--fs-xs)" }}>
          Colonnes reconnues : prénom, nom, email, téléphone, poste, entreprise. Séparateur virgule ou point-virgule.
        </span>
      </div>

      {error && <p className="err" style={{ color: "var(--red)", fontSize: "var(--fs-sm)" }}>{error}</p>}

      {rows && (
        <>
          {missing.length > 0 && (
            <p className="crm-note">
              Colonnes absentes du fichier : {missing.map((m) => FIELDS.find((f) => f.id === m)!.name.toLowerCase()).join(", ")}. Elles resteront vides.
            </p>
          )}
          <div className="crm-preview">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Email</th>
                  <th className="crm-hide-sm">Téléphone</th>
                  <th className="crm-hide-sm">Poste</th>
                  <th>Entreprise</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} style={r.status !== "new" ? { opacity: 0.5 } : undefined}>
                    <td>
                      {[r.first_name, r.last_name].filter(Boolean).join(" ") || <span className="fainter">-</span>}
                      {r.status === "dup" && <span className="crm-tag skip">Déjà présent</span>}
                      {r.status === "empty" && <span className="crm-tag skip">Ignoré</span>}
                    </td>
                    <td className="trunc" style={{ maxWidth: 200 }}>{r.email || <span className="fainter">-</span>}</td>
                    <td className="crm-hide-sm">{r.phone || <span className="fainter">-</span>}</td>
                    <td className="crm-hide-sm">{r.job_title || <span className="fainter">-</span>}</td>
                    <td>
                      {r.company || <span className="fainter">-</span>}
                      {r.newCompany && r.status === "new" && <span className="crm-tag">Nouvelle</span>}
                    </td>
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
