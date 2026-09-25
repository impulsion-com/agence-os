"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Braces, Check, Info, Plus, RefreshCw, Sparkles, Wand2, X } from "lucide-react";

import "@/styles/links.css";
import { PageHeader } from "@/components/ui/misc";
import { Popover } from "@/components/ui/overlay";
import { CompanyPicker } from "@/components/pickers";
import { Crumbs, CompanyMark } from "@/components/reporting/common";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import {
  EMPTY_UTM, MACROS, RULE_TOKENS, UTM_HINT, UTM_KEYS, UTM_LABEL, applyPreset, applyRule, buildUrl, codeError, conventionIssues,
  findMacros, macroPlatform, normalizeUtm, normalizeValue, paramString, parseDestination, randomCode, readUtm, ruleTokens, storeUtm,
  type Preset, type Utm, type UtmKey,
} from "@/lib/links/utm";
import type { LinkRow, SiteLite } from "@/lib/links/load";
import { CopyButton, UrlView, downloadQr, useQr, useShort } from "./shared";

export interface EditorProps {
  mode: "create" | "edit";
  link: LinkRow | null; // lien modifié, ou modèle pour « Dupliquer »
  presets: Preset[];
  rule: string;
  ruleHelp: string;
  sites: SiteLite[];
  tags: string[];
  seedCode: string;
}

const FIELD_ORDER: UtmKey[] = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"];

export function LinkEditor({ mode, link, presets, rule, ruleHelp, sites, tags: knownTags, seedCode }: EditorProps) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const short = useShort();
  const editing = mode === "edit" && !!link;

  const [dest, setDest] = useState(link?.destination ?? "");
  const [removed, setRemoved] = useState<{ k: string; v: string; reused: boolean }[]>([]);
  const [utm, setUtm] = useState<Utm>(() => (link ? readUtm(link.utm) : { ...EMPTY_UTM, extra: [] }));
  const [presetId, setPresetId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(link?.company_id ?? null);
  const [siteId, setSiteId] = useState<string | null>(link?.site_id ?? null);
  const [name, setName] = useState(link ? (editing ? link.name : `${link.name} (copie)`.trim()) : "");
  const [tags, setTags] = useState<string[]>(link?.tags ?? []);
  const existingCode = editing ? link.code : null;
  const [shortOn, setShortOn] = useState(link ? !!link.code : true);
  const [codeMode, setCodeMode] = useState<"random" | "custom">("random");
  const [code, setCode] = useState(existingCode ?? seedCode);
  const [taken, setTaken] = useState<{ code: string; free: boolean } | null>(null);
  const [expires, setExpires] = useState(link?.expires_at ? link.expires_at.slice(0, 10) : "");
  const [ruleVals, setRuleVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  const parsed = useMemo(() => parseDestination(dest), [dest]);
  const finalUrl = parsed.ok ? buildUrl(parsed.clean, utm) : "";
  const params = paramString(utm);
  const macros = findMacros(finalUrl);
  const platform = macroPlatform(macros);
  const company = ws.company(companyId);
  const companySites = sites.filter((s) => !companyId || s.company_id === companyId);
  const destChanged = editing && link.code && parsed.ok && parsed.clean !== link.destination;

  const issues = FIELD_ORDER.map((k) => [k, conventionIssues(utm[k])] as const).filter(([, i]) => i.length);
  const extraIssues = utm.extra.some((p) => conventionIssues(p.v).length > 0);

  // Code court : validation locale puis disponibilité (instance entière)
  const codeToCheck = shortOn && !existingCode ? code : "";
  const localCodeErr = codeToCheck ? codeError(codeToCheck) : null;
  useEffect(() => {
    if (!codeToCheck || localCodeErr) return;
    let live = true;
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser().rpc("link_code_available", { p_code: codeToCheck });
      if (live) setTaken({ code: codeToCheck, free: data !== false });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [codeToCheck, localCodeErr]);
  const codeErr = localCodeErr ?? (taken && taken.code === codeToCheck && !taken.free ? "Ce code est déjà utilisé" : null);

  const setField = (k: UtmKey, v: string) => {
    setUtm((u) => ({ ...u, [k]: v }));
    setPresetId(null);
  };

  // Au collage ou en quittant le champ : on retire les UTM de la destination
  const cleanDestination = (value = dest) => {
    const p = parseDestination(value);
    if (!p.ok) return;
    const found = Object.entries(p.found) as [UtmKey, string][];
    if (found.length) {
      const next = { ...utm };
      const rm = found.map(([k, v]) => {
        const reuse = !utm[k];
        if (reuse) next[k] = v;
        return { k, v, reused: reuse };
      });
      setUtm(next);
      setRemoved(rm);
    }
    if (p.clean !== value) setDest(p.clean);
  };

  const pickCompany = (id: string | null) => {
    setCompanyId(id);
    const own = sites.filter((s) => s.company_id === id);
    if (siteId && !own.some((s) => s.id === siteId)) setSiteId(null);
    if (own.length === 1) setSiteId(own[0].id);
  };

  const normalizeAll = () => {
    setUtm((u) => {
      const n = { ...u, extra: u.extra.map((p) => ({ k: p.k.trim(), v: normalizeValue(p.v.trim()).replace(/^_+|_+$/g, "") })) };
      for (const k of UTM_KEYS) n[k] = normalizeUtm(u[k]);
      return n;
    });
  };

  const insertMacro = (k: UtmKey, token: string) => setField(k, utm[k] ? `${utm[k]}${/[_-]$/.test(utm[k]) ? "" : "_"}${token}` : token);

  // Règle de nommage de l'espace
  const tokens = ruleTokens(rule);
  const autoTokens = new Set(RULE_TOKENS.map((t) => t.token));
  const manualTokens = tokens.filter((t) => !autoTokens.has(t));
  const ruleCtx: Record<string, string> = {
    ...Object.fromEntries(manualTokens.map((t) => [t, ruleVals[t] ?? ""]).filter(([, v]) => v)),
    ...(company ? { client: normalizeUtm(company.name) } : {}),
    ...(utm.utm_source ? { source: normalizeUtm(utm.utm_source) } : {}),
    ...(utm.utm_medium ? { medium: normalizeUtm(utm.utm_medium) } : {}),
  };
  const rulePreview = rule ? applyRule(rule, ruleCtx) : "";

  const destErr = tried && !dest.trim() ? "Indique l'adresse de destination" : dest.trim() && !parsed.ok ? parsed.error : null;
  const canSave = parsed.ok && (!shortOn || existingCode || (!codeErr && !!code)) && !saving;

  const save = async () => {
    setTried(true);
    if (!canSave) return;
    setSaving(true);
    const sb = supabaseBrowser();
    const row = {
      company_id: companyId,
      site_id: siteId,
      name: name.trim() || [company?.name, utm.utm_campaign || utm.utm_source].filter(Boolean).join(" · "),
      destination: parsed.clean,
      utm: storeUtm(utm) as never,
      final_url: finalUrl,
      tags,
      expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      code: shortOn ? (existingCode ?? code) : null,
    };
    const res = editing
      ? await sb.from("links").update(row).eq("id", link.id).select("id").single()
      : await sb.from("links").insert({ ...row, workspace_id: ws.workspace.id }).select("id").single();
    setSaving(false);
    if (res.error) {
      const dup = res.error.code === "23505" || /duplicate|unique/i.test(res.error.message);
      toast(dup ? "Ce code court est déjà utilisé, choisis-en un autre" : res.error.message, { error: true });
      if (dup) setTaken({ code, free: false });
      return;
    }
    toast(editing ? "Lien mis à jour" : "Lien créé");
    router.push(`${ws.base}/links/${res.data.id}`);
    router.refresh();
  };

  const shortLink = shortOn && code ? short.url(existingCode ?? code) : "";
  const qrTarget = shortLink || finalUrl;
  const qr = useQr(qrTarget, 208);

  const title = editing ? "Modifier le lien" : link ? "Dupliquer le lien" : "Nouveau lien tracké";

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <Crumbs items={[{ label: "Liens trackés", href: `${ws.base}/links` }, { label: editing ? link.name || "Lien" : "Nouveau" }]} />
      <PageHeader title={title} sub="Destination, paramètres UTM, puis lien court et QR code si besoin. L'aperçu se met à jour en direct.">
        {!editing && (
          <div className="seg" role="tablist" aria-label="Mode de création">
            <button className="on" role="tab" aria-selected>Un lien</button>
            <button role="tab" aria-selected={false} onClick={() => router.push(`${ws.base}/links/new?mode=bulk`)}>En masse</button>
          </div>
        )}
      </PageHeader>

      <div className="lnk-gen">
        <div className="lnk-form">
          {/* 1. Destination */}
          <section className="lnk-sec" aria-labelledby="sec-dest">
            <h2 id="sec-dest"><span className="n">1</span> Destination</h2>
            <div className="lnk-field">
              <label htmlFor="dest">URL de la page</label>
              <input
                id="dest"
                className="input"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://site-du-client.fr/page"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                onBlur={() => cleanDestination()}
                onPaste={(e) => {
                  const v = e.clipboardData.getData("text");
                  if (v) {
                    e.preventDefault();
                    setDest(v.trim());
                    cleanDestination(v.trim());
                  }
                }}
                aria-invalid={!!destErr}
                autoFocus={!link}
              />
              {destErr && <span className="err">{destErr}</span>}
              {removed.length > 0 && (
                <div className="lnk-notice warn" role="status">
                  <AlertTriangle size={14} />
                  <div>
                    <p>
                      <b>UTM retirées de la destination :</b> {removed.map((r) => `${r.k}=${r.v}`).join(", ")}.
                    </p>
                    <p>
                      {removed.some((r) => r.reused)
                        ? "Les valeurs ont été reprises dans les champs ci-dessous quand ils étaient vides : vérifie-les."
                        : "Tes champs UTM étaient déjà remplis : ce sont eux qui comptent."}{" "}
                      Deux jeux d&apos;UTM dans une même URL faussent l&apos;attribution.
                    </p>
                  </div>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setRemoved([])} aria-label="Fermer">
                    <X size={13} />
                  </button>
                </div>
              )}
              {destChanged && (
                <div className="lnk-notice info">
                  <Info size={14} />
                  <p>Les personnes qui ouvriront le lien court à partir de maintenant arriveront sur la nouvelle destination. C&apos;est tout l&apos;intérêt du raccourcisseur : le lien imprimé ou publié ne change pas.</p>
                </div>
              )}
            </div>
            <div className="lnk-grid2">
              <div className="lnk-field">
                <span className="label">Client</span>
                <CompanyPicker
                  value={companyId}
                  onChange={pickCompany}
                  trigger={(open) => (
                    <button type="button" className="input" onClick={open} style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left" }}>
                      {company ? <CompanyMark name={company.name} color={company.color} size={18} /> : null}
                      <span className={`trunc${company ? "" : " faint"}`}>{company?.name ?? "Aucun client"}</span>
                    </button>
                  )}
                />
              </div>
              <div className="lnk-field">
                <label htmlFor="site">Site suivi <span className="fainter" style={{ fontWeight: 400 }}>(facultatif)</span></label>
                <select id="site" className="select" value={siteId ?? ""} onChange={(e) => setSiteId(e.target.value || null)} disabled={!sites.length}>
                  <option value="">{sites.length ? "Aucun" : "Aucun site suivi"}</option>
                  {companySites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.domains[0] ? ` (${s.domains[0]})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* 2. UTM */}
          <section className="lnk-sec" aria-labelledby="sec-utm">
            <h2 id="sec-utm">
              <span className="n">2</span> Paramètres UTM
              <span className="aside">
                <button className="btn btn-sm" onClick={normalizeAll} disabled={!issues.length && !extraIssues} title="Minuscules, sans accents ni espaces">
                  <Wand2 size={12} /> Normaliser
                </button>
              </span>
            </h2>
            {presets.length > 0 && (
              <div className="lnk-field">
                <span className="label">
                  Modèle
                  <Link href={`${ws.base}/settings/utm`} className="fainter" style={{ fontWeight: 400, marginLeft: "auto" }}>Gérer les modèles</Link>
                </span>
                <div className="lnk-presets">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`btn btn-sm${presetId === p.id ? " on" : ""}`}
                      aria-pressed={presetId === p.id}
                      onClick={() => {
                        const next = applyPreset(utm, p);
                        setUtm(next);
                        setPresetId(p.id);
                        // Variables de plateforme : lien destiné au champ de la régie, pas au raccourcisseur
                        if (!existingCode && findMacros(paramString(next)).length) setShortOn(false);
                      }}
                    >
                      {presetId === p.id && <Check size={12} />}
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="lnk-grid2">
              {FIELD_ORDER.map((k) => {
                const iss = conventionIssues(utm[k]);
                const req = k === "utm_source" || k === "utm_medium" || k === "utm_campaign";
                return (
                  <div className="lnk-field" key={k}>
                    <label htmlFor={k}>
                      {UTM_LABEL[k]} <code>{k}</code>
                      {req && <span className="sr">recommandé</span>}
                    </label>
                    <div className="lnk-inwrap">
                      <input
                        id={k}
                        className={`input mono-in${iss.length ? " warn" : ""}`}
                        value={utm[k]}
                        onChange={(e) => setField(k, e.target.value)}
                        placeholder={k === "utm_source" ? "facebook" : k === "utm_medium" ? "paid_social" : k === "utm_campaign" ? "nom_de_campagne" : ""}
                        spellCheck={false}
                        autoComplete="off"
                        aria-describedby={`${k}-h`}
                      />
                      <MacroButton onPick={(t) => insertMacro(k, t)} field={UTM_LABEL[k]} />
                    </div>
                    {iss.length ? (
                      <span className="warn" id={`${k}-h`}>
                        <AlertTriangle size={12} /> {iss.join(", ")} :{" "}
                        <button type="button" className="fainter" style={{ textDecoration: "underline" }} onClick={() => setField(k, normalizeUtm(utm[k]))}>
                          {normalizeUtm(utm[k]) || "vider"}
                        </button>
                      </span>
                    ) : (
                      <span className="hint" id={`${k}-h`}>{UTM_HINT[k]}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {rule && (
              <div className="lnk-notice">
                <Sparkles size={14} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                  <p>
                    Convention de l&apos;espace : <code>{rule}</code>
                    {ruleHelp && <span className="faint"> · {ruleHelp}</span>}
                  </p>
                  <div className="lnk-rule">
                    {manualTokens.map((t) => (
                      <input
                        key={t}
                        className="input"
                        placeholder={t}
                        aria-label={`Valeur de {${t}}`}
                        value={ruleVals[t] ?? ""}
                        onChange={(e) => setRuleVals((v) => ({ ...v, [t]: e.target.value }))}
                      />
                    ))}
                    <span className="mono" style={{ wordBreak: "break-all" }}>→ {rulePreview}</span>
                    <button type="button" className="btn btn-sm" onClick={() => setField("utm_campaign", rulePreview)} disabled={/\{\w+\}/.test(rulePreview)}>
                      Utiliser pour la campagne
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="lnk-field">
              <span className="label">Paramètres supplémentaires</span>
              {utm.extra.map((p, i) => (
                <div className="lnk-extra" key={i}>
                  <input
                    className="input"
                    value={p.k}
                    placeholder="clé"
                    aria-label="Clé du paramètre"
                    onChange={(e) => setUtm((u) => ({ ...u, extra: u.extra.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)) }))}
                  />
                  <input
                    className="input"
                    value={p.v}
                    placeholder="valeur"
                    aria-label="Valeur du paramètre"
                    onChange={(e) => setUtm((u) => ({ ...u, extra: u.extra.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) }))}
                  />
                  <button className="btn btn-ghost btn-icon" onClick={() => setUtm((u) => ({ ...u, extra: u.extra.filter((_, j) => j !== i) }))} aria-label="Retirer ce paramètre">
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div>
                <button className="btn btn-sm btn-ghost" onClick={() => setUtm((u) => ({ ...u, extra: [...u.extra, { k: "", v: "" }] }))}>
                  <Plus size={12} /> Ajouter un paramètre
                </button>
              </div>
            </div>
          </section>

          {/* 3. Lien court */}
          <section className="lnk-sec" aria-labelledby="sec-short">
            <h2 id="sec-short">
              <span className="n">3</span> Lien court et QR code
              <span className="aside">
                <input
                  type="checkbox"
                  className="toggle"
                  checked={shortOn}
                  onChange={(e) => setShortOn(e.target.checked)}
                  aria-label="Créer un lien court"
                  disabled={!!existingCode}
                />
              </span>
            </h2>
            {!shortOn ? (
              <p className="lead" style={{ marginTop: 0 }}>
                Lien UTM seul : pratique pour les publicités (la plateforme remplace les variables). Active le lien court pour une bio, une newsletter, un QR code ou un SMS.
              </p>
            ) : existingCode ? (
              <div className="lnk-field">
                <span className="label">Code</span>
                <div className="lnk-code">
                  <span className="pre">{short.display("")}</span>
                  <input className="input" value={existingCode} readOnly aria-label="Code du lien court" />
                </div>
                <span className="hint">Le code ne change plus une fois le lien diffusé. Tu peux en revanche modifier la destination et les UTM.</span>
              </div>
            ) : (
              <>
                <div className="seg" role="group" aria-label="Type de code">
                  <button
                    className={codeMode === "random" ? "on" : ""}
                    onClick={() => {
                      setCodeMode("random");
                      setCode(randomCode());
                    }}
                  >
                    Aléatoire
                  </button>
                  <button className={codeMode === "custom" ? "on" : ""} onClick={() => setCodeMode("custom")}>
                    Personnalisé
                  </button>
                </div>
                <div className="lnk-field">
                  <label htmlFor="code">Code</label>
                  <div className="lnk-code">
                    <span className="pre" title={short.display("")}>{short.display("")}</span>
                    <div className="lnk-inwrap" style={{ flex: 1 }}>
                      <input
                        id="code"
                        className="input"
                        value={code}
                        onChange={(e) => {
                          setCodeMode("custom");
                          setCode(e.target.value.replace(/\s+/g, "-"));
                        }}
                        spellCheck={false}
                        autoComplete="off"
                        aria-invalid={!!codeErr}
                        style={{ borderRadius: "0 var(--r-sm) var(--r-sm) 0" }}
                      />
                      {codeMode === "random" && (
                        <button type="button" className="btn btn-ghost btn-sm btn-icon in-btn" onClick={() => setCode(randomCode())} aria-label="Générer un autre code">
                          <RefreshCw size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {codeErr ? (
                    <span className="err">{codeErr}</span>
                  ) : (
                    <span className="hint">
                      {codeMode === "random"
                        ? "7 caractères sans ambiguïté (ni 0/o, ni 1/l/i) : faciles à recopier depuis un flyer."
                        : "Court et lisible, par exemple bio-kalia ou salon-2026. Sensible à la casse : préfère les minuscules."}
                    </span>
                  )}
                </div>
              </>
            )}
            {shortOn && (
              <div className="lnk-field" style={{ maxWidth: 260 }}>
                <label htmlFor="exp">Expiration <span className="fainter" style={{ fontWeight: 400 }}>(facultatif)</span></label>
                <input id="exp" type="date" className="input" value={expires} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setExpires(e.target.value)} />
                <span className="hint">Après cette date, le lien affiche « Ce lien n&apos;est plus actif ».</span>
              </div>
            )}
            {shortOn && macros.length > 0 && (
              <div className="lnk-notice warn">
                <AlertTriangle size={14} />
                <p>
                  Un lien court ne remplace pas les variables {platform?.name ?? "des plateformes"} : elles arriveraient telles quelles ({macros[0]}). Pour une publicité, désactive le lien court et colle la chaîne de paramètres dans la plateforme.
                </p>
              </div>
            )}
          </section>

          {/* 4. Organisation */}
          <section className="lnk-sec" aria-labelledby="sec-org">
            <h2 id="sec-org"><span className="n">4</span> Organisation</h2>
            <div className="lnk-grid2">
              <div className="lnk-field">
                <label htmlFor="name">Nom</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={utm.utm_campaign ? `${company?.name ?? ""} ${utm.utm_campaign}`.trim() : "Ex. Bio Instagram Kalia"} />
              </div>
              <div className="lnk-field">
                <span className="label">Étiquettes</span>
                <TagInput value={tags} onChange={setTags} suggestions={knownTags} />
              </div>
            </div>
          </section>
        </div>

        {/* Aperçu */}
        <aside className="lnk-preview" aria-label="Aperçu">
          <div className="lnk-card">
            <h3>
              URL finale
              <span className="aside">
                <CopyButton text={finalUrl} small />
              </span>
            </h3>
            <UrlView url={finalUrl} />
            {macros.length > 0 && platform && (
              <div className="lnk-notice info">
                <Info size={14} />
                <div>
                  <p>
                    <b>Variables {platform.name} détectées.</b> Ne raccourcis pas ce lien : la plateforme ne remplace les variables que dans son propre champ.
                  </p>
                  <p>
                    Mets l&apos;URL sans paramètres comme destination de l&apos;annonce, puis colle la chaîne ci-dessous dans <b>{platform.field}</b>.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="lnk-card">
            <h3>
              Paramètres seuls
              <span className="aside">
                <CopyButton text={params} small label="Copier" msg="Chaîne de paramètres copiée" />
              </span>
            </h3>
            <div className={`lnk-url${params ? "" : " blank"}`}>{params || "Aucun paramètre"}</div>
            <p className="faint" style={{ fontSize: 12 }}>
              Pour le champ « Paramètres d&apos;URL » de Meta ou le « Suffixe de l&apos;URL finale » de Google Ads : la destination de l&apos;annonce reste propre et les variables sont remplacées à chaque clic.
            </p>
          </div>

          {shortOn && (
            <div className="lnk-card">
              <h3>
                Lien court
                <span className="aside">
                  <CopyButton text={shortLink} small />
                </span>
              </h3>
              <div className={`lnk-url big${shortLink ? "" : " blank"}`}>{shortLink ? shortLink.replace(/^https?:\/\//, "") : "Choisis un code"}</div>
              <div className="lnk-qr">
                <div className="img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {qr && <img src={qr} alt="Aperçu du QR code" />}
                </div>
                <div className="side-btns">
                  <button className="btn btn-sm" onClick={() => downloadQr(qrTarget, name || code, "png")} disabled={!qrTarget}>PNG</button>
                  <button className="btn btn-sm" onClick={() => downloadQr(qrTarget, name || code, "svg")} disabled={!qrTarget}>SVG</button>
                  {!editing && <span>Enregistre le lien avant d&apos;imprimer le QR code : il ne fonctionne qu&apos;une fois créé.</span>}
                </div>
              </div>
            </div>
          )}

          <div className="lnk-actions">
            <button className="btn btn-primary btn-lg" onClick={save} disabled={saving || (tried && !canSave)} style={{ flex: 1 }}>
              {saving ? "Enregistrement…" : editing ? "Enregistrer" : "Créer le lien"}
            </button>
            <Link href={editing ? `${ws.base}/links/${link.id}` : `${ws.base}/links`} className="btn btn-lg">
              Annuler
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Variables dynamiques insérables
// ---------------------------------------------------------------------
function MacroButton({ onPick, field }: { onPick: (token: string) => void; field: string }) {
  return (
    <Popover
      align="end"
      width={320}
      trigger={(open, isOpen) => (
        <button type="button" className="btn btn-ghost btn-sm btn-icon in-btn" onClick={open} aria-label={`Insérer une variable dans ${field}`} aria-expanded={isOpen} title="Variables des plateformes">
          <Braces size={13} />
        </button>
      )}
    >
      {(close) => (
        <div className="lnk-mac">
          {MACROS.map((g) => (
            <div key={g.id}>
              <div className="grp">
                {g.name}
                <small>À coller dans : {g.field}</small>
              </div>
              {g.macros.map((m) => (
                <button
                  key={m.token}
                  type="button"
                  className="mi"
                  onClick={() => {
                    onPick(m.token);
                    close();
                  }}
                >
                  <code>{m.token}</code>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------
// Étiquettes libres
// ---------------------------------------------------------------------
export function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const t = raw.trim().replace(/,$/, "").trim();
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setQ("");
  };
  return (
    <div className="lnk-tagin" onClick={() => ref.current?.focus()}>
      {value.map((t) => (
        <span className="chip" key={t}>
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Retirer ${t}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        list="lnk-tags"
        value={q}
        placeholder={value.length ? "" : "Instagram, Black Friday…"}
        aria-label="Ajouter une étiquette"
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) add(v);
          else setQ(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(q);
          } else if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => q && add(q)}
      />
      <datalist id="lnk-tags">
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
