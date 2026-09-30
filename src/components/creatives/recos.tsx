"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, CircleCheck, Clapperboard, ExternalLink, Lightbulb, Plus, Sparkles, Trash2 } from "lucide-react";

import { CompanyMark } from "@/components/reporting/common";
import { EmptyState } from "@/components/ui/misc";
import { ConfirmModal, Menu } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { ago, fmtDate } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { AWARE, FORMAT } from "@/lib/creatives/constants";
import type { Opportunity } from "@/lib/creatives/ai-parse";
import { adLibraryUrl, firstSentence } from "@/lib/creatives/intel-core";
import type { IntelData, RecommendationRow } from "@/lib/creatives/intel-types";
import { AiCallout, callIntel, useAction } from "./intel-parts";

const KIND: Record<Opportunity["kind"], { name: string; help: string }> = {
  scale: { name: "Décliner", help: "Ce qui gagne déjà chez toi, à décliner" },
  counter: { name: "Contrer", help: "Ce que les concurrents font tourner longtemps" },
  gap: { name: "Terrain vierge", help: "Angle, niveau de conscience ou hook jamais testé" },
};

export function Recos({ data, conceptCount }: { data: IntelData; conceptCount: Record<string, number> }) {
  const ws = useWorkspace();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const { busy, run } = useAction();
  const mutate = useMutate();
  const [deleting, setDeleting] = useState<RecommendationRow | null>(null);

  // Clients proposés : ceux qui ont des concepts, une surveillance ou des recommandations
  const companies = ws.companies.filter(
    (c) => conceptCount[c.id] || data.watches.some((w) => w.company_id === c.id) || data.recommendations.some((r) => r.company_id === c.id),
  );
  const wanted = sp.get("company");
  const company = companies.find((c) => c.id === wanted) ?? companies.find((c) => data.recommendations.some((r) => r.company_id === c.id)) ?? companies[0] ?? null;
  const history = data.recommendations.filter((r) => r.company_id === company?.id);
  const selId = sp.get("rec");
  const current = history.find((r) => r.id === selId) ?? history[0] ?? null;

  const go = (params: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`${path}?${q}`, { scroll: false });
  };

  const generate = () =>
    company &&
    run("gen", () => callIntel<{ id: string }>({ action: "recommend", workspace_id: ws.workspace.id, company_id: company.id }), (r) => {
      go({ rec: r.id });
      router.refresh();
      return "Recommandation générée";
    });

  const adByArchive = useMemo(() => new Map(data.ads.map((a) => [a.archive_id, a])), [data.ads]);

  if (!companies.length)
    return (
      <div className="card">
        <EmptyState icon="sparkles" title="Pas encore de matière" text="Les recommandations croisent les concepts d'un client, leurs performances et la veille de ses concurrents. Crée des concepts ou ajoute une surveillance pour commencer." />
      </div>
    );

  return (
    <div className="crv-rc">
      <div className="crv-an-controls">
        <Menu
          search={companies.length > 7 ? "Client…" : undefined}
          items={companies.map((c) => ({ label: c.name, checked: company?.id === c.id, onSelect: () => go({ company: c.id, rec: null }) }))}
          trigger={(open, isOpen) => (
            <button type="button" className="btn" onClick={open} aria-expanded={isOpen}>
              {company && <CompanyMark name={company.name} color={company.color} size={18} />}
              {company?.name ?? "Choisir un client"}
              <ChevronDown size={13} className="faint" />
            </button>
          )}
        />
        {ws.canWrite && (
          <button type="button" className="btn btn-primary" disabled={!data.ai.enabled || !!busy || !company} onClick={generate} title={data.ai.enabled ? `Modèle : ${data.ai.smart}` : "Ajoute ANTHROPIC_API_KEY pour générer"}>
            <Sparkles size={14} /> {busy === "gen" ? "Analyse en cours (jusqu'à une minute)…" : "Générer"}
          </button>
        )}
        <span className="faint" style={{ fontSize: 12 }}>
          Croise tes performances des 90 derniers jours (angle, hook, format, niveau de conscience, fatigue), les pubs que tes concurrents font durer et les terrains jamais testés.
        </span>
      </div>

      {!data.ai.enabled && <AiCallout what="le bouton « Générer » est désactivé. Les recommandations déjà enregistrées restent consultables." />}

      {!history.length ? (
        <div className="card">
          <EmptyState icon="sparkles" title={`Aucune recommandation pour ${company?.name ?? "ce client"}`} text="Génère une recommandation : 3 à 5 opportunités argumentées, chacune avec un brief prêt à transformer en concept." />
        </div>
      ) : (
        <div className="crv-rc-layout">
          <nav className="crv-rc-hist card" aria-label="Historique">
            <div className="card-h">
              <h3>Historique</h3>
            </div>
            <ul>
              {history.map((r) => (
                <li key={r.id}>
                  <button type="button" className={r.id === current?.id ? "on" : ""} onClick={() => go({ rec: r.id })} aria-current={r.id === current?.id ? "true" : undefined}>
                    <span>{fmtDate(r.created_at, true)}</span>
                    <span className="faint">
                      {r.is_demo ? "Exemple" : ago(r.created_at)} · {r.output.opportunities?.length ?? 0} opportunités
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {current && (
            <div className="crv-rc-main">
              <section className="card crv-rc-sum">
                <div className="card-h">
                  <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Lightbulb size={16} className="faint" aria-hidden /> Synthèse
                  </h2>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {current.is_demo ? "Exemple de démonstration" : `${current.model} · ${fmtDate(current.created_at, true)}`}
                    {ws.canWrite && (
                      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Supprimer cette recommandation" title="Supprimer" onClick={() => setDeleting(current)} style={{ marginLeft: 6 }}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </span>
                </div>
                <p>{current.output.summary}</p>
              </section>
              {current.output.opportunities.map((o, i) => (
                <OpportunityCard
                  key={`${current.id}-${i}`}
                  index={i}
                  o={o}
                  rec={current}
                  companyId={company?.id ?? null}
                  ads={o.competitor_ads.map((id) => ({ id, ad: adByArchive.get(id) ?? null }))}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {deleting && (
        <ConfirmModal
          title="Supprimer la recommandation"
          text="Les concepts déjà créés à partir de cette recommandation restent dans la bibliothèque."
          onClose={() => setDeleting(null)}
          onConfirm={() => void mutate(async (sb) => must(await sb.from("creative_recommendations").delete().eq("id", deleting.id).select("id")), { success: "Recommandation supprimée" }).then(() => go({ rec: null }))}
        />
      )}
    </div>
  );
}

function OpportunityCard({
  index, o, rec, companyId, ads,
}: {
  index: number;
  o: Opportunity;
  rec: RecommendationRow;
  companyId: string | null;
  ads: { id: string; ad: IntelData["ads"][number] | null }[];
}) {
  const ws = useWorkspace();
  const toast = useToast();
  const router = useRouter();
  const [created, setCreated] = useState<string | null>(rec.created_concepts?.[String(index)] ?? null);
  const [busy, setBusy] = useState(false);
  const b = o.brief;

  const createConcept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const refs = ads.filter((x) => x.ad && !x.ad.is_demo).map((x) => adLibraryUrl(x.id));
      const row = must(
        await sb
          .from("creative_concepts")
          .insert({
            workspace_id: ws.workspace.id,
            company_id: companyId,
            title: b.concept_title.slice(0, 200),
            status: "brief",
            angle: b.angle,
            hook: b.hooks[0] ?? "",
            persona: b.persona,
            format: b.format,
            awareness: b.awareness,
            platforms: ["meta"],
            tags: ["Recommandation IA"],
            brief: {
              context: o.why,
              script: b.script,
              shots: b.shots.join("\n"),
              cta: b.cta,
              ...(refs.length ? { references: refs.join("\n") } : {}),
            } as never,
            source: { type: "recommendation", recommendation_id: rec.id, title: o.title } as never,
            owner_id: ws.me.id,
            position: Date.now() / 1000,
          })
          .select("id")
          .single(),
      );
      const id = row!.id as string;
      must(await sb.from("creative_variants").insert(b.hooks.map((h, i) => ({ workspace_id: ws.workspace.id, concept_id: id, name: `Hook ${i + 1}`, hook: h, position: (i + 1) * 1000 }))).select("id"));
      await sb.from("creative_recommendations").update({ created_concepts: { ...(rec.created_concepts ?? {}), [String(index)]: id } }).eq("id", rec.id);
      setCreated(id);
      toast("Concept créé (statut Brief)");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card crv-rc-opp">
      <div className="head">
        <span className={`kind ${o.kind}`} title={KIND[o.kind]?.help}>{KIND[o.kind]?.name ?? o.kind}</span>
        <h3>
          {index + 1}. {o.title}
        </h3>
      </div>
      <p className="why">{o.why}</p>
      {o.evidence.length > 0 && (
        <dl className="ev">
          {o.evidence.map((e, i) => (
            <div key={i}>
              <dt>{e.label}</dt>
              <dd>{e.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {ads.length > 0 && (
        <div className="cited">
          <span className="lbl">Pubs concurrentes citées</span>
          <ul>
            {ads.map(({ id, ad }) => (
              <li key={id}>
                <span className="trunc">
                  <b>{ad?.page_name ?? "Pub"}</b> {ad ? `« ${firstSentence(ad.bodies[0]) || ad.titles[0] || ""} »` : id}
                </span>
                {ad && !ad.is_demo ? (
                  <a href={adLibraryUrl(id)} target="_blank" rel="noopener noreferrer" className="lnk">
                    Aperçu <ExternalLink size={11} aria-hidden />
                  </a>
                ) : (
                  <Link href={`${ws.base}/creatives?view=intel`} className="lnk">Veille</Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="brief">
        <div className="bh">
          <Clapperboard size={14} aria-hidden />
          <b>{b.concept_title}</b>
        </div>
        <div className="facts">
          <span><i>Angle</i>{b.angle}</span>
          <span><i>Format</i>{FORMAT[b.format]?.name ?? b.format}</span>
          <span><i>Conscience</i>{AWARE[b.awareness]?.name ?? b.awareness}</span>
          {b.persona && <span><i>Persona</i>{b.persona}</span>}
        </div>
        <div className="cols">
          <div>
            <h4>3 hooks</h4>
            <ol>{b.hooks.map((h, i) => <li key={i}>« {h} »</li>)}</ol>
            <h4>Plans</h4>
            <ul>{b.shots.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
          <div>
            <h4>Script</h4>
            <p className="script">{b.script}</p>
            {b.cta && (
              <>
                <h4>Appel à l&apos;action</h4>
                <p>{b.cta}</p>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="acts">
        {created ? (
          <Link href={`${ws.base}/creatives/${created}`} className="btn btn-sm">
            <CircleCheck size={13} /> Voir le concept
          </Link>
        ) : ws.canWrite ? (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={createConcept}>
            <Plus size={13} /> Créer le concept
          </button>
        ) : null}
      </div>
    </article>
  );
}
