"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Code2, Globe, MousePointerClick, Plus, Route, Sparkles } from "lucide-react";

import { CompanyMark } from "@/components/reporting/common";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { modelName } from "@/lib/tracking/attribution";
import type { SiteRow } from "@/lib/tracking/load";
import { SiteModal } from "./site-modal";
import { SiteStatus, siteState } from "./shared";

export function SitesView({ sites }: { sites: SiteRow[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const [modal, setModal] = useState(false);
  const live = sites.filter((s) => siteState(s.last_event_at) === "live").length;

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Attribution</h1>
          <p>
            Tracking first-party sur les sites de tes clients : chaque vente est rattachée aux publicités, emails et visites qui l&apos;ont précédée, avec le ROAS réel face
            au ROAS déclaré par les plateformes.
          </p>
        </div>
        {ws.canWrite && (
          <div className="actions">
            <button className="btn btn-primary" onClick={() => setModal(true)}>
              <Plus size={14} /> Nouveau site suivi
            </button>
          </div>
        )}
      </div>

      {sites.length ? (
        <div className="card">
          <div className="card-h">
            <h2>Sites suivis</h2>
            <span className="faint" style={{ fontSize: 12 }}>
              {live} sur {sites.length} reçoi{live > 1 ? "vent" : "t"} des données
            </span>
          </div>
          <ul className="trk-sites">
            {sites.map((s) => {
              const c = ws.company(s.company_id);
              const href = `${ws.base}/tracking/${s.id}`;
              return (
                <li key={s.id}>
                  <Link href={href} className="trk-site">
                    {c ? <CompanyMark name={c.name} color={c.color} size={30} /> : <span className="trk-agency" aria-hidden><Globe size={15} /></span>}
                    <span className="main">
                      <span className="t trunc">{s.name}</span>
                      <span className="s trunc">
                        {c ? c.name : "Site de l'agence"} · {s.domains.length ? s.domains.join(", ") : "tous les domaines"}
                      </span>
                    </span>
                    <span className="meta">
                      <SiteStatus last={s.last_event_at} />
                      <span className="faint">
                        {modelName(s.settings.model)} · {s.settings.window_days} j{s.settings.consent === "required" ? " · consentement" : ""}
                      </span>
                    </span>
                  </Link>
                  <Link href={`${href}?tab=install`} className="btn btn-sm btn-ghost install" aria-label={`Installer le script sur ${s.name}`}>
                    <Code2 size={13} /> Installation
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="card">
          <div className="empty">
            <div className="ic">
              <MousePointerClick size={18} />
            </div>
            <h3>Aucun site suivi</h3>
            <p>Ajoute le site d&apos;un client, colle une ligne de script dans son en-tête, et chaque vente sera reliée aux publicités qui l&apos;ont générée.</p>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {ws.canWrite && (
                <button className="btn btn-primary" onClick={() => setModal(true)}>
                  <Plus size={14} /> Nouveau site suivi
                </button>
              )}
              {ws.isAdmin && (
                <button
                  className="btn"
                  onClick={() =>
                    mutate(async (sb) => must(await sb.rpc("load_demo_tracking", { ws: ws.workspace.id })), { success: "Exemple chargé" }).then(() => router.refresh())
                  }
                >
                  <Sparkles size={14} /> Charger un exemple
                </button>
              )}
            </div>
            <div className="rp-guide">
              <div className="st">
                <span className="n">1</span>
                <h4>Installe le script</h4>
                <p>Une ligne dans l&apos;en-tête du site, ou une balise GTM. Compatible bandeau cookies.</p>
              </div>
              <div className="st">
                <span className="n">2</span>
                <h4>Tague tes publicités</h4>
                <p>Les modèles UTM des liens trackés ajoutent les identifiants de campagne et d&apos;annonce.</p>
              </div>
              <div className="st">
                <span className="n">3</span>
                <h4>Lis le ROAS réel</h4>
                <p>
                  <Route size={12} style={{ display: "inline", verticalAlign: -1 }} /> Parcours complet de chaque acheteur, sur tous ses appareils, comparé à ce que
                  déclarent Meta et Google.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {modal && <SiteModal onClose={() => setModal(false)} />}
    </div>
  );
}
