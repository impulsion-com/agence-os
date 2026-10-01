"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, ExternalLink, ListChecks, MessageSquareWarning, Palette, Settings2 } from "lucide-react";

import "@/styles/portal-admin.css";
import { CompanyMark } from "@/components/crm/shared";
import { SetCrumbs } from "@/components/shell/crumbs";
import { useOpenTask } from "@/components/workspace/hooks";
import { AvatarStack } from "@/components/ui/avatar";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ago } from "@/lib/format";
import { portalPath } from "@/lib/portal-admin/features";
import type { ClientReview, PortalFeature } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";

export interface PortalOverviewData {
  portals: { company_id: string; enabled: boolean; features: PortalFeature[] }[];
  // invitations en attente, par entreprise
  invites: Record<string, number>;
  visibleTasks: Record<string, number>;
  reviewTasks: { id: string; title: string; number: number; project_id: string; company_id: string; updated_at: string }[];
  concepts: { id: string; title: string; company_id: string; review: ClientReview; feedback: string; reviewed_at: string | null; reviewed_by: string | null; updated_at: string }[];
  files: Record<string, number>;
  reports: Record<string, number>;
}

const STEPS: [string, string][] = [
  ["Active le portail d'un client", "Depuis sa fiche, onglet Portail : choisis ce qu'il voit (performance, tâches, créas, fichiers, documents) et écris ton message d'accueil."],
  ["Invite ses interlocuteurs", "Chaque personne crée son compte avec son email et n'accède qu'à son entreprise. Elle n'est pas membre de ton espace et ne voit jamais tes notes internes."],
  ["Partage au fil de l'eau", "Coche les tâches visibles, écris des commentaires partagés, envoie les créas en validation et publie les rapports. Le client est prévenu à chaque fois."],
];

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

function Steps() {
  return (
    <div className="pa-steps">
      {STEPS.map(([t, d], i) => (
        <div key={t} className="card pa-step">
          <span className="num">{i + 1}</span>
          <b>{t}</b>
          <p>{d}</p>
        </div>
      ))}
    </div>
  );
}

export function PortalOverview({ data }: { data: PortalOverviewData }) {
  const ws = useWorkspace();
  const router = useRouter();
  const openTask = useOpenTask();
  const portalOf = new Map(data.portals.map((p) => [p.company_id, p]));
  const pending = data.concepts.filter((c) => c.review === "pending");
  const changes = data.concepts.filter((c) => c.review === "changes").sort((a, b) => (b.reviewed_at ?? b.updated_at).localeCompare(a.reviewed_at ?? a.updated_at));
  const waitOf = (id: string) => data.reviewTasks.filter((t) => t.company_id === id).length + pending.filter((c) => c.company_id === id).length;
  const changesOf = (id: string) => changes.filter((c) => c.company_id === id).length;

  // Clients actuels et toute entreprise dont le portail a déjà été configuré
  const rows = ws.companies
    .filter((c) => c.status === "client" || portalOf.has(c.id))
    .map((c) => {
      const people = ws.clients.filter((u) => u.company_id === c.id);
      const seen = people.map((u) => u.last_seen_at).filter(Boolean).sort().at(-1) ?? null;
      return { c, portal: portalOf.get(c.id), people, seen, wait: waitOf(c.id), changes: changesOf(c.id), invites: data.invites[c.id] ?? 0 };
    })
    .sort((a, b) => Number(!!b.portal?.enabled) - Number(!!a.portal?.enabled) || b.changes - a.changes || b.wait - a.wait || a.c.name.localeCompare(b.c.name, "fr"));

  const active = rows.filter((r) => r.portal?.enabled);
  const waiting = [
    ...data.reviewTasks.map((t) => ({ kind: "task" as const, id: t.id, title: t.title, company_id: t.company_id, at: t.updated_at, key: `${ws.project(t.project_id)?.key ?? "?"}-${t.number}` })),
    ...pending.map((c) => ({ kind: "creative" as const, id: c.id, title: c.title, company_id: c.company_id, at: c.updated_at, key: "" })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const tabHref = (id: string) => `${ws.base}/crm/companies/${id}?tab=portal`;

  return (
    <div className="page">
      <SetCrumbs items={[{ label: "Portail client" }]} />
      <PageHeader title="Portail client" sub="Qui a accès, ce qui attend la validation de tes clients et ce qu'ils t'ont demandé." />

      {!active.length && <Steps />}

      {!rows.length ? (
        <div className="card">
          <EmptyState icon="door-open" title="Aucun client pour l'instant" text="Crée un client, puis active son portail depuis sa fiche, onglet Portail.">
            <Link href={`${ws.base}/crm/companies`} className="btn btn-primary">Voir les clients</Link>
          </EmptyState>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="stats" style={{ marginBottom: 20 }}>
              <div className="stat">
                <div className="k">Portails actifs</div>
                <div className="v">{active.length}</div>
                <div className="d">sur {rows.length} client{rows.length > 1 ? "s" : ""}</div>
              </div>
              <div className="stat">
                <div className="k">Personnes ayant accès</div>
                <div className="v">{rows.reduce((a, r) => a + r.people.length, 0)}</div>
                <div className="d">{Object.values(data.invites).reduce((a, b) => a + b, 0)} invitation(s) en attente</div>
              </div>
              <div className="stat">
                <div className="k">En attente côté client</div>
                <div className="v">{waiting.length}</div>
                <div className="d">{data.reviewTasks.length} tâche(s), {pending.length} créa(s)</div>
              </div>
              <div className="stat">
                <div className="k">Modifications demandées</div>
                <div className="v" style={changes.length ? { color: "var(--red)" } : undefined}>{changes.length}</div>
                <div className="d">{changes.length ? "À reprendre puis renvoyer" : "Rien à reprendre"}</div>
              </div>
            </div>
          )}

          <div className="card pa-tbl-wrap">
            <table className="tbl pa-tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>Client</th>
                  <th>Portail</th>
                  <th>Personnes</th>
                  <th className="pa-hide-sm">Dernière connexion</th>
                  <th className="pa-hide-sm" title="Ce que le client voit aujourd'hui sur son portail">Partagé</th>
                  <th className="r" title="Tâches en validation client visibles et créas envoyées en validation">En attente du client</th>
                  <th className="r" title="Créas sur lesquelles le client a demandé des modifications">Modifications</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, portal, people, seen, wait, changes: ch, invites }) => (
                  <tr key={c.id} className="link" onClick={() => router.push(tabHref(c.id))}>
                    <td style={{ paddingLeft: 14 }}>
                      <Link href={tabHref(c.id)} className="co" onClick={(e) => e.stopPropagation()}>
                        <CompanyMark name={c.name} color={c.color} size={22} />
                        <span className="trunc">{c.name}</span>
                      </Link>
                    </td>
                    <td>
                      {portal?.enabled ? (
                        <span className="badge" style={{ ["--c" as string]: "var(--green)" }}>Activé</span>
                      ) : portal ? (
                        <span className="badge" style={{ ["--c" as string]: "var(--gray)" }}>Désactivé</span>
                      ) : (
                        <span className="fainter" style={{ fontSize: "var(--fs-sm)" }}>Non configuré</span>
                      )}
                    </td>
                    <td>
                      {people.length || invites ? (
                        <span className="ppl">
                          {people.length > 0 && <AvatarStack profiles={people.map((u) => u.profile)} max={3} size={22} />}
                          {people.length > 0 && <span className="num">{people.length}</span>}
                          {invites > 0 && <span className="faint">{people.length ? "+ " : ""}{invites} invitée{invites > 1 ? "s" : ""}</span>}
                        </span>
                      ) : (
                        <span className="zero">Personne</span>
                      )}
                    </td>
                    <td className="pa-hide-sm muted" style={{ fontSize: "var(--fs-sm)" }}>{seen ? ago(seen) : <span className="zero">{people.length ? "Jamais" : "-"}</span>}</td>
                    <td className="pa-hide-sm muted" style={{ fontSize: "var(--fs-sm)", whiteSpace: "nowrap" }}>
                      {portal ? (
                        [plural(data.visibleTasks[c.id] ?? 0, "tâche"), plural(data.files[c.id] ?? 0, "fichier"), plural(data.reports[c.id] ?? 0, "rapport")].join(" · ")
                      ) : (
                        <span className="zero">-</span>
                      )}
                    </td>
                    <td className={`r num ${wait ? "hot" : "zero"}`}>{wait}</td>
                    <td className={`r num ${ch ? "hot" : "zero"}`} style={ch ? { color: "var(--red)" } : undefined}>{ch}</td>
                    <td className="act" onClick={(e) => e.stopPropagation()}>
                      {portal && (
                        <a className="btn btn-ghost btn-sm btn-icon" href={portalPath(ws.workspace.slug, c.id)} target="_blank" rel="noreferrer" aria-label={`Voir le portail de ${c.name} comme le client`} title="Voir comme le client">
                          <ExternalLink size={14} />
                        </a>
                      )}
                      <Link href={tabHref(c.id)} className="btn btn-sm">
                        <Settings2 size={13} /> <span className="pa-hide-sm">{portal ? "Gérer" : "Activer"}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {active.length > 0 && (
            <div className="pa-cols">
              <section className="card crm-panel" aria-label="Modifications demandées">
                <div className="card-h">
                  <h3><MessageSquareWarning size={15} className="faint" /> Modifications demandées <span className="count">{changes.length}</span></h3>
                </div>
                {changes.length ? (
                  <ul className="pa-list">
                    {changes.map((c) => {
                      const who = ws.client(c.reviewed_by);
                      return (
                        <li key={c.id}>
                          <Link href={`${ws.base}/creatives/${c.id}`} className="pa-item">
                            <span className="kind"><Palette size={13} /></span>
                            <span className="b">
                              <b className="trunc">{c.title}</b>
                              {c.feedback && <span className="q">{c.feedback}</span>}
                              <span className="m">
                                <span>{ws.company(c.company_id)?.name}</span>
                                {who && <span>· {who.profile.full_name}</span>}
                                {c.reviewed_at && <span>· {ago(c.reviewed_at)}</span>}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="crm-panel-empty">
                    <CircleCheck size={13} style={{ display: "inline", verticalAlign: "-2px", marginRight: 5, color: "var(--green)" }} />
                    Aucune demande de modification en cours.
                  </p>
                )}
              </section>

              <section className="card crm-panel" aria-label="En attente du client">
                <div className="card-h">
                  <h3><ListChecks size={15} className="faint" /> En attente du client <span className="count">{waiting.length}</span></h3>
                </div>
                {waiting.length ? (
                  <ul className="pa-list">
                    {waiting.slice(0, 12).map((w) => {
                      const body = (
                        <>
                          <span className="kind">{w.kind === "task" ? <ListChecks size={13} /> : <Palette size={13} />}</span>
                          <span className="b">
                            <b className="trunc">{w.title}</b>
                            <span className="m">
                              <span>{ws.company(w.company_id)?.name}</span>
                              <span>· {w.kind === "task" ? `Tâche ${w.key}` : "Créa"}</span>
                              <span>· {ago(w.at)}</span>
                            </span>
                          </span>
                        </>
                      );
                      return (
                        <li key={w.kind + w.id}>
                          {w.kind === "task" ? (
                            <button type="button" className="pa-item" onClick={() => openTask(w.id)}>{body}</button>
                          ) : (
                            <Link href={`${ws.base}/creatives/${w.id}`} className="pa-item">{body}</Link>
                          )}
                        </li>
                      );
                    })}
                    {waiting.length > 12 && <li className="faint" style={{ padding: "4px 8px", fontSize: "var(--fs-xs)" }}>et {waiting.length - 12} autre(s)</li>}
                  </ul>
                ) : (
                  <p className="crm-panel-empty">Rien n&apos;attend la validation d&apos;un client. Passe une tâche visible en « Validation client » ou envoie une créa en validation.</p>
                )}
              </section>
            </div>
          )}

          {active.length > 0 && (
            <details style={{ marginTop: 20 }}>
              <summary className="faint" style={{ cursor: "pointer", fontSize: "var(--fs-sm)", marginBottom: 12 }}>Comment fonctionne le portail client</summary>
              <Steps />
            </details>
          )}
        </>
      )}
    </div>
  );
}
