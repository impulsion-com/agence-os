"use client";

import Link from "next/link";
import { MonitorSmartphone, Server } from "lucide-react";

import { Drawer } from "@/components/ui/overlay";
import { fmtKpi } from "@/lib/ads/metrics";
import { ago } from "@/lib/format";
import type { Stage } from "@/lib/tracking/funnel";
import type { PersonSheet } from "@/lib/tracking/load";
import { useWorkspace } from "@/lib/workspace/context";
import { ChannelLabel, useQueryNav } from "./shared";

const when = (ts: string) => new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const SOURCES: Record<string, string> = { script: "site", api: "API", stripe: "Stripe", webhook: "webhook", import: "import CSV", crm: "CRM" };

/** Tout ce que l'on sait d'une personne sur un site : identités, appareils, parcours du plus récent au plus ancien. */
export function PersonDrawer({ person, stages }: { person: PersonSheet; stages: Stage[] }) {
  const ws = useWorkspace();
  const go = useQueryNav();
  const currency = ws.workspace.currency || "EUR";
  const stageOf = (type: string) => stages.find((s) => s.key === type || s.aliases.includes(type));
  const sales = person.events.filter((e) => stageOf(e.type)?.kind === "sale");
  const revenue = sales.reduce((s, e) => s + (Number(e.value) || 0), 0);
  // Un seul fil : points de contact et évènements mêlés
  const feed = [
    ...person.touches.map((t) => ({ kind: "touch" as const, ts: t.ts, t })),
    ...person.events.map((e) => ({ kind: "event" as const, ts: e.ts, e })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));
  const title = person.name || person.emails[0] || person.phones[0] || "Personne";

  return (
    <Drawer header={<b className="trunc">{title}</b>} onClose={() => go({ person: null })}>
      <div className="trk-person">
        <dl className="trk-facts">
          <div>
            <dt>Emails</dt>
            <dd>{person.emails.length ? person.emails.join(", ") : "Aucun"}</dd>
          </div>
          <div>
            <dt>Téléphones</dt>
            <dd>{person.phones.length ? person.phones.join(", ") : "Aucun"}</dd>
          </div>
          <div>
            <dt>Première visite</dt>
            <dd>{when(person.first_seen)}</dd>
          </div>
          <div>
            <dt>Dernière activité</dt>
            <dd>{ago(person.last_seen)}</dd>
          </div>
          <div>
            <dt>Ventes</dt>
            <dd>{sales.length ? `${sales.length} vente${sales.length > 1 ? "s" : ""}, ${fmtKpi("value", revenue, currency)}` : "Aucune"}</dd>
          </div>
          <div>
            <dt>Pages vues</dt>
            <dd>{person.pageviews}</dd>
          </div>
        </dl>
        {person.contact_id && (
          <p>
            <Link href={`${ws.base}/crm/contacts/${person.contact_id}`} style={{ textDecoration: "underline" }}>Ouvrir le contact dans le CRM</Link>
          </p>
        )}

        <h3>Appareils et sources reliés</h3>
        <ul className="trk-devices">
          {person.devices.map((d) => (
            <li key={d.id}>
              {d.server ? <Server size={13} className="faint" /> : <MonitorSmartphone size={13} className="faint" />}
              <span>{d.server ? "Envoi serveur (API, webhook, import)" : `${d.device ?? "Appareil inconnu"}${d.country ? `, ${d.country}` : ""}`}</span>
              <span className="faint">vu {ago(d.last_seen)}</span>
            </li>
          ))}
        </ul>

        <h3>Parcours</h3>
        {feed.length === 0 ? (
          <p className="faint">Aucun point de contact ni évènement enregistré.</p>
        ) : (
          <ol className="trk-feed">
            {feed.map((f, i) =>
              f.kind === "touch" ? (
                <li key={`t${i}`} className="touch">
                  <time dateTime={f.ts}>{when(f.ts)}</time>
                  <div>
                    <ChannelLabel channel={f.t.channel} />
                    <span className="sub">
                      {[f.t.campaign, f.t.term, f.t.content].filter(Boolean).join(" · ") || (f.t.referrer ? `depuis ${f.t.referrer.replace(/^https?:\/\//, "").slice(0, 60)}` : "arrivée sur le site")}
                    </span>
                  </div>
                </li>
              ) : (
                <li key={`e${f.e.id}`} className="event">
                  <time dateTime={f.ts}>{when(f.ts)}</time>
                  <div>
                    <b>{stageOf(f.e.type)?.label ?? f.e.type}</b>
                    <span className="sub">
                      {[f.e.value ? fmtKpi("value", Number(f.e.value), f.e.currency || currency) : null, `via ${SOURCES[f.e.source] ?? f.e.source}`, f.e.order_id && !f.e.order_id.startsWith("auto:") && !f.e.order_id.startsWith("csv:") ? f.e.order_id : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ol>
        )}
        {(person.touches.length >= 300 || person.events.length >= 300) && <p className="faint">Seuls les 300 éléments les plus récents de chaque type sont affichés.</p>}
      </div>
    </Drawer>
  );
}
