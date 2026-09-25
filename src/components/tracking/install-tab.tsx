"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Pause, Play, Radio, ShieldCheck, Shuffle } from "lucide-react";

import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtKpi } from "@/lib/ads/metrics";
import { channelName } from "@/lib/tracking/channels";
import { useWorkspace } from "@/lib/workspace/context";
import type { SiteRow } from "@/lib/tracking/load";
import { ChannelLabel, Code } from "./shared";

type Guide = "html" | "wordpress" | "shopify" | "webflow" | "gtm";
const GUIDES: { id: Guide; name: string }[] = [
  { id: "html", name: "HTML" },
  { id: "wordpress", name: "WordPress" },
  { id: "shopify", name: "Shopify" },
  { id: "webflow", name: "Webflow" },
  { id: "gtm", name: "Google Tag Manager" },
];

type Cmp = "axeptio" | "cookiebot" | "gcm";

export function snippet(appUrl: string, pk: string) {
  return `<script>window.aos=window.aos||function(){(aos.q=aos.q||[]).push(arguments)};</script>
<script async src="${appUrl}/t.js" data-key="${pk}"></script>`;
}

export function InstallTab({ site, appUrl }: { site: SiteRow; appUrl: string }) {
  const [guide, setGuide] = useState<Guide>("html");
  const [cmp, setCmp] = useState<Cmp>("axeptio");
  const code = snippet(appUrl, site.public_key);
  const consent = site.settings.consent === "required";
  const main = site.domains[0] ?? "ton-site.fr";

  return (
    <div className="trk-install">
      <div className="trk-col">
        <section className="card">
          <div className="card-h">
            <h2>1. Colle le script sur toutes les pages</h2>
          </div>
          <div className="card-b trk-prose">
            <p>Dans la balise &lt;head&gt;, le plus haut possible. La première ligne met en file d&apos;attente les appels faits avant le chargement du script.</p>
            <Code lang="HTML">{code}</Code>
            <div className="seg trk-guides" role="tablist" aria-label="Plateforme du site">
              {GUIDES.map((g) => (
                <button key={g.id} type="button" role="tab" aria-selected={guide === g.id} className={guide === g.id ? "on" : ""} onClick={() => setGuide(g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
            <GuideBody guide={guide} appUrl={appUrl} pk={site.public_key} />
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h2>2. Envoie les conversions</h2>
          </div>
          <div className="card-b trk-prose">
            <p>
              Les formulaires avec un champ email sont captés automatiquement{site.settings.capture_forms ? "" : " (désactivé dans les réglages de ce site)"}. Pour le reste,
              appelle l&apos;API du script sur la page concernée :
            </p>
            <Code lang="JavaScript">{`// Identifier la personne (connexion, inscription, étape du tunnel)
aos('identify', { email: 'claire@exemple.fr', name: 'Claire Dubois', phone: '0612345678' });

// Prospect, rendez-vous, achat (page de confirmation)
aos('track', 'lead');
aos('track', 'booking', { email: 'claire@exemple.fr' });
aos('track', 'purchase', { value: 189.90, currency: 'EUR', order_id: 'CMD-1042', email: 'claire@exemple.fr' });

// Évènement personnalisé
aos('track', 'devis_telecharge', { produit: 'Suspension Opale' });`}</Code>
            <p className="faint">
              order_id rend l&apos;achat idempotent : un rechargement de la page de confirmation ne le compte pas deux fois. Pour les ventes validées côté serveur
              (Stripe, CRM, paiement différé), utilise plutôt l&apos;onglet API.
            </p>
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h2>
              <ShieldCheck size={15} style={{ display: "inline", verticalAlign: -2, marginRight: 6 }} />
              Consentement cookies
            </h2>
            <span className={`badge${consent ? "" : " plain"}`} style={{ ["--c" as string]: consent ? "var(--green)" : "var(--gray)" }}>
              {consent ? "Après consentement" : "Suivi immédiat"}
            </span>
          </div>
          <div className="card-b trk-prose">
            {consent ? (
              <p>
                Ce site attend le consentement : aucun cookie n&apos;est déposé et rien n&apos;est envoyé tant que ton bandeau n&apos;a pas appelé{" "}
                <code>aos(&apos;consent&apos;, true)</code>. Les appels faits avant restent en attente, puis partent dès l&apos;accord. Un refus efface l&apos;identifiant.
              </p>
            ) : (
              <p>
                Ce site est réglé sur « suivi immédiat ». Si ton client a un bandeau cookies (obligatoire en Europe pour ce type de mesure), passe le site en « après
                consentement » dans les réglages puis branche le bandeau :
              </p>
            )}
            <div className="seg" role="tablist" aria-label="Bandeau cookies">
              {(
                [
                  ["axeptio", "Axeptio"],
                  ["cookiebot", "Cookiebot"],
                  ["gcm", "Consent Mode Google (GTM)"],
                ] as [Cmp, string][]
              ).map(([id, n]) => (
                <button key={id} type="button" role="tab" aria-selected={cmp === id} className={cmp === id ? "on" : ""} onClick={() => setCmp(id)}>
                  {n}
                </button>
              ))}
            </div>
            {cmp === "axeptio" && (
              <Code lang="JavaScript">{`<script>
window._axcb = window._axcb || [];
_axcb.push(function (sdk) {
  sdk.on('cookies:complete', function (choices) {
    // « agence_os » = nom du vendor créé dans ton projet Axeptio
    aos('consent', !!choices.agence_os);
  });
});
</script>`}</Code>
            )}
            {cmp === "cookiebot" && (
              <Code lang="JavaScript">{`<script>
window.addEventListener('CookiebotOnConsentReady', function () {
  aos('consent', !!(window.Cookiebot && Cookiebot.consent.statistics));
});
</script>`}</Code>
            )}
            {cmp === "gcm" && (
              <div className="trk-prose">
                <p>
                  Dans GTM, crée une balise HTML personnalisée contenant <code>{`<script>aos('consent', true);</script>`}</code>, déclenchée par un déclencheur
                  « Initialisation du consentement » ou un évènement personnalisé de ton bandeau, avec la vérification de consentement « analytics_storage » activée. Une
                  seconde balise avec <code>aos(&apos;consent&apos;, false)</code> sur le refus.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-h">
            <h2>
              <Shuffle size={15} style={{ display: "inline", verticalAlign: -2, marginRight: 6 }} />
              Plusieurs domaines
            </h2>
          </div>
          <div className="card-b trk-prose">
            <p>
              Le cookie est posé sur le domaine racine : <code>www.{main}</code> et <code>checkout.{main}</code> partagent déjà le même visiteur. Pour un autre domaine (site
              vitrine vers une plateforme de paiement, par exemple), installe le même script des deux côtés et déclare les deux domaines dans les réglages : les liens de
              l&apos;un vers l&apos;autre reçoivent <code>?_aos_id=…</code> pour garder la même personne.
            </p>
            <p className="faint">
              Domaines déclarés : {site.domains.length ? site.domains.join(", ") : "aucun (toutes les origines sont acceptées, sans liaison entre domaines)"}.
            </p>
          </div>
        </section>
      </div>

      <LiveTester site={site} />
    </div>
  );
}

function GuideBody({ guide, appUrl, pk }: { guide: Guide; appUrl: string; pk: string }) {
  switch (guide) {
    case "html":
      return <p className="faint">Colle les deux lignes ci-dessus dans le modèle commun à toutes tes pages, avant la fermeture de &lt;/head&gt;.</p>;
    case "wordpress":
      return (
        <>
          <ol className="rp-steps">
            <li>Installe l&apos;extension gratuite WPCode (ou « Insert Headers and Footers »).</li>
            <li>Code Snippets &gt; Header &amp; Footer : colle le script dans « Header », enregistre.</li>
            <li>Contact Form 7, Elementor, Gravity Forms, WPForms : les formulaires sont captés sans rien ajouter.</li>
          </ol>
          <p>WooCommerce : pour compter les achats, ajoute ce code (WPCode, type PHP, partout) :</p>
          <Code lang="PHP">{`add_action('woocommerce_thankyou', function ($order_id) {
  $o = wc_get_order($order_id);
  if (!$o) return;
  printf("<script>aos('track','purchase',%s);</script>", wp_json_encode([
    'value' => (float) $o->get_total(),
    'currency' => $o->get_currency(),
    'order_id' => (string) $o->get_order_number(),
    'email' => $o->get_billing_email(),
  ]));
});`}</Code>
        </>
      );
    case "shopify":
      return (
        <>
          <ol className="rp-steps">
            <li>Boutique en ligne &gt; Thèmes &gt; « … » &gt; Modifier le code &gt; <code>theme.liquid</code> : colle le script juste avant &lt;/head&gt;.</li>
            <li>Paramètres &gt; Évènements clients &gt; Ajouter un pixel personnalisé, nomme-le « Agence OS », colle le code ci-dessous, puis « Connecter ».</li>
          </ol>
          <Code lang="JavaScript (pixel Shopify)">{`analytics.subscribe('checkout_completed', async (event) => {
  const c = event.data.checkout;
  const id = (await browser.cookie.get('_aos_id')) || 'shp_' + c.token;
  fetch('${appUrl}/api/t/collect', {
    method: 'POST', keepalive: true,
    body: JSON.stringify({
      k: '${pk}', a: id, t: 'event', u: event.context.document.location.href,
      d: c.email ? { email: c.email } : undefined,
      e: { type: 'purchase', value: c.totalPrice.amount, currency: c.currencyCode, order_id: c.order ? c.order.id : c.token },
    }),
  });
});`}</Code>
          <p className="faint">Le pixel lit le cookie _aos_id posé par le script du thème : l&apos;achat est relié au parcours complet du visiteur.</p>
        </>
      );
    case "webflow":
      return (
        <ol className="rp-steps">
          <li>Site settings &gt; Custom code &gt; Head code : colle le script, enregistre puis publie.</li>
          <li>Les formulaires Webflow natifs sont captés automatiquement (champ de type Email).</li>
          <li>Webflow E-commerce : dans la page « Order confirmation », ajoute un embed avec <code>aos(&apos;track&apos;, &apos;purchase&apos;, …)</code>.</li>
        </ol>
      );
    case "gtm":
      return (
        <>
          <ol className="rp-steps">
            <li>Nouvelle balise &gt; HTML personnalisé, colle le script, déclencheur « Initialisation, toutes les pages ».</li>
            <li>Pour les achats, une seconde balise HTML personnalisé déclenchée sur l&apos;évènement « purchase » du dataLayer :</li>
          </ol>
          <Code lang="HTML (GTM)">{`<script>
  aos('track', 'purchase', {
    value: {{DLV - ecommerce.value}},
    currency: {{DLV - ecommerce.currency}},
    order_id: {{DLV - ecommerce.transaction_id}}
  });
</script>`}</Code>
          <p className="faint">Les variables « DLV » sont des variables de couche de données sur les champs GA4 standard. Laisse l&apos;option document.write désactivée.</p>
        </>
      );
  }
}

// ---------------------------------------------------------------------
// Testeur d'installation : derniers évènements reçus, rafraîchis toutes les 5 s
// ---------------------------------------------------------------------
interface LiveItem {
  key: string;
  ts: string;
  kind: "touch" | "event";
  title: string;
  detail: string;
  channel?: string;
}

const TYPE: Record<string, string> = {
  pageview: "Page vue",
  lead: "Prospect",
  purchase: "Achat",
  booking: "Rendez-vous",
  deal_won: "Deal gagné",
};

function LiveTester({ site }: { site: SiteRow }) {
  const ws = useWorkspace();
  const [items, setItems] = useState<LiveItem[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const currency = ws.workspace.currency || "EUR";

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const load = async () => {
      const sb = supabaseBrowser();
      const [ev, tp] = await Promise.all([
        sb.from("tracking_events").select("id, ts, type, name, value, currency, url, source").eq("site_id", site.id).order("ts", { ascending: false }).limit(15),
        sb.from("touchpoints").select("id, ts, channel, utm_source, utm_campaign, landing_url, referrer").eq("site_id", site.id).order("ts", { ascending: false }).limit(10),
      ]);
      if (!alive) return;
      const list: LiveItem[] = [
        ...(ev.data ?? []).map((e) => ({
          key: `e${e.id}`,
          ts: e.ts,
          kind: "event" as const,
          title: e.type === "lead" && e.name === "identify" ? "Visiteur identifié" : TYPE[e.type] ?? e.name ?? e.type,
          detail: [e.value ? fmtKpi("value", Number(e.value), e.currency || currency) : "", e.source !== "script" ? `via ${e.source}` : "", shortUrl(e.url)].filter(Boolean).join(" · "),
        })),
        ...(tp.data ?? []).map((t) => ({
          key: `t${t.id}`,
          ts: t.ts,
          kind: "touch" as const,
          title: `Arrivée : ${channelName(t.channel)}`,
          detail: [t.utm_campaign, t.utm_source, shortUrl(t.landing_url)].filter(Boolean).join(" · "),
          channel: t.channel,
        })),
      ].sort((a, b) => b.ts.localeCompare(a.ts));
      setItems(list.slice(0, 20));
      setNow(Date.now());
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [site.id, paused, currency]);

  const last = items?.[0]?.ts ?? site.last_event_at;
  const recent = last && now ? now - new Date(last).getTime() < 10 * 60_000 : false;

  return (
    <aside className="card trk-live" aria-live="polite">
      <div className="card-h">
        <h2>
          <Radio size={15} className={paused ? "faint" : "trk-pulse"} style={{ display: "inline", verticalAlign: -2, marginRight: 6 }} />
          Testeur en direct
        </h2>
        <button type="button" className="btn btn-sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? "Reprendre" : "Pause"}
        </button>
      </div>
      <div className="card-b">
        <div className={`trk-live-state ${recent ? "ok" : ""}`}>
          {recent ? <CircleCheck size={16} /> : <Radio size={16} />}
          <span>
            {recent
              ? "Le script fonctionne : des évènements arrivent."
              : "Ouvre ton site dans un autre onglet (idéalement avec ?utm_source=test) : les évènements s'affichent ici en quelques secondes."}
          </span>
        </div>
        {items === null ? (
          <p className="faint" style={{ fontSize: 12 }}>Chargement…</p>
        ) : !items.length ? (
          <p className="faint" style={{ fontSize: 12, padding: "8px 0" }}>Aucun évènement reçu pour l&apos;instant.</p>
        ) : (
          <ul className="trk-feed">
            {items.map((i) => (
              <li key={i.key}>
                <span className="t">
                  {i.kind === "touch" ? <ChannelLabel channel={i.channel ?? "direct"}>{i.title}</ChannelLabel> : <b>{i.title}</b>}
                </span>
                <span className="when">{time(i.ts, now ?? 0)}</span>
                {i.detail && <span className="d trunc">{i.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>Actualisé toutes les 5 secondes. Les robots et les navigateurs sans cookies sont ignorés.</p>
      </div>
    </aside>
  );
}

const time = (ts: string, now: number) => {
  const s = Math.round((now - new Date(ts).getTime()) / 1000);
  if (s < 60) return `il y a ${Math.max(1, s)} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
};

function shortUrl(u: string | null) {
  if (!u) return "";
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "") + x.pathname;
  } catch {
    return u.slice(0, 60);
  }
}
