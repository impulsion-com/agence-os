"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Download, FileUp, Wand2 } from "lucide-react";

import "@/styles/reporting.css";
import "@/styles/links.css";
import { PageHeader } from "@/components/ui/misc";
import { CompanyPicker } from "@/components/pickers";
import { Crumbs, CompanyMark } from "@/components/reporting/common";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import {
  EMPTY_UTM, UTM_LABEL, applyPreset, buildUrl, conventionIssues, download, findMacros, normalizeUtm, parseCsv, parseDestination,
  randomCode, storeUtm, toCsv, type Preset, type Utm, type UtmKey,
} from "@/lib/links/utm";
import { TagInput } from "./link-editor";
import { CopyButton, useShort } from "./shared";

// Colonnes reconnues (en-têtes français ou anglais)
const COLS: Record<string, string[]> = {
  destination: ["destination", "url", "lien", "page", "adresse"],
  utm_campaign: ["campagne", "campaign", "utm_campaign"],
  utm_content: ["contenu", "content", "utm_content", "visuel", "annonce"],
  utm_term: ["terme", "term", "utm_term", "mot-cle", "mot_cle", "audience"],
  utm_source: ["source", "utm_source"],
  utm_medium: ["support", "medium", "utm_medium"],
  name: ["nom", "name", "titre"],
  code: ["code", "slug", "lien_court"],
};
const DEFAULT_ORDER = ["destination", "utm_campaign", "utm_content", "utm_term", "name"];
const clean = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

interface Row {
  line: number;
  destination: string;
  name: string;
  code: string;
  over: Partial<Record<UtmKey, string>>;
}

function parseInput(text: string): { rows: Row[]; header: string[] | null } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], header: null };
  const first = table[0].map(clean);
  const isHeader = first.some((c) => COLS.destination.includes(c));
  let map: string[];
  if (isHeader) map = first.map((c) => Object.entries(COLS).find(([, al]) => al.includes(c))?.[0] ?? "");
  else map = DEFAULT_ORDER;
  const body = isHeader ? table.slice(1) : table;
  return {
    header: isHeader ? map : null,
    rows: body.map((cells, i) => {
      const get = (k: string) => {
        const idx = map.indexOf(k);
        return idx >= 0 ? (cells[idx] ?? "").trim() : "";
      };
      const over: Partial<Record<UtmKey, string>> = {};
      for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as UtmKey[]) if (get(k)) over[k] = get(k);
      return { line: i + 1, destination: get("destination") || cells[0] || "", name: get("name"), code: get("code"), over };
    }),
  };
}

interface Created {
  id: string;
  name: string;
  final_url: string;
  code: string | null;
}

export function BulkEditor({ presets }: { presets: Preset[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const short = useShort();
  const [text, setText] = useState("");
  const [base, setBase] = useState<Utm>({ ...EMPTY_UTM, extra: [] });
  const [presetId, setPresetId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [shortOn, setShortOn] = useState(true);
  const [normalize, setNormalize] = useState(true);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created[] | null>(null);
  const company = ws.company(companyId);

  const { rows, header } = useMemo(() => parseInput(text), [text]);
  const built = rows.map((r) => {
    const p = parseDestination(r.destination);
    const u: Utm = { ...base, extra: base.extra };
    for (const [k, v] of Object.entries(p.found) as [UtmKey, string][]) if (!r.over[k] && !u[k]) u[k] = v;
    for (const [k, v] of Object.entries(r.over) as [UtmKey, string][]) u[k] = v;
    if (normalize) for (const k of Object.keys(UTM_LABEL) as UtmKey[]) u[k] = normalizeUtm(u[k]);
    const finalUrl = p.ok ? buildUrl(p.clean, u) : "";
    const warn = (Object.keys(UTM_LABEL) as UtmKey[]).some((k) => conventionIssues(u[k]).length);
    return { ...r, ok: p.ok, error: p.ok ? null : p.error || "URL invalide", clean: p.clean, utm: u, finalUrl, warn };
  });
  const valid = built.filter((b) => b.ok);
  const macros = valid.some((b) => findMacros(b.finalUrl).length);

  const create = async () => {
    if (!valid.length) return;
    setBusy(true);
    const sb = supabaseBrowser();
    let attempt = 0;
    let out: Created[] | null = null;
    let lastErr = "";
    while (attempt < 3 && !out) {
      attempt++;
      const payload = valid.map((b) => ({
        workspace_id: ws.workspace.id,
        company_id: companyId,
        name: b.name || [company?.name, b.utm.utm_campaign, b.utm.utm_content].filter(Boolean).join(" · ") || b.clean.replace(/^https?:\/\//, ""),
        destination: b.clean,
        utm: storeUtm(b.utm) as never,
        final_url: b.finalUrl,
        tags,
        code: shortOn ? (b.code && attempt === 1 ? b.code : randomCode()) : null,
      }));
      const { data, error } = await sb.from("links").insert(payload).select("id, name, final_url, code");
      if (!error) out = (data ?? []) as Created[];
      else {
        lastErr = error.message;
        if (!(error.code === "23505" || /duplicate|unique/i.test(error.message))) break;
      }
    }
    setBusy(false);
    if (!out) {
      toast(/duplicate|unique/i.test(lastErr) ? "Un code personnalisé est déjà utilisé : retire-le ou change-le" : lastErr, { error: true });
      return;
    }
    setCreated(out);
    toast(`${out.length} lien${out.length > 1 ? "s" : ""} créé${out.length > 1 ? "s" : ""}`);
    router.refresh();
  };

  const exportCsv = (list: Created[]) => {
    const head = ["nom", "lien_court", "url_finale"];
    download(`liens-en-masse-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([head, ...list.map((c) => [c.name, c.code ? short.url(c.code) : "", c.final_url])]), "text/csv;charset=utf-8");
  };

  const loadFile = async (f: File) => setText(await f.text());

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <Crumbs items={[{ label: "Liens trackés", href: `${ws.base}/links` }, { label: "Création en masse" }]} />
      <PageHeader title="Création en masse" sub="Colle une liste d'URL ou une grille CSV : un lien par ligne, avec les mêmes réglages communs.">
        <div className="seg" role="tablist" aria-label="Mode de création">
          <button role="tab" aria-selected={false} onClick={() => router.push(`${ws.base}/links/new`)}>Un lien</button>
          <button className="on" role="tab" aria-selected>En masse</button>
        </div>
      </PageHeader>

      {created ? (
        <div className="lnk-sec lnk-bulk">
          <h2>
            <Check size={16} style={{ color: "var(--green)" }} /> {created.length} lien{created.length > 1 ? "s" : ""} créé{created.length > 1 ? "s" : ""}
            <span className="aside lnk-row">
              <CopyButton small text={created.map((c) => (c.code ? short.url(c.code) : c.final_url)).join("\n")} label="Copier tout" />
              <button className="btn btn-sm" onClick={() => exportCsv(created)}>
                <Download size={12} /> Exporter en CSV
              </button>
            </span>
          </h2>
          <div className="rp-scroll">
            <table className="tbl" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Lien court</th>
                  <th>URL finale</th>
                </tr>
              </thead>
              <tbody>
                {created.map((c) => (
                  <tr key={c.id}>
                    <td className="trunc" style={{ maxWidth: 240 }}>
                      <Link href={`${ws.base}/links/${c.id}`}>{c.name}</Link>
                    </td>
                    <td className="mono">{c.code ? short.display(c.code) : <span className="faint">–</span>}</td>
                    <td className="url trunc">{c.final_url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lnk-row">
            <Link href={`${ws.base}/links`} className="btn btn-primary">Voir tous les liens</Link>
            <button
              className="btn"
              onClick={() => {
                setCreated(null);
                setText("");
              }}
            >
              Créer une autre série
            </button>
          </div>
        </div>
      ) : (
        <div className="lnk-form lnk-bulk">
          <section className="lnk-sec">
            <h2>
              <span className="n">1</span> Liste
              <span className="aside">
                <label className="btn btn-sm">
                  <FileUp size={12} /> Importer un CSV
                  <input type="file" accept=".csv,text/csv,text/plain" className="sr" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                </label>
              </span>
            </h2>
            <p className="lead">
              Une URL par ligne, ou un CSV avec en-têtes parmi : <span className="mono">destination, campagne, contenu, terme, source, support, nom, code</span>. Sans en-tête, l&apos;ordre lu est destination, campagne, contenu, terme, nom.
            </p>
            <textarea
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              aria-label="Liste des liens"
              placeholder={"destination,campagne,contenu\nhttps://kalia-cosmetics.com/serum,lancement_serum,story_1\nhttps://kalia-cosmetics.com/creme,lancement_serum,story_2"}
            />
            {header && <span className="hint">En-têtes reconnus : {header.filter(Boolean).join(", ") || "aucun"}</span>}
          </section>

          <section className="lnk-sec">
            <h2>
              <span className="n">2</span> Réglages communs
            </h2>
            {presets.length > 0 && (
              <div className="lnk-presets">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    className={`btn btn-sm${presetId === p.id ? " on" : ""}`}
                    aria-pressed={presetId === p.id}
                    onClick={() => {
                      setBase((u) => applyPreset(u, p));
                      setPresetId(p.id);
                    }}
                  >
                    {presetId === p.id && <Check size={12} />}
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            <div className="lnk-grid3">
              {(["utm_source", "utm_medium", "utm_campaign"] as UtmKey[]).map((k) => (
                <div className="lnk-field" key={k}>
                  <label htmlFor={`b-${k}`}>
                    {UTM_LABEL[k]} <code>{k}</code>
                  </label>
                  <input
                    id={`b-${k}`}
                    className="input"
                    style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
                    value={base[k]}
                    onChange={(e) => {
                      setBase((u) => ({ ...u, [k]: e.target.value }));
                      setPresetId(null);
                    }}
                    placeholder={k === "utm_campaign" ? "si absente de la ligne" : ""}
                  />
                </div>
              ))}
            </div>
            <div className="lnk-grid2">
              <div className="lnk-field">
                <span className="label">Client</span>
                <CompanyPicker
                  value={companyId}
                  onChange={setCompanyId}
                  trigger={(open) => (
                    <button type="button" className="input" onClick={open} style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left" }}>
                      {company && <CompanyMark name={company.name} color={company.color} size={18} />}
                      <span className={`trunc${company ? "" : " faint"}`}>{company?.name ?? "Aucun client"}</span>
                    </button>
                  )}
                />
              </div>
              <div className="lnk-field">
                <span className="label">Étiquettes</span>
                <TagInput value={tags} onChange={setTags} suggestions={[]} />
              </div>
            </div>
            <div className="lnk-row" style={{ gap: 18 }}>
              <label className="lnk-row" style={{ gap: 8, fontSize: 13 }}>
                <input type="checkbox" className="toggle" checked={shortOn} onChange={(e) => setShortOn(e.target.checked)} /> Créer un lien court pour chaque ligne
              </label>
              <label className="lnk-row" style={{ gap: 8, fontSize: 13 }}>
                <input type="checkbox" className="toggle" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
                <Wand2 size={13} className="faint" /> Normaliser les valeurs (minuscules, sans accents)
              </label>
            </div>
            {macros && shortOn && (
              <div className="lnk-notice warn">
                <AlertTriangle size={14} />
                <p>Ces liens contiennent des variables de plateforme : un lien court ne les remplace pas. Pour des publicités, désactive les liens courts.</p>
              </div>
            )}
          </section>

          <section className="lnk-sec">
            <h2>
              <span className="n">3</span> Aperçu
              <span className="aside faint" style={{ fontSize: 12.5 }}>
                {valid.length} valide{valid.length > 1 ? "s" : ""}
                {built.length - valid.length > 0 && `, ${built.length - valid.length} en erreur`}
              </span>
            </h2>
            {built.length === 0 ? (
              <p className="lead" style={{ marginTop: 0 }}>Colle une liste pour voir les liens générés.</p>
            ) : (
              <div className="rp-scroll">
                <table className="tbl" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Destination</th>
                      <th>Campagne</th>
                      <th>Contenu</th>
                      <th>URL finale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {built.slice(0, 200).map((b) => (
                      <tr key={b.line}>
                        <td className="faint num">{b.line}</td>
                        <td className="trunc" style={{ maxWidth: 220 }}>
                          {b.ok ? b.clean.replace(/^https?:\/\/(www\.)?/, "") : <span style={{ color: "var(--red)" }}>{b.error} : {b.destination || "vide"}</span>}
                        </td>
                        <td className="mono trunc" style={{ maxWidth: 160 }}>{b.utm.utm_campaign || <span className="faint">–</span>}</td>
                        <td className="mono trunc" style={{ maxWidth: 140 }}>{b.utm.utm_content || <span className="faint">–</span>}</td>
                        <td className="url trunc">
                          {b.warn && <AlertTriangle size={12} style={{ color: "var(--amber)", marginRight: 4, verticalAlign: -1 }} aria-label="Valeurs hors convention" />}
                          {b.finalUrl}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="lnk-row">
              <button className="btn btn-primary" onClick={create} disabled={!valid.length || busy || valid.length > 500}>
                {busy ? "Création…" : valid.length ? `Créer ${valid.length} lien${valid.length > 1 ? "s" : ""}` : "Créer les liens"}
              </button>
              <button className="btn" onClick={() => exportCsv(valid.map((b, i) => ({ id: String(i), name: b.name, final_url: b.finalUrl, code: null })))} disabled={!valid.length}>
                <Download size={14} /> Exporter sans créer
              </button>
              {valid.length > 500 && <span className="err" style={{ fontSize: 12 }}>500 liens maximum par série</span>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
