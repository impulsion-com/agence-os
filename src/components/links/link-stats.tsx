"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CopyPlus, ExternalLink, Info, Pencil, Power, QrCode } from "lucide-react";

import "@/styles/reporting.css";
import "@/styles/links.css";
import { Badge, LabelChip } from "@/components/ui/misc";
import { Avatar } from "@/components/ui/avatar";
import { Crumbs, CompanyMark } from "@/components/reporting/common";
import { ShareBars, type ShareItem } from "@/components/reporting/charts";
import { PeriodPicker } from "@/components/reporting/period-picker";
import { ago, fmtDate, money, num, pct } from "@/lib/format";
import { dayList, type Period } from "@/lib/ads/metrics";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { UTM_KEYS, UTM_LABEL, readUtm } from "@/lib/links/utm";
import type { Attribution, LinkRow, LinkStats as Stats } from "@/lib/links/load";
import { CopyButton, DEVICE_LABEL, QrModal, TrackingCallout, UrlView, countryName, isExpired, refLabel, useShort } from "./shared";

interface Props {
  period: Period;
  link: LinkRow;
  stats: Stats;
  attribution: Attribution;
  attributionTotal: Attribution;
  tracking: { sites: number; active: boolean };
}

const PALETTE = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-7)", "var(--viz-8)", "var(--viz-6)"];

function share(list: { k: string; n: number }[], label: (k: string) => string, max = 6): ShareItem[] {
  const top = list.slice(0, max);
  const rest = list.slice(max).reduce((s, x) => s + x.n, 0);
  const items = top.map((x, i) => ({ key: x.k || "_", name: label(x.k), color: PALETTE[i % PALETTE.length], value: x.n, display: num(x.n) }));
  if (rest > 0) items.push({ key: "_rest", name: "Autres", color: "var(--viz-prev)", value: rest, display: num(rest) });
  return items;
}

export function LinkStatsView({ period, link, stats, attribution, attributionTotal, tracking }: Props) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const short = useShort();
  const [qr, setQr] = useState(false);
  const u = readUtm(link.utm);
  const c = ws.company(link.company_id);
  const creator = ws.member(link.created_by);
  const currency = ws.workspace.currency || "EUR";
  const expired = isExpired(link.expires_at);
  const shortLink = link.code ? short.url(link.code) : "";

  const days = useMemo(() => dayList(period.start, period.end), [period.start, period.end]);
  const byDay = useMemo(() => new Map(stats.days.map((d) => [d.d, d])), [stats.days]);
  const humans = days.map((d) => byDay.get(d)?.h ?? 0);
  const bots = days.map((d) => byDay.get(d)?.b ?? 0);
  const delta = stats.prev_humans ? (stats.humans - stats.prev_humans) / stats.prev_humans : null;
  const hours = Array.from({ length: 24 }, (_, h) => stats.hours.find((x) => x.k === h)?.n ?? 0);
  const maxHour = Math.max(1, ...hours);

  const toggleActive = () =>
    mutate(async (sb) => must(await sb.from("links").update({ active: !link.active }).eq("id", link.id)), { success: link.active ? "Lien désactivé" : "Lien réactivé" });

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <Crumbs items={[{ label: "Liens trackés", href: `${ws.base}/links` }, { label: link.name || "Lien" }]} />

      <div className="lnk-head">
        <div style={{ minWidth: 0 }}>
          <h1>
            <span>{link.name || link.destination.replace(/^https?:\/\//, "")}</span>
            {!link.active ? <Badge color="var(--gray)">Désactivé</Badge> : expired ? <Badge color="var(--amber)">Expiré</Badge> : link.code ? <Badge color="var(--green)">Actif</Badge> : <Badge color="var(--blue)">UTM seul</Badge>}
          </h1>
          <div className="meta">
            {link.code && <span className="mono" style={{ color: "var(--text)" }}>{short.display(link.code)}</span>}
            {c && (
              <span className="lnk-row" style={{ gap: 6 }}>
                <CompanyMark name={c.name} color={c.color} size={16} /> {c.name}
              </span>
            )}
            <a href={link.destination} target="_blank" rel="noreferrer" className="lnk-row" style={{ gap: 4 }}>
              {link.destination.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)} <ExternalLink size={12} />
            </a>
            <span className="lnk-row" style={{ gap: 6 }}>
              {creator && <Avatar profile={creator.profile} size={16} />} Créé le {fmtDate(link.created_at.slice(0, 10), true)}
            </span>
            {link.expires_at && <span>Expire le {fmtDate(link.expires_at.slice(0, 10), true)}</span>}
            {link.tags.map((t) => (
              <LabelChip key={t} name={t} color="slate" />
            ))}
          </div>
        </div>
        <div className="actions">
          <CopyButton text={shortLink || link.final_url} label={link.code ? "Copier le lien court" : "Copier l'URL"} primary />
          <button className="btn" onClick={() => setQr(true)}>
            <QrCode size={14} /> QR code
          </button>
          {ws.canWrite && (
            <>
              <Link href={`${ws.base}/links/${link.id}/edit`} className="btn">
                <Pencil size={14} /> Modifier
              </Link>
              <Link href={`${ws.base}/links/new?from=${link.id}`} className="btn btn-icon" aria-label="Dupliquer" title="Dupliquer">
                <CopyPlus size={14} />
              </Link>
              <button className="btn btn-icon" onClick={toggleActive} aria-label={link.active ? "Désactiver" : "Réactiver"} title={link.active ? "Désactiver" : "Réactiver"}>
                <Power size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {!link.code ? (
        <div className="lnk-notice info" style={{ marginBottom: 16 }}>
          <Info size={14} />
          <div>
            <p>
              <b>Lien UTM seul :</b> il n&apos;a pas de lien court, ses clics ne passent pas par Agence OS et ne sont donc pas comptés ici.
            </p>
            <p>
              Ses visites restent mesurées par leurs UTM dans ton outil d&apos;analyse et dans{" "}
              <Link href={`${ws.base}/tracking`} style={{ textDecoration: "underline" }}>Attribution</Link> si le script est installé.
              {ws.canWrite && " Pour compter les clics, ajoute un lien court depuis « Modifier »."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="lnk-row" style={{ marginBottom: 14, justifyContent: "space-between" }}>
            <PeriodPicker period={period} />
            <span className="faint" style={{ fontSize: 12 }}>
              {num(link.clicks)} clics humains depuis la création{link.last_click_at ? `, dernier ${ago(link.last_click_at)}` : ""}
            </span>
          </div>

          <div className="lnk-kpis">
            <div className="kp">
              <div className="k">Clics humains</div>
              <div className="v">{num(stats.humans)}</div>
              <div className="d">
                {delta !== null ? (
                  <span className={`rp-delta ${delta >= 0 ? "good" : "bad"}`}>
                    {delta >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                    {pct(Math.abs(delta) * 100, 0)}
                  </span>
                ) : (
                  <span>–</span>
                )}
                <span>vs {num(stats.prev_humans ?? 0)} avant</span>
              </div>
            </div>
            <div className="kp">
              <div className="k">Moyenne par jour</div>
              <div className="v">{num(stats.humans / Math.max(1, period.days), stats.humans / period.days < 10 ? 1 : 0)}</div>
              <div className="d">sur {period.days} jours</div>
            </div>
            <div className="kp">
              <div className="k">Robots filtrés</div>
              <div className="v">{num(stats.bots)}</div>
              <div className="d">{stats.humans + stats.bots > 0 ? `${pct((stats.bots / (stats.humans + stats.bots)) * 100, 1)} des requêtes` : "aperçus de liens, indexeurs"}</div>
            </div>
            <div className="kp">
              <div className="k">Mobile</div>
              <div className="v">{stats.humans ? pct(((stats.devices.find((d) => d.k === "mobile")?.n ?? 0) / stats.humans) * 100, 0) : "–"}</div>
              <div className="d">des clics humains</div>
            </div>
          </div>

          {tracking.active ? (
            <div className="lnk-kpis" style={{ marginTop: 12 }}>
              <div className="kp">
                <div className="k">Visiteurs identifiés</div>
                <div className="v">{num(attribution.visitors)}</div>
                <div className="d">{num(attributionTotal.visitors)} depuis la création</div>
              </div>
              <div className="kp">
                <div className="k">Prospects</div>
                <div className="v">{num(attribution.leads)}</div>
                <div className="d">{attribution.visitors ? `${pct((attribution.leads / attribution.visitors) * 100, 1)} des visiteurs` : `${num(attributionTotal.leads)} au total`}</div>
              </div>
              <div className="kp">
                <div className="k">Ventes</div>
                <div className="v">{num(attribution.sales)}</div>
                <div className="d">{num(attributionTotal.sales)} depuis la création</div>
              </div>
              <div className="kp">
                <div className="k">Chiffre d&apos;affaires</div>
                <div className="v">{money(attribution.revenue, currency)}</div>
                <div className="d">{money(attributionTotal.revenue, currency)} depuis la création</div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <TrackingCallout sites={tracking.sites} />
            </div>
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-h">
              <h2>Clics par jour</h2>
              <div className="rp-legend">
                <span style={{ ["--c" as string]: "var(--viz-1)" }}>
                  <i className="sw" /> Humains
                </span>
                <span style={{ ["--c" as string]: "var(--viz-prev)" }}>
                  <i className="sw" /> Robots
                </span>
              </div>
            </div>
            <ClickChart days={days} humans={humans} bots={bots} />
          </div>

          <div className="lnk-grid">
            <div className="card">
              <div className="card-h"><h2>Référents</h2></div>
              <ShareBars items={share(stats.referrers, refLabel)} />
            </div>
            <div className="card">
              <div className="card-h"><h2>Appareils</h2></div>
              <ShareBars items={share(stats.devices, (k) => DEVICE_LABEL[k] ?? k)} />
            </div>
            <div className="card">
              <div className="card-h"><h2>Pays</h2></div>
              <ShareBars items={share(stats.countries, countryName)} />
            </div>
            <div className="card">
              <div className="card-h"><h2>Navigateurs</h2></div>
              <ShareBars items={share(stats.browsers, (k) => k || "Inconnu")} />
            </div>
            <div className="card">
              <div className="card-h"><h2>Systèmes</h2></div>
              <ShareBars items={share(stats.os, (k) => k || "Inconnu")} />
            </div>
            <div className="card">
              <div className="card-h">
                <h2>Heures de la journée</h2>
                <span className="faint" style={{ fontSize: 12 }}>heure de Paris</span>
              </div>
              <div className="lnk-hours" role="img" aria-label={`Répartition des clics par heure. Pic à ${hours.indexOf(maxHour)} h.`}>
                {hours.map((n, h) => (
                  <i key={h} style={{ height: `${(n / maxHour) * 100}%`, opacity: n ? 1 : 0.25 }} title={`${h} h : ${num(n)} clic${n > 1 ? "s" : ""}`} />
                ))}
              </div>
              <div className="lnk-hours-axis" aria-hidden>
                {hours.map((_, h) => (
                  <span key={h}>{h % 3 === 0 ? h : ""}</span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <h2>Détails du lien</h2>
          <CopyButton text={link.final_url} small label="Copier l'URL complète" />
        </div>
        <div className="lnk-dest">
          <div className="r">
            <span>URL finale</span>
            <UrlView url={link.final_url} />
          </div>
          {UTM_KEYS.filter((k) => u[k]).map((k) => (
            <div className="r" key={k}>
              <span>{UTM_LABEL[k]}</span>
              <span className="mono">{u[k]}</span>
            </div>
          ))}
          {u.extra.map((p) => (
            <div className="r" key={p.k}>
              <span className="mono">{p.k}</span>
              <span className="mono">{p.v}</span>
            </div>
          ))}
          {link.code && (
            <div className="r">
              <span>Jeton de clic</span>
              <span className="faint">
                Chaque clic ajoute <span className="mono">aos_lid</span> à l&apos;URL : le script de tracking s&apos;en sert pour relier le clic au visiteur.
              </span>
            </div>
          )}
        </div>
      </div>

      {qr && <QrModal text={shortLink || link.final_url} name={link.name || link.code || "lien"} onClose={() => setQr(false)} />}
      {/* rafraîchit les chiffres en revenant sur l'onglet */}
      <RefreshOnFocus onFocus={() => router.refresh()} />
    </div>
  );
}

function RefreshOnFocus({ onFocus }: { onFocus: () => void }) {
  const cb = useRef(onFocus);
  useEffect(() => {
    cb.current = onFocus;
  });
  useEffect(() => {
    const h = () => document.visibilityState === "visible" && cb.current();
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  return null;
}

// ---------------------------------------------------------------------
// Clics par jour : barres empilées (humains, robots)
// ---------------------------------------------------------------------
/** Échelle à pas entiers : 0, pas, 2 pas… jusqu'au sommet. */
function niceScale(max: number) {
  const raw = Math.max(1, max) / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

function ClickChart({ days, humans, bots }: { days: string[]; humans: number[]; bots: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = Math.max(280, width);
  const L = 36;
  const R = 8;
  const T = 10;
  const H = 200;
  const B = 24;
  const ph = H - T - B;
  const n = Math.max(1, days.length);
  const band = (W - L - R) / n;
  const bw = Math.max(1, Math.min(22, band - 2));
  const { top, ticks } = niceScale(Math.max(0, ...humans.map((h, i) => h + bots[i])));
  const y = (v: number) => T + ph - (v / top) * ph;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L) / 70))));
  const x = (i: number) => L + band * i + band / 2;
  const tipLeft = hover === null ? 0 : Math.min(Math.max(0, (x(hover) / W) * width + 12), Math.max(0, width - 170));

  return (
    <div className={`rp-chart lnk-chart${hover !== null ? " hovering" : ""}`} ref={ref}>
      {width > 0 && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          height={H}
          role="img"
          tabIndex={0}
          aria-label="Clics par jour. Utilise les flèches pour parcourir les jours."
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((((e.clientX - r.left) / r.width) * W - L) / band);
            setHover(i >= 0 && i < n ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
          }}
        >
          <g className="grid">
            {ticks.slice(1).map((t) => (
              <line key={t} x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            ))}
          </g>
          {ticks.map((t) => (
            <text key={t} x={L - 8} y={y(t) + 3.5} textAnchor="end">
              {num(t)}
            </text>
          ))}
          {days.map((d, i) => {
            const h = humans[i];
            const b = bots[i];
            const x0 = x(i) - bw / 2;
            const r = Math.min(3, bw / 2);
            return (
              <g key={d}>
                {h > 0 && <rect className={`bar${hover === i ? " on" : ""}`} x={x0} y={y(h)} width={bw} height={T + ph - y(h)} rx={b > 0 ? 0 : r} />}
                {b > 0 && <rect className={`bar bot${hover === i ? " on" : ""}`} x={x0} y={y(h + b)} width={bw} height={y(h) - y(h + b)} rx={Math.min(r, (y(h) - y(h + b)) / 2)} />}
              </g>
            );
          })}
          <line className="base" x1={L} x2={W - R} y1={T + ph} y2={T + ph} />
          {days.map((d, i) =>
            (n - 1 - i) % every === 0 ? (
              <text key={d} x={x(i) > W - R - 24 ? W - R : x(i)} y={H - 6} textAnchor={x(i) > W - R - 24 ? "end" : "middle"}>
                {fmtDate(d)}
              </text>
            ) : null,
          )}
          <rect className="hit" x={L} y={0} width={W - L - R} height={H} />
        </svg>
      )}
      {hover !== null && (
        <div className="rp-tip" style={{ left: tipLeft, top: 10 }} role="status">
          <div className="h">{fmtDate(days[hover], true)}</div>
          <div className="r" style={{ ["--c" as string]: "var(--viz-1)" }}>
            <i className="k" /> <span>Humains</span> <b className="n">{num(humans[hover])}</b>
          </div>
          <div className="r" style={{ ["--c" as string]: "var(--viz-prev)" }}>
            <i className="k" /> <span>Robots</span> <b className="n">{num(bots[hover])}</b>
          </div>
        </div>
      )}
    </div>
  );
}
