"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Globe, Info, Megaphone, MousePointerClick, Plug, RefreshCw, Upload } from "lucide-react";

import "@/styles/reporting.css";
import { fmtCompact, fmtKpi, kpi, platformName, type Period, type Totals } from "@/lib/ads/metrics";
import { byDay } from "@/lib/ads/series";
import type { TrackedAccount } from "@/lib/ads/types";
import { conversionGaps, fmtInt, fmtMoney, fmtSiteCompact, fmtSiteKpi, ga4Series, ga4Split, paidTotals, siteKpi } from "@/lib/analytics/calc";
import type { ClarityData, Ga4Data, SiteAnalytics } from "@/lib/analytics/types";
import { ago, fmtDate } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import { DualChart } from "./charts";
import {
  ChannelFriction,
  ChannelShare,
  ClarityHistoryNote,
  ClarityLinks,
  ClarityTrend,
  DeviceFriction,
  DeviceShare,
  FrictionCards,
  Ga4Footnote,
  InsightList,
  LandingTable,
  ProblemPages,
  SiteKpis,
  SiteTrend,
  SourceTable,
  StatCards,
  useClarity,
  useGa4,
  useInsights,
  type Stat,
} from "./site-analytics";

export type DashTab = "overview" | "ads" | "site" | "behavior";

interface Company {
  id: string;
  name: string;
}

interface Daily {
  ad_account_id: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
}

// ---------------------------------------------------------------------
// États vides par source
// ---------------------------------------------------------------------
function SourceEmpty({ kind, company }: { kind: "ga4" | "clarity"; company: Company }) {
  const ws = useWorkspace();
  const ga4 = kind === "ga4";
  const Icon = ga4 ? Globe : MousePointerClick;
  return (
    <div className="card">
      <div className="empty" style={{ padding: "48px 24px 36px" }}>
        <div className="ic">
          <Icon size={18} />
        </div>
        <h3>{ga4 ? `Google Analytics 4 n'est pas relié à ${company.name}` : `Aucun projet Clarity pour ${company.name}`}</h3>
        <p style={{ maxWidth: 460 }}>
          {ga4
            ? "Connecte Google Analytics puis associe la propriété du client : sessions, canaux d'acquisition, pages de destination et taux de conversion du site s'affichent ici, à côté de la publicité."
            : "Ajoute le projet Microsoft Clarity du client pour repérer les clics de rage, les clics morts et les pages qui posent problème."}
        </p>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Link className="btn btn-primary" href={`${ws.base}/settings/integrations#${kind}`}>
            <Plug size={14} /> {ga4 ? "Connecter GA4" : "Ajouter un projet Clarity"}
          </Link>
        </div>
        <div className="rp-guide">
          {(ga4
            ? [
                ["Connecte Google Analytics", "Dans Réglages > Connexions, autorise l'accès en lecture au compte Google qui voit la propriété du client."],
                ["Associe la propriété", "Coche la propriété GA4 du site et choisis ce client : 90 jours d'historique sont importés."],
                ["Choisis la conversion", "Garde tous les évènements clés, ou retiens celui qui compte (achat, formulaire) pour le taux de conversion."],
              ]
            : [
                ["Génère un jeton API", "Dans Clarity : Settings > Data Export > Generate new API token (réservé aux admins du projet)."],
                ["Ajoute le projet", "Dans Réglages > Connexions, colle l'identifiant du projet et le jeton, puis choisis ce client."],
                ["Laisse l'historique se construire", "Clarity ne fournit que les 3 derniers jours : les données commencent le jour de la connexion, un instantané est gardé chaque jour."],
              ]
          ).map(([t, d], i) => (
            <div className="st" key={t}>
              <span className="n">{i + 1}</span>
              <h4>{t}</h4>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoData({ text }: { text: string }) {
  return (
    <div className="card">
      <div className="empty" style={{ padding: 40 }}>
        <div className="ic">
          <RefreshCw size={18} />
        </div>
        <h3>Aucune donnée sur cette période</h3>
        <p>{text}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Site (GA4)
// ---------------------------------------------------------------------
export function SiteTab({ ga4, period, company }: { ga4: Ga4Data | null; period: Period; company: Company }) {
  if (!ga4) return <SourceEmpty kind="ga4" company={company} />;
  return <SiteContent ga4={ga4} period={period} />;
}

function SiteContent({ ga4, period }: { ga4: Ga4Data; period: Period }) {
  const { cur, prev } = useGa4(ga4, period);
  if (cur.sessions === 0 && prev.sessions === 0)
    return <NoData text={ga4.synced_at ? "Choisis une autre période, ou vérifie que la balise Google Analytics est bien en place sur le site." : "La propriété n'a pas encore été synchronisée : clique sur « Synchroniser »."} />;
  return (
    <>
      <SiteKpis ga4={ga4} period={period} />
      <div className="rp-grid top">
        <SiteTrend ga4={ga4} period={period} />
        <div className="rp-stack">
          <div className="card">
            <div className="card-h">
              <h3>Par canal</h3>
              <span className="faint" style={{ fontSize: 12 }}>Part des sessions</span>
            </div>
            <ChannelShare ga4={ga4} period={period} />
          </div>
          <div className="card">
            <div className="card-h">
              <h3>Appareils</h3>
            </div>
            <DeviceShare ga4={ga4} />
          </div>
        </div>
      </div>
      <div className="card rp-section">
        <div className="card-h">
          <h2>Sources et supports</h2>
          <span className="faint" style={{ fontSize: 12 }}>Principales sources / medium, le reste regroupé sous « (autres) »</span>
        </div>
        <SourceTable ga4={ga4} period={period} />
      </div>
      <div className="card rp-section">
        <div className="card-h">
          <h2>Pages de destination</h2>
          <span className="faint" style={{ fontSize: 12 }}>Première page vue de chaque session</span>
        </div>
        <LandingTable ga4={ga4} period={period} />
      </div>
      <Ga4Footnote ga4={ga4} />
    </>
  );
}

// ---------------------------------------------------------------------
// Comportement (Clarity)
// ---------------------------------------------------------------------
export function BehaviorTab({ clarity, period, company }: { clarity: ClarityData | null; period: Period; company: Company }) {
  if (!clarity) return <SourceEmpty kind="clarity" company={company} />;
  return <BehaviorContent clarity={clarity} period={period} />;
}

function BehaviorContent({ clarity, period }: { clarity: ClarityData; period: Period }) {
  const { cur, estimated } = useClarity(clarity, period);
  const insights = useInsights(clarity, period);
  if (cur.sessions === 0) {
    return (
      <>
        <ClarityHistoryNote clarity={clarity} period={period} />
        <NoData
          text={
            clarity.first_day
              ? `Aucun instantané Clarity sur cette période. Les données commencent le ${fmtDate(clarity.first_day, true)} : Clarity ne donne pas d'historique.`
              : "Le premier instantané sera enregistré à la prochaine synchronisation. Clarity ne donne pas d'historique : les données commencent le jour de la connexion."
          }
        />
      </>
    );
  }
  return (
    <>
      <ClarityHistoryNote clarity={clarity} period={period} />
      <FrictionCards clarity={clarity} period={period} />
      <div className="rp-grid top">
        <div className="rp-stack">
          <div className="card">
            <div className="card-h">
              <h2>À retenir</h2>
              <span className="faint" style={{ fontSize: 12 }}>Constats tirés des sessions observées</span>
            </div>
            <InsightList insights={insights} />
          </div>
          <ClarityTrend clarity={clarity} period={period} />
        </div>
        <div className="rp-stack">
          <div className="card">
            <div className="card-h">
              <h3>Par appareil</h3>
              <span className="faint" style={{ fontSize: 12 }}>Sessions observées</span>
            </div>
            <DeviceFriction clarity={clarity} />
          </div>
          <div className="card">
            <div className="card-h">
              <h3>Voir dans Clarity</h3>
            </div>
            <ClarityLinks clarity={clarity} />
          </div>
          {clarity.channels.length > 0 && (
            <div className="card">
              <div className="card-h">
                <h3>Par canal</h3>
              </div>
              <ChannelFriction clarity={clarity} />
            </div>
          )}
        </div>
      </div>
      <div className="card rp-section">
        <div className="card-h">
          <h2>Pages à problèmes</h2>
          <span className="faint" style={{ fontSize: 12 }}>Classées par part des sessions avec clics de rage ou clics morts</span>
        </div>
        <ProblemPages clarity={clarity} links />
      </div>
      <p className="fainter" style={{ fontSize: 12, marginTop: 12 }}>
        Source : Microsoft Clarity ({clarity.sources.map((s) => s.name).join(", ")}), un instantané par jour. Les taux sont la part des sessions concernées.
        {estimated > 0 ? ` ${estimated} jour${estimated > 1 ? "s" : ""} de la période ${estimated > 1 ? "sont reconstitués" : "est reconstitué"} à partir d'un agrégat de plusieurs jours (synchro manquée).` : ""}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------
// Vue d'ensemble
// ---------------------------------------------------------------------
interface OverviewProps {
  period: Period;
  company: Company;
  accounts: TrackedAccount[];
  rows: Daily[];
  cur: Totals;
  prev: Totals;
  analytics: SiteAnalytics | null;
  currency: string;
  onTab: (t: DashTab) => void;
  onCsv: () => void;
}

export function OverviewTab({ period, company, accounts, rows, cur, prev, analytics, currency, onTab, onCsv }: OverviewProps) {
  const ga4 = analytics?.ga4 ?? null;
  const clarity = analytics?.clarity ?? null;
  const fp = analytics?.first_party ?? null;
  const hasAds = accounts.length > 0;
  const site = useMemo(() => (ga4 ? ga4Split(ga4.daily, period) : null), [ga4, period]);
  const paid = useMemo(() => (ga4 ? paidTotals(ga4.channels) : null), [ga4]);
  const siteCurrency = ga4?.currency || currency;
  const hasRevenue = !!site && (site.cur.revenue > 0 || site.prev.revenue > 0);
  const sitePrev = site && site.prev.sessions > 0 ? site.prev : null;
  const platforms = [...new Set(accounts.map((a) => platformName(a.platform)))].join(", ");

  // ---------- Cartes : ce que le client veut lire en premier ----------
  const items: Stat[] = [];
  if (hasAds) items.push({ key: "spend", label: "Dépense publicitaire", help: `Montant investi sur ${platforms}`, value: fmtKpi("spend", cur.spend, currency), cur: cur.spend, prev: prev.spend, better: null });
  if (site) {
    items.push(
      { key: "sessions", label: "Sessions du site", help: "Visites mesurées par Google Analytics, toutes sources confondues", value: fmtInt(site.cur.sessions), cur: site.cur.sessions, prev: sitePrev?.sessions ?? null, better: "up" },
      {
        key: "cr",
        label: "Conversion du site",
        help: "Taux de conversion du site : évènements clés GA4 pour 100 sessions",
        value: fmtSiteKpi("conversion_rate", siteKpi(site.cur, "conversion_rate")),
        cur: siteKpi(site.cur, "conversion_rate"),
        prev: sitePrev ? siteKpi(sitePrev, "conversion_rate") : null,
        better: "up",
      },
      { key: "key", label: "Conversions (GA4)", help: "Évènements clés mesurés par Google Analytics, tous canaux", value: fmtSiteKpi("key_events", site.cur.key_events), cur: site.cur.key_events, prev: sitePrev?.key_events ?? null, better: "up" },
    );
    if (hasRevenue) items.push({ key: "rev", label: "Chiffre d'affaires (GA4)", help: "Revenu e-commerce mesuré par Google Analytics, tous canaux", value: fmtMoney(site.cur.revenue, siteCurrency), cur: site.cur.revenue, prev: sitePrev?.revenue ?? null, better: "up" });
  }
  if (hasAds && (!site || !hasRevenue))
    items.push({ key: "conv", label: "Conversions déclarées", help: "Conversions remontées par les plateformes publicitaires", value: fmtKpi("conversions", cur.conversions, currency), cur: cur.conversions, prev: prev.conversions, better: "up" });
  if (hasAds && site && cur.spend > 0) {
    if (hasRevenue) {
      const v = site.cur.revenue / cur.spend;
      const p = sitePrev && prev.spend > 0 ? sitePrev.revenue / prev.spend : null;
      items.push({ key: "mer", label: "ROAS global", help: "Chiffre d'affaires GA4 (tous canaux) divisé par la dépense publicitaire", value: fmtKpi("roas", v, currency), cur: v, prev: p, better: "up" });
    } else if (site.cur.key_events > 0) {
      const v = cur.spend / site.cur.key_events;
      const p = sitePrev && sitePrev.key_events > 0 ? prev.spend / sitePrev.key_events : null;
      items.push({ key: "cpa", label: "Coût par conversion (GA4)", help: "Dépense publicitaire divisée par les évènements clés GA4 (tous canaux)", value: fmtKpi("cpa", v, currency), cur: v, prev: p, better: "down" });
    }
  } else if (hasAds && !site) {
    items.push(
      { key: "cpa", label: "CPA", help: "Coût moyen d'une conversion déclarée", value: fmtKpi("cpa", kpi(cur, "cpa"), currency), cur: kpi(cur, "cpa"), prev: kpi(prev, "cpa"), better: "down" },
      { key: "roas", label: "ROAS", help: "Valeur de conversion déclarée divisée par la dépense", value: fmtKpi("roas", kpi(cur, "roas"), currency), cur: kpi(cur, "roas"), prev: kpi(prev, "roas"), better: "up" },
    );
  }

  // ---------- Conversions : qui mesure quoi ----------
  const gaps = conversionGaps({ platformConversions: hasAds ? cur.conversions : 0, platformValue: cur.value, ga4, ga4Totals: site?.cur ?? null, firstParty: fp });
  const fpConv = fp ? (fp.purchases > 0 ? fp.purchases : fp.leads) : 0;
  const lines = [
    hasAds ? { key: "ads", name: "Plateformes publicitaires", sub: `Déclaré par ${platforms}`, conv: cur.conversions, value: cur.value, currency, color: "var(--viz-1)", indent: false } : null,
    site ? { key: "ga4", name: "Google Analytics 4", sub: "Tous les canaux, dernier clic", conv: site.cur.key_events, value: site.cur.revenue, currency: siteCurrency, color: "var(--viz-2)", indent: false } : null,
    site && paid && hasAds ? { key: "paid", name: "dont canaux payants", sub: "Ce que GA4 attribue à la publicité", conv: paid.key_events, value: paid.revenue, currency: siteCurrency, color: "var(--viz-2)", indent: true } : null,
    fp ? { key: "fp", name: "Tracking first-party", sub: fp.purchases > 0 ? "Ventes réelles mesurées sur le site" : "Prospects mesurés sur le site", conv: fpConv, value: fp.revenue, currency, color: "var(--viz-3)", indent: false } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  const maxConv = Math.max(1, ...lines.map((l) => l.conv));
  const maxValue = Math.max(1, ...lines.map((l) => l.value));
  const anyValue = lines.some((l) => l.value > 0);

  // ---------- Graphique : la dépense et le trafic qu'elle amène ----------
  const spendByDay = useMemo(() => byDay(rows, period.start, period.end), [rows, period]);
  const sessions = useMemo(() => (ga4 ? ga4Series(ga4.daily, period, "sessions") : null), [ga4, period]);
  const convRate = useMemo(() => (ga4 ? ga4Series(ga4.daily, period, "conversion_rate") : null), [ga4, period]);
  const insights = useInsightsOrEmpty(clarity, period);

  if (!hasAds && !ga4 && !clarity) return <Sources company={company} accounts={accounts} ga4={null} clarity={null} onTab={onTab} onCsv={onCsv} wide />;

  return (
    <>
      {items.length > 0 && <StatCards items={items.slice(0, 6)} />}

      <div className="rp-grid top">
        <div className="rp-stack">
          {lines.length > 1 && (
            <div className="card">
              <div className="card-h">
                <h2>Conversions, source par source</h2>
                <span className="faint" style={{ fontSize: 12 }}>Chaque outil compte à sa façon</span>
              </div>
              <div className="rp-cmp">
                <div className="row head">
                  <span>Source</span>
                  <span className="n">Conversions</span>
                  <span className="n">{anyValue ? "Chiffre d'affaires" : ""}</span>
                </div>
                {lines.map((l) => (
                  <div className={`row${l.indent ? " sub" : ""}`} key={l.key}>
                    <span className="who">
                      {!l.indent && <span className="rp-dot" style={{ ["--c" as string]: l.color }} />}
                      <span style={{ minWidth: 0 }}>
                        <b>{l.name}</b>
                        <small className="trunc">{l.sub}</small>
                      </span>
                    </span>
                    <span className="n">
                      <b>{fmtSiteKpi("key_events", l.conv)}</b>
                      <span className="bar" aria-hidden>
                        <i style={{ ["--p" as string]: l.conv / maxConv, ["--c" as string]: l.color }} />
                      </span>
                    </span>
                    <span className="n">
                      {anyValue && (
                        <>
                          <b>{l.value > 0 ? fmtMoney(l.value, l.currency) : "–"}</b>
                          <span className="bar" aria-hidden>
                            <i style={{ ["--p" as string]: l.value / maxValue, ["--c" as string]: l.color }} />
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              {gaps.length > 0 && (
                <div className="rp-explain">
                  {gaps.map((g) => (
                    <p key={g}>
                      <Info size={14} aria-hidden />
                      <span>{g}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {(hasAds || sessions) && (
            <div className="card" style={{ minWidth: 0 }}>
              <div className="card-h">
                <h2>{hasAds && sessions ? "Dépense et trafic du site" : hasAds ? "Dépense et conversions" : "Trafic du site"}</h2>
              </div>
              {hasAds && sessions ? (
                <DualChart
                  days={spendByDay.days}
                  top={{ label: "Dépense", values: spendByDay.totals.map((t) => t.spend), format: (v) => fmtKpi("spend", v, currency), compact: (v) => fmtCompact("spend", v, currency) }}
                  bottom={{ label: "Sessions du site", values: sessions.sessions, prev: sessions.prev, format: (v) => fmtInt(v), compact: (v) => fmtSiteCompact("sessions", v) }}
                />
              ) : hasAds ? (
                <DualChart
                  days={spendByDay.days}
                  top={{ label: "Dépense", values: spendByDay.totals.map((t) => t.spend), format: (v) => fmtKpi("spend", v, currency), compact: (v) => fmtCompact("spend", v, currency) }}
                  bottom={{ label: "Conversions déclarées", values: spendByDay.totals.map((t) => t.conversions), format: (v) => fmtKpi("conversions", v, currency), compact: (v) => fmtCompact("conversions", v, currency) }}
                />
              ) : (
                <DualChart
                  days={sessions!.days}
                  top={{ label: "Sessions du site", values: sessions!.sessions, format: (v) => fmtInt(v), compact: (v) => fmtSiteCompact("sessions", v) }}
                  bottom={{ label: "Taux de conversion", values: convRate!.values, prev: convRate!.prev, format: (v) => fmtSiteKpi("conversion_rate", v), compact: (v) => fmtSiteCompact("conversion_rate", v) }}
                />
              )}
            </div>
          )}
        </div>

        <div className="rp-stack">
          <Sources company={company} accounts={accounts} ga4={ga4} clarity={clarity} onTab={onTab} onCsv={onCsv} />
          {clarity && insights.length > 0 && (
            <div className="card">
              <div className="card-h">
                <h3>À surveiller sur le site</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onTab("behavior")}>
                  Comportement <ArrowRight size={12} />
                </button>
              </div>
              <InsightList insights={insights.slice(0, 3)} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Les constats ne se calculent que si Clarity est relié (le hook reste appelé à chaque rendu)
const EMPTY_CLARITY: ClarityData = { sources: [], first_day: null, last_day: null, synced_at: null, daily: [], devices: [], pages: [], channels: [] };
const useInsightsOrEmpty = (clarity: ClarityData | null, period: Period) => useInsights(clarity ?? EMPTY_CLARITY, period, 3);

/** Les trois sources du tableau de bord, avec leur état et l'action à faire quand elles manquent. */
function Sources({ company, accounts, ga4, clarity, onTab, onCsv, wide }: { company: Company; accounts: TrackedAccount[]; ga4: Ga4Data | null; clarity: ClarityData | null; onTab: (t: DashTab) => void; onCsv: () => void; wide?: boolean }) {
  const ws = useWorkspace();
  const adSync = accounts.map((a) => a.last_synced_at).filter(Boolean).sort().at(-1);
  const rows = [
    {
      key: "ads" as const,
      icon: Megaphone,
      color: "var(--viz-1)",
      title: "Publicité",
      on: accounts.length > 0,
      text: accounts.length
        ? `${[...new Set(accounts.map((a) => platformName(a.platform)))].join(", ")} · ${adSync ? `synchro ${ago(adSync)}` : accounts.some((a) => a.external_id.startsWith("demo-")) ? "démo" : "jamais synchronisé"}`
        : "Meta Ads, Google Ads ou import CSV",
      cta: "Associer un compte",
      anchor: "",
    },
    {
      key: "site" as const,
      icon: Globe,
      color: "var(--viz-2)",
      title: "Site (GA4)",
      on: !!ga4,
      text: ga4 ? `${ga4.sources.map((s) => s.name).join(", ")} · ${ga4.synced_at ? `synchro ${ago(ga4.synced_at)}` : "jamais synchronisé"}` : "Sessions, canaux, taux de conversion du site",
      cta: "Connecter GA4",
      anchor: "#ga4",
    },
    {
      key: "behavior" as const,
      icon: MousePointerClick,
      color: "var(--viz-3)",
      title: "Comportement (Clarity)",
      on: !!clarity,
      text: clarity
        ? `${clarity.sources.map((s) => s.name).join(", ")} · ${clarity.first_day ? `depuis le ${fmtDate(clarity.first_day)}` : "premier instantané à venir"}`
        : "Clics de rage, clics morts, pages à problèmes",
      cta: "Ajouter Clarity",
      anchor: "#clarity",
    },
  ];
  return (
    <div className="card">
      <div className="card-h">
        {wide ? <h2>Relie les données de {company.name}</h2> : <h3>Sources de données</h3>}
        {wide && ws.canWrite && (
          <button className="btn btn-sm" onClick={onCsv}>
            <Upload size={12} /> Importer un CSV
          </button>
        )}
      </div>
      {wide && (
        <p className="muted" style={{ padding: "0 14px 12px", fontSize: 13 }}>
          Trois sources alimentent ce tableau de bord. Chacune est facultative : commence par celle que tu as sous la main.
        </p>
      )}
      <div className="rp-sources">
        {rows.map((r) => (
          <div className="src" key={r.key}>
            <span className={`ic${r.on ? " on" : ""}`} style={{ ["--c" as string]: r.color }}>
              <r.icon size={15} />
            </span>
            <div>
              <div className="t">{r.title}</div>
              <div className="s trunc" suppressHydrationWarning>{r.text}</div>
            </div>
            {r.on ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onTab(r.key)} aria-label={`Ouvrir l'onglet ${r.title}`}>
                Voir <ArrowRight size={12} />
              </button>
            ) : (
              <Link className="btn btn-sm" href={`${ws.base}/settings/integrations${r.anchor}`}>
                <Plug size={12} /> {r.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
