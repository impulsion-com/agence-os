"use client";

import Link from "next/link";
import {
  ArrowRight, CalendarClock, CalendarPlus, ChartColumn, CircleCheck, ClipboardList, FileSignature, FileText, ListChecks, MessageSquare,
  Palette, Paperclip, PartyPopper, Video,
} from "lucide-react";

import "@/styles/reporting.css";
import { Delta } from "@/components/reporting/kpi";
import { Progress } from "@/components/ui/misc";
import { fmtKpi, kpi, rangeLabel, type Kpi } from "@/lib/ads/metrics";
import { FORMAT } from "@/lib/creatives/constants";
import { ago, fmtDate } from "@/lib/format";
import type { PortalHome, PortalNews } from "@/lib/portal/types";
import { usePortal } from "./context";
import { Due, LocalTime } from "./bits";

/** Accueil du portail : message de l'agence, ce qui attend le client, nouveautés et raccourcis. */
export function HomeView({ data }: { data: PortalHome }) {
  const { ctx, href, file, has, preview } = usePortal();
  // En aperçu, le prénom affiché serait celui du membre de l'agence, pas celui du client
  const first = preview ? "" : (ctx.user.name || "").trim().split(/\s+/)[0];
  const tasks = data.review_tasks ?? [];
  const creas = data.review_creatives ?? [];
  const props = data.review_proposals ?? [];
  const forms = data.onboarding ?? [];
  const todo = tasks.length + creas.length + props.length;
  const side = has("reporting") || has("booking") || forms.length > 0;

  const main = (
    <div className="ptl-col">
      <div className="ptl-sec">
        <h2>
          À valider
          {todo > 0 && <span className="count hot">{todo}</span>}
        </h2>
      </div>
      {todo === 0 ? (
        <div className="ptl-rows">
          <div className="ptl-empty">
            <div className="ic">
              <PartyPopper size={18} />
            </div>
            <b>Vous êtes à jour</b>
            Rien n&apos;attend votre validation pour le moment.
          </div>
        </div>
      ) : (
        <div className="ptl-rows">
          {tasks.map((t) => (
            <Link key={t.id} href={href(`tasks?task=${t.id}`)} className="ptl-row">
              <span className="ic" style={{ ["--c" as string]: "var(--st-review)" }}>
                <ListChecks size={17} />
              </span>
              <span className="tx">
                <span className="t">{t.title}</span>
                <span className="s">
                  <span>Tâche à valider</span>
                  {t.project && <span>{t.project}</span>}
                  <Due date={t.due_date} />
                </span>
              </span>
              <span className="end">
                <span className="cta">Voir</span>
                <ArrowRight size={15} />
              </span>
            </Link>
          ))}
          {creas.map((c) => (
            <Link key={c.id} href={href(`creatives?c=${c.id}`)} className="ptl-row">
              <span className="ic">
                {c.cover?.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file("asset", c.cover.id)} alt="" loading="lazy" />
                ) : c.cover ? (
                  <Video size={17} />
                ) : (
                  <Palette size={17} />
                )}
              </span>
              <span className="tx">
                <span className="t">{c.title}</span>
                <span className="s">
                  <span>Créa à valider</span>
                  <span>{FORMAT[c.format as keyof typeof FORMAT]?.name ?? "Créa"}</span>
                </span>
              </span>
              <span className="end">
                <span className="cta">Voir</span>
                <ArrowRight size={15} />
              </span>
            </Link>
          ))}
          {props.map((p) => (
            <a key={p.id} href={`/p/${p.token}`} target="_blank" rel="noopener" className="ptl-row">
              <span className="ic" style={{ ["--c" as string]: "var(--amber)" }}>
                <FileSignature size={17} />
              </span>
              <span className="tx">
                <span className="t">{p.title}</span>
                <span className="s">
                  <span>Proposition à signer</span>
                  {p.valid_until && <span>valable jusqu&apos;au {fmtDate(p.valid_until, true)}</span>}
                </span>
              </span>
              <span className="end">
                <span className="cta">Ouvrir</span>
                <ArrowRight size={15} />
              </span>
            </a>
          ))}
        </div>
      )}

      <div className="ptl-sec">
        <h2>Dernières nouveautés</h2>
      </div>
      <div className="ptl-rows">
        {data.news.length === 0 ? (
          <div className="ptl-empty">Les nouveautés partagées par {ctx.workspace.name} apparaîtront ici.</div>
        ) : (
          data.news.map((n, i) => <News key={`${n.kind}-${n.id}-${i}`} n={n} />)
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="ptl-ph">
        <div>
          <h1>Bonjour{first ? ` ${first}` : ""}</h1>
          <p>
            Votre espace {data.company.name} avec {ctx.workspace.name}.
          </p>
        </div>
      </div>

      {data.welcome.trim() && (
        <div className="ptl-welcome">
          <span className="ptl-mark" aria-hidden>{ctx.workspace.name.slice(0, 1).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div className="who">Un mot de {ctx.workspace.name}</div>
            <p>{data.welcome.trim()}</p>
          </div>
        </div>
      )}

      {side ? (
        <div className="ptl-grid2">
          {main}
          <div className="ptl-col">
            {data.performance && <PerfCard perf={data.performance} report={data.last_report ?? null} />}
            {data.booking && (data.booking.next || data.booking.slug) && <BookingCard booking={data.booking} />}
            {forms.map((f) => (
              <div className="ptl-card" key={f.id}>
                <h3>
                  <ClipboardList size={15} /> Formulaire d&apos;accueil à terminer
                </h3>
                <div className="ptl-kv">
                  <div style={{ minWidth: 0 }}>
                    <div className="big trunc">{f.title}</div>
                    <div className="ptl-prog" style={{ marginTop: 8 }}>
                      <Progress value={f.progress} />
                      <span className="n">{f.progress} %</span>
                    </div>
                  </div>
                  <a className="btn btn-primary" href={`/f/${f.token}`} target="_blank" rel="noopener">
                    {f.progress > 0 ? "Reprendre" : "Commencer"}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        main
      )}
    </>
  );
}

function News({ n }: { n: PortalNews }) {
  const { href } = usePortal();
  const map = {
    report: { icon: <FileText size={17} />, c: "var(--blue)", label: "Nouveau rapport", to: `performance?report=${n.id}` },
    task_done: { icon: <CircleCheck size={17} />, c: "var(--st-done)", label: "Tâche terminée", to: `tasks?task=${n.id}` },
    comment: { icon: <MessageSquare size={17} />, c: "var(--violet)", label: "Nouveau message", to: `tasks?task=${n.id}` },
    file: { icon: <Paperclip size={17} />, c: "var(--teal)", label: "Nouveau fichier", to: "files" },
    creative: { icon: <Palette size={17} />, c: "var(--rose)", label: "Créa à valider", to: `creatives?c=${n.id}` },
  }[n.kind];
  return (
    <Link href={href(map.to)} className="ptl-row">
      <span className="ic" style={{ ["--c" as string]: map.c }}>
        {map.icon}
      </span>
      <span className="tx">
        <span className="t">{n.title}</span>
        {n.kind === "comment" ? (
          <span className="s clamp">
            {n.by} : {n.excerpt}
          </span>
        ) : (
          <span className="s">
            <span>{map.label}</span>
          </span>
        )}
      </span>
      <span className="end">
        <span style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }} suppressHydrationWarning>
          {ago(n.at)}
        </span>
      </span>
    </Link>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 300;
  const H = 44;
  const max = Math.max(...values, 0.0001);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 3 - (v / max) * (H - 8)).toFixed(1)}`);
  return (
    <div className="ptl-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Évolution quotidienne de la dépense publicitaire">
        <path className="a" d={`M0,${H}L${pts.join("L")}L${W},${H}Z`} />
        <path className="l" d={`M${pts.join("L")}`} />
      </svg>
    </div>
  );
}

function PerfCard({ perf, report }: { perf: NonNullable<PortalHome["performance"]>; report: PortalHome["last_report"] | null }) {
  const { href, currency } = usePortal();
  const num = (t: typeof perf.cur) => ({
    spend: Number(t.spend), impressions: Number(t.impressions), clicks: Number(t.clicks), conversions: Number(t.conversions), value: Number(t.value),
  });
  const cur = num(perf.cur);
  const prev = num(perf.prev);
  const third: Kpi = cur.value > 0 ? "roas" : "cpa";
  const figs: Kpi[] = ["spend", "conversions", third];
  const empty = !perf.accounts || (cur.spend === 0 && cur.impressions === 0);
  return (
    <>
      <div className="ptl-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <h3>
            <ChartColumn size={15} /> Performance, 30 derniers jours
          </h3>
          <Link href={href("performance")} className="ptl-more">
            Détail <ArrowRight size={13} />
          </Link>
        </div>
        {empty ? (
          <p className="faint" style={{ marginTop: 12, fontSize: "var(--fs-sm)" }}>
            Aucune donnée publicitaire sur cette période pour le moment.
          </p>
        ) : (
          <>
            <div className="ptl-figs">
              {figs.map((k) => (
                <div className="ptl-fig" key={k}>
                  <div className="k">{{ spend: "Dépense", conversions: "Conversions", roas: "ROAS", cpa: "CPA" }[k as "spend" | "conversions" | "roas" | "cpa"]}</div>
                  <div className="v num">{fmtKpi(k, kpi(cur, k), currency)}</div>
                  <div className="d">
                    <Delta metric={k} cur={kpi(cur, k)} prev={kpi(prev, k)} title="Par rapport aux 30 jours précédents" />
                  </div>
                </div>
              ))}
            </div>
            <Spark values={perf.series.map((s) => Number(s.spend))} />
          </>
        )}
      </div>
      {report && (
        <Link href={href(`performance?report=${report.id}`)} className="ptl-card" style={{ display: "block", marginTop: 14 }}>
          <h3>
            <FileText size={15} /> Dernier rapport
          </h3>
          <div className="ptl-kv">
            <div style={{ minWidth: 0 }}>
              <div className="big trunc">{report.title}</div>
              <div className="sub">{rangeLabel(report.period_start, report.period_end)}</div>
            </div>
            <span className="ptl-more">
              Lire <ArrowRight size={13} />
            </span>
          </div>
        </Link>
      )}
    </>
  );
}

function BookingCard({ booking }: { booking: NonNullable<PortalHome["booking"]> }) {
  const next = booking.next;
  return (
    <div className="ptl-card">
      <h3>
        <CalendarClock size={15} /> {next ? "Prochain rendez-vous" : "Rendez-vous"}
      </h3>
      {next ? (
        <div className="ptl-kv">
          <div style={{ minWidth: 0 }}>
            <div className="big trunc">{next.title || "Rendez-vous"}</div>
            <div className="sub">
              <LocalTime iso={next.start_at} mode="day" /> à <LocalTime iso={next.start_at} mode="time" />
            </div>
          </div>
          {next.meet_url ? (
            <a className="btn btn-primary" href={next.meet_url} target="_blank" rel="noopener noreferrer">
              <Video size={14} /> Rejoindre
            </a>
          ) : next.manage_token ? (
            <a className="btn" href={`/b/r/${next.manage_token}`} target="_blank" rel="noopener">
              Gérer
            </a>
          ) : null}
        </div>
      ) : (
        <div className="ptl-kv">
          <div className="sub" style={{ marginTop: 0 }}>
            {booking.host ? `Réservez un créneau avec ${booking.host}.` : "Réservez un créneau avec votre agence."}
          </div>
          <a className="btn btn-primary" href={`/b/${booking.slug}`} target="_blank" rel="noopener">
            <CalendarPlus size={14} /> Prendre rendez-vous
          </a>
        </div>
      )}
    </div>
  );
}
