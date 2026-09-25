"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import "@/styles/links.css";
import { SetPage, SetSection } from "@/components/workspace/settings/shell";
import { ConfirmModal, Modal } from "@/components/ui/overlay";
import { EmptyState } from "@/components/ui/misc";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { RULE_TOKENS, applyRule, conventionIssues, findMacros, type Preset } from "@/lib/links/utm";

type Draft = Omit<Preset, "id" | "position"> & { id?: string };
const EMPTY: Draft = { name: "", utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", utm_term: "", extra_params: "" };

const RULE_EXAMPLES = ["{client}_{objectif}_{date}", "{client}_{source}_{offre}_{mois}", "{annee}{mois}_{client}_{canal}_{angle}"];

export function UtmSettings({ presets, rule: initialRule, ruleHelp: initialHelp }: { presets: Preset[]; rule: string; ruleHelp: string }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [list, setList] = useState(presets);
  const [prev, setPrev] = useState(presets);
  if (prev !== presets) {
    setPrev(presets);
    setList(presets);
  }
  const [edit, setEdit] = useState<Draft | null>(null);
  const [del, setDel] = useState<Preset | null>(null);
  const [rule, setRule] = useState(initialRule);
  const [help, setHelp] = useState(initialHelp);
  const dirty = rule !== initialRule || help !== initialHelp;
  const ro = !ws.canWrite;

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
    await mutate(async (sb) => {
      const res = await Promise.all(next.map((p, k) => (p.position === k ? null : sb.from("utm_presets").update({ position: k }).eq("id", p.id))));
      for (const r of res) if (r?.error) throw new Error(r.error.message);
    });
  };

  const saveRule = () =>
    mutate(
      async (sb) =>
        must(await sb.from("link_settings").upsert({ workspace_id: ws.workspace.id, naming_rule: rule.trim(), naming_help: help.trim(), updated_at: new Date().toISOString() })),
      { success: "Convention enregistrée" },
    );

  const example = rule ? applyRule(rule, { client: "kalia_cosmetics", source: "facebook", medium: "paid_social", objectif: "conversion", offre: "serum", canal: "meta", angle: "routine" }) : "";

  return (
    <SetPage
      title="Conventions UTM"
      lead="Les modèles et la règle de nommage que toute l'équipe utilise pour créer des liens trackés. Des UTM cohérentes, c'est un reporting lisible : un seul « facebook », pas « Facebook », « fb » et « meta » à la fois."
    >
      <SetSection title="Règle de nommage des campagnes">
        <div className="lnk-sec" style={{ boxShadow: "none", padding: 0, background: "transparent" }}>
          <div className="lnk-field">
            <label htmlFor="rule">Modèle de nom</label>
            <input id="rule" className="input" style={{ fontFamily: "var(--mono)", fontSize: 13 }} value={rule} onChange={(e) => setRule(e.target.value)} placeholder="{client}_{objectif}_{date}" disabled={ro} />
            <span className="hint">
              Entre accolades : des variables. Celles de la liste sont remplies automatiquement, les autres ({"{objectif}"}, {"{offre}"}…) sont demandées au moment de créer le lien.
            </span>
          </div>
          <div className="lnk-tokens" aria-label="Variables automatiques">
            {RULE_TOKENS.map((t) => (
              <button key={t.token} type="button" className="btn btn-sm" title={t.label} disabled={ro} onClick={() => setRule((r) => (r && !/[_-]$/.test(r) ? `${r}_{${t.token}}` : `${r}{${t.token}}`))}>
                {`{${t.token}}`}
              </button>
            ))}
          </div>
          {!rule && (
            <div className="lnk-row" style={{ fontSize: 12.5 }}>
              <span className="faint">Exemples :</span>
              {RULE_EXAMPLES.map((x) => (
                <button key={x} type="button" className="btn btn-ghost btn-sm mono" onClick={() => setRule(x)} disabled={ro}>
                  {x}
                </button>
              ))}
            </div>
          )}
          <div className="lnk-field">
            <label htmlFor="rule-help">Aide pour l&apos;équipe <span className="fainter" style={{ fontWeight: 400 }}>(facultatif)</span></label>
            <input id="rule-help" className="input" value={help} onChange={(e) => setHelp(e.target.value)} placeholder="objectif : notoriete, trafic, conversion ou retargeting" disabled={ro} />
          </div>
          {example && (
            <div className="lnk-notice">
              <span>
                Exemple : <code>{example}</code>
              </span>
            </div>
          )}
          {!ro && (
            <div className="lnk-row">
              <button className="btn btn-primary" onClick={saveRule} disabled={!dirty}>
                Enregistrer la règle
              </button>
              {dirty && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setRule(initialRule);
                    setHelp(initialHelp);
                  }}
                >
                  Annuler
                </button>
              )}
            </div>
          )}
        </div>
      </SetSection>

      <SetSection
        title="Modèles UTM"
        action={
          !ro && (
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setEdit({ ...EMPTY })}>
              <Plus size={13} /> Nouveau modèle
            </button>
          )
        }
      >
        <p className="faint" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Proposés en un clic dans le générateur, dans cet ordre. Un champ vide laisse la saisie libre.
        </p>
        {list.length === 0 ? (
          <div className="card">
            <EmptyState icon="link" title="Aucun modèle" text="Crée un modèle par canal : Meta Ads, Google Ads, newsletter, bio Instagram…" />
          </div>
        ) : (
          <div className="lnk-presets-list">
            {list.map((p, i) => (
              <div className="lnk-preset" key={p.id}>
                <div className="ord">
                  <button onClick={() => move(i, -1)} disabled={ro || i === 0} aria-label={`Monter ${p.name}`}>
                    <ArrowUp size={12} />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={ro || i === list.length - 1} aria-label={`Descendre ${p.name}`}>
                    <ArrowDown size={12} />
                  </button>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{p.name}</div>
                  <div className="s trunc">
                    {[
                      p.utm_source && `utm_source=${p.utm_source}`,
                      p.utm_medium && `utm_medium=${p.utm_medium}`,
                      p.utm_campaign && `utm_campaign=${p.utm_campaign}`,
                      p.utm_content && `utm_content=${p.utm_content}`,
                      p.utm_term && `utm_term=${p.utm_term}`,
                      p.extra_params,
                    ]
                      .filter(Boolean)
                      .join("&") || "Aucun paramètre"}
                  </div>
                </div>
                {!ro && (
                  <div className="lnk-row" style={{ gap: 2 }}>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEdit({ ...p })} aria-label={`Modifier ${p.name}`}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setDel(p)} aria-label={`Supprimer ${p.name}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SetSection>

      <SetSection title="Bonnes pratiques">
        <ul className="muted" style={{ fontSize: 13, paddingLeft: 18, display: "grid", gap: 6, margin: 0 }}>
          <li>Tout en minuscules, sans accents ni espaces : GA4 distingue « Facebook » de « facebook ».</li>
          <li>
            <b>utm_source</b> = qui envoie (facebook, google, newsletter), <b>utm_medium</b> = le type de canal (paid_social, cpc, email, bio, qr_code).
          </li>
          <li>Pour les publicités, colle la chaîne de paramètres dans la plateforme (Paramètres d&apos;URL Meta, suffixe d&apos;URL finale Google) : les variables y sont remplacées à chaque clic.</li>
          <li>Garde les liens courts pour l&apos;organique, l&apos;email, les QR codes et l&apos;influence : ce sont eux qui comptent les clics.</li>
        </ul>
      </SetSection>

      {edit && <PresetModal draft={edit} count={list.length} onClose={() => setEdit(null)} />}
      {del && (
        <ConfirmModal
          title="Supprimer ce modèle ?"
          text={`« ${del.name} » ne sera plus proposé dans le générateur. Les liens déjà créés ne changent pas.`}
          onConfirm={() => mutate(async (sb) => must(await sb.from("utm_presets").delete().eq("id", del.id)), { success: "Modèle supprimé" }).then(() => undefined)}
          onClose={() => setDel(null)}
        />
      )}
    </SetPage>
  );
}

const FIELDS: { k: keyof Draft; label: string; ph: string }[] = [
  { k: "utm_source", label: "utm_source", ph: "facebook" },
  { k: "utm_medium", label: "utm_medium", ph: "paid_social" },
  { k: "utm_campaign", label: "utm_campaign", ph: "{{campaign.name}}" },
  { k: "utm_content", label: "utm_content", ph: "{{ad.name}}" },
  { k: "utm_term", label: "utm_term", ph: "{{adset.name}}" },
];

function PresetModal({ draft, count, onClose }: { draft: Draft; count: number; onClose: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft, v: string) => setD((x) => ({ ...x, [k]: v }));
  const issues = FIELDS.flatMap((f) => conventionIssues(String(d[f.k] ?? "")));
  const hasMacros = FIELDS.some((f) => findMacros(String(d[f.k] ?? "")).length) || findMacros(d.extra_params).length > 0;

  const save = async () => {
    if (!d.name.trim()) return;
    setBusy(true);
    const row = {
      name: d.name.trim(),
      utm_source: d.utm_source.trim(),
      utm_medium: d.utm_medium.trim(),
      utm_campaign: d.utm_campaign.trim(),
      utm_content: d.utm_content.trim(),
      utm_term: d.utm_term.trim(),
      extra_params: d.extra_params.trim().replace(/^[?&]+/, ""),
    };
    const ok = await mutate(
      async (sb) =>
        d.id
          ? must(await sb.from("utm_presets").update(row).eq("id", d.id))
          : must(await sb.from("utm_presets").insert({ ...row, workspace_id: ws.workspace.id, position: count })),
      { success: d.id ? "Modèle mis à jour" : "Modèle créé" },
    );
    setBusy(false);
    if (ok !== undefined) onClose();
  };

  return (
    <Modal
      title={d.id ? "Modifier le modèle" : "Nouveau modèle UTM"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !d.name.trim()}>
            {d.id ? "Enregistrer" : "Créer le modèle"}
          </button>
        </>
      }
    >
      <div className="lnk-field">
        <label htmlFor="p-name">Nom</label>
        <input id="p-name" className="input" autoFocus value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex. Meta Ads (paramètres dynamiques)" />
      </div>
      <div className="lnk-grid2">
        {FIELDS.map((f) => (
          <div className="lnk-field" key={f.k}>
            <label htmlFor={`p-${f.k}`}>
              <code style={{ fontSize: 11.5, color: "var(--text-2)" }}>{f.label}</code>
            </label>
            <input id={`p-${f.k}`} className="input" style={{ fontFamily: "var(--mono)", fontSize: 12.5 }} value={String(d[f.k] ?? "")} onChange={(e) => set(f.k, e.target.value)} placeholder={f.ph} spellCheck={false} />
          </div>
        ))}
      </div>
      <div className="lnk-field">
        <label htmlFor="p-extra">Paramètres supplémentaires</label>
        <input id="p-extra" className="input" style={{ fontFamily: "var(--mono)", fontSize: 12.5 }} value={d.extra_params} onChange={(e) => set("extra_params", e.target.value)} placeholder="utm_id={{campaign.id}}&aos_ad={{ad.id}}" spellCheck={false} />
        <span className="hint">
          Format clé=valeur séparés par &amp;. <span className="mono">utm_id</span> remplit le champ ID de campagne ; <span className="mono">aos_ad</span> et <span className="mono">aos_adset</span> aident l&apos;attribution à retrouver l&apos;annonce.
        </span>
      </div>
      {issues.length > 0 && <div className="lnk-notice warn">Valeurs hors convention ({[...new Set(issues)].join(", ")}) : préfère minuscules et tirets bas.</div>}
      {hasMacros && <div className="lnk-notice info">Ce modèle contient des variables de plateforme : il sert aux liens UTM collés dans la plateforme, pas aux liens courts.</div>}
    </Modal>
  );
}
