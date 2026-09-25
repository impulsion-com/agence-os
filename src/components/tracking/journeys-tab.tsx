"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Route } from "lucide-react";

import { useWorkspace } from "@/lib/workspace/context";
import { fmtKpi, type Period } from "@/lib/ads/metrics";
import { modelName, type ModelId } from "@/lib/tracking/attribution";
import { channelColor, channelName, hostOf } from "@/lib/tracking/channels";
import type { Goal, Journey, JourneyTouch, Overview, SiteRow } from "@/lib/tracking/load";
import { AttrFilters } from "./attribution-tab";

const TYPE: Record<string, string> = { purchase: "Achat", deal_won: "Deal gagné", lead: "Prospect", booking: "Rendez-vous" };

const dt = (ts: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

function path(url: string | null | undefined) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.pathname + (u.pathname.length < 30 && u.search ? "…" : "");
  } catch {
    return url.slice(0, 60);
  }
}

/** Libellé lisible d'un point de contact : régie, campagne, annonce, référent. */
function touchTitle(t: JourneyTouch, links: Record<string, string>) {
  const parts: string[] = [];
  if (t.channel === "short_link" && t.link_id) parts.push(links[t.link_id] ?? "Lien court");
  if (t.campaign) parts.push(t.campaign);
  if (t.content) parts.push(t.content);
  if (!parts.length) {
    if (t.channel === "direct") parts.push("Accès direct ou favori");
    else if (t.referrer) parts.push(hostOf(t.referrer));
    else if (t.source) parts.push([t.source, t.medium].filter(Boolean).join(" / "));
  }
  return parts.join(" · ");
}

export function JourneysTab({ site, period, model, window, goal, overview }: { site: SiteRow; period: Period; model: ModelId; window: number; goal: Goal; overview: Overview }) {
  const ws = useWorkspace();
  const currency = ws.workspace.currency || "EUR";
  const [open, setOpen] = useState<Set<string>>(() => new Set(overview.journeys.slice(0, 3).map((j) => j.id)));
  const list = overview.journeys;

  return (
    <>
      <AttrFilters period={period} model={model} window={window} goal={goal} site={site} />
      <div className="card">
        <div className="card-h" style={{ flexWrap: "wrap" }}>
          <h2>Dernières conversions</h2>
          <span className="faint" style={{ fontSize: 12 }}>
            {list.length ? `${list.length} plus récentes sur ${overview.convCount}` : ""} · crédit « {modelName(model)} », fenêtre {window} j
          </span>
        </div>
        {!list.length ? (
          <div className="empty" style={{ padding: 32 }}>
            <div className="ic">
              <Route size={18} />
            </div>
            <p>Aucune {goal === "sales" ? "vente" : "conversion prospect"} sur la période.</p>
          </div>
        ) : (
          <ul className="trk-journeys">
            {list.map((j) => (
              <JourneyItem
                key={j.id}
                j={j}
                currency={currency}
                links={overview.links}
                open={open.has(j.id)}
                onToggle={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(j.id)) n.delete(j.id);
                    else n.add(j.id);
                    return n;
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function JourneyItem({ j, currency, links, open, onToggle }: { j: Journey; currency: string; links: Record<string, string>; open: boolean; onToggle: () => void }) {
  const id = `trk-j-${j.id.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <li className={`trk-journey${open ? " open" : ""}`}>
      <button type="button" className="head" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {open ? <ChevronDown size={14} className="faint" /> : <ChevronRight size={14} className="faint" />}
        <span className="who">
          <b className="trunc">{j.who}</b>
          <span className="faint">
            {TYPE[j.type] ?? j.type} · {dt(j.ts)}
          </span>
        </span>
        <span className="chips" aria-label="Canaux du parcours">
          {j.touches.length ? (
            j.touches.slice(-6).map((t, i) => (
              <span key={i} className="chip" style={{ ["--c" as string]: channelColor(t.channel) }} title={channelName(t.channel)}>
                <i />
                {channelName(t.channel)}
              </span>
            ))
          ) : (
            <span className="faint" style={{ fontSize: 12 }}>Aucun point de contact dans la fenêtre</span>
          )}
        </span>
        <span className="val">
          {j.value ? fmtKpi("value", j.value, currency) : ""}
          <small>
            {j.touches.length} contact{j.touches.length > 1 ? "s" : ""}
            {j.touches.length > 1 ? ` sur ${j.days} j` : ""}
          </small>
        </span>
      </button>
      {open && (
        <ol className="trk-timeline" id={id}>
          {j.touches.map((t, i) => (
            <li key={i} style={{ ["--c" as string]: channelColor(t.channel) }}>
              <span className="dot" aria-hidden />
              <div className="body">
                <div className="top">
                  <b>{channelName(t.channel)}</b>
                  <span className="trunc muted">{touchTitle(t, links)}</span>
                  <span className="w" title="Part du crédit de cette conversion">
                    {Math.round(t.weight * 100)} %
                  </span>
                </div>
                <div className="meta">
                  <span>{dt(t.ts)}</span>
                  {t.landing_url && <span className="mono trunc">{path(t.landing_url)}</span>}
                  {t.term && <span className="trunc">Ensemble : {t.term}</span>}
                </div>
              </div>
            </li>
          ))}
          <li className="conv">
            <span className="dot" aria-hidden />
            <div className="body">
              <div className="top">
                <b>{TYPE[j.type] ?? j.type}</b>
                {j.value ? <span>{fmtKpi("value", j.value, currency)}</span> : null}
              </div>
              <div className="meta">
                <span>{dt(j.ts)}</span>
              </div>
            </div>
          </li>
        </ol>
      )}
    </li>
  );
}
