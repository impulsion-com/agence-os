"use client";

import "@/styles/proposals.css";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSignature, Plus, Search, Settings2 } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { useUI } from "@/components/shell/ui-context";
import { colorOf } from "@/lib/constants";
import { ago, fmtDate, money } from "@/lib/format";
import type { Proposal, ProposalStatus } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace/context";
import { PROPOSAL_STATUS, computeTotals, effectiveStatus, type PriceLine } from "./lib";

export type ProposalRow = Pick<
  Proposal,
  | "id" | "number" | "title" | "status" | "company_id" | "contact_id" | "deal_id" | "owner_id" | "currency"
  | "discount_pct" | "tax_pct" | "valid_until" | "sent_at" | "viewed_at" | "accepted_at" | "created_at" | "updated_at"
> & { items: PriceLine[] };

type Filter = "all" | "open" | ProposalStatus;
const FILTERS: { id: Filter; name: string }[] = [
  { id: "all", name: "Toutes" },
  { id: "draft", name: "Brouillons" },
  { id: "open", name: "En attente" },
  { id: "accepted", name: "Acceptées" },
  { id: "declined", name: "Refusées" },
  { id: "expired", name: "Expirées" },
];

/** Date la plus parlante selon le statut */
function lastEvent(p: ProposalRow, st: ProposalStatus): { label: string; at: string } {
  if (st === "accepted" && p.accepted_at) return { label: "Acceptée", at: p.accepted_at };
  if (st === "viewed" && p.viewed_at) return { label: "Vue", at: p.viewed_at };
  if ((st === "sent" || st === "expired" || st === "declined") && p.sent_at) return { label: "Envoyée", at: p.sent_at };
  return { label: "Modifiée", at: p.updated_at };
}

export function ProposalsList({ rows }: { rows: ProposalRow[] }) {
  const ws = useWorkspace();
  const ui = useUI();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const enriched = useMemo(
    () =>
      rows.map((p) => {
        const st = effectiveStatus(p);
        const t = computeTotals(p.items, p.discount_pct, p.tax_pct);
        return { p, st, monthly: t.monthly.net, oneOff: t.one_off.net, company: ws.company(p.company_id) };
      }),
    [rows, ws],
  );

  const stats = useMemo(() => {
    const now = new Date();
    const m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const sentMonth = enriched.filter((r) => r.p.sent_at && new Date(r.p.sent_at).getTime() >= m0).length;
    const sentEver = enriched.filter((r) => r.st !== "draft");
    const accepted = enriched.filter((r) => r.st === "accepted");
    const decided = enriched.filter((r) => ["accepted", "declined", "expired"].includes(r.st));
    const pending = enriched.filter((r) => r.st === "sent" || r.st === "viewed");
    const cur = ws.workspace.currency || "EUR";
    return {
      sentMonth,
      rate: decided.length ? Math.round((accepted.length / decided.length) * 100) : null,
      accepted: accepted.length,
      decided: decided.length,
      sentEver: sentEver.length,
      mrr: accepted.reduce((s, r) => s + r.monthly, 0),
      pending: pending.length,
      pendingValue: pending.reduce((s, r) => s + r.monthly, 0),
      cur,
    };
  }, [enriched, ws.workspace.currency]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: enriched.length, open: 0 };
    for (const r of enriched) {
      c[r.st] = (c[r.st] ?? 0) + 1;
      if (r.st === "sent" || r.st === "viewed") c.open++;
    }
    return c;
  }, [enriched]);

  const shown = enriched.filter((r) => {
    if (filter === "open" ? !(r.st === "sent" || r.st === "viewed") : filter !== "all" && r.st !== filter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return r.p.title.toLowerCase().includes(s) || (r.company?.name ?? "").toLowerCase().includes(s) || String(r.p.number) === s.replace("#", "");
  });

  const newProposal = () => ui.create({ kind: "proposal" });

  return (
    <div className="page">
      <PageHeader
        title="Propositions"
        sub={rows.length ? `${counts.open} en attente de réponse · ${counts.draft ?? 0} brouillon${(counts.draft ?? 0) > 1 ? "s" : ""}` : "Rédige, envoie et fais signer tes propositions commerciales"}
      >
        <Link href={`${ws.base}/settings/services`} className="btn">
          <Settings2 size={14} />
          Catalogue
        </Link>
        {ws.canWrite && (
          <button className="btn btn-primary" onClick={newProposal}>
            <Plus size={14} />
            Nouvelle proposition
          </button>
        )}
      </PageHeader>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState icon="file-signature" title="Aucune proposition pour l'instant" text="Pars d'un modèle (Meta Ads, Google Ads, creative strategy) : le texte et les lignes de prix sont pré-remplis, tu n'as plus qu'à personnaliser.">
            {ws.canWrite && (
              <button className="btn btn-primary" onClick={newProposal}>
                <Plus size={14} />
                Créer ma première proposition
              </button>
            )}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="stats pl-stats">
            <div className="stat">
              <div className="k">Envoyées ce mois</div>
              <div className="v">{stats.sentMonth}</div>
              <div className="d">{stats.sentEver} envoyée{stats.sentEver > 1 ? "s" : ""} au total</div>
            </div>
            <div className="stat">
              <div className="k">Taux d&apos;acceptation</div>
              <div className="v">{stats.rate === null ? "–" : `${stats.rate} %`}</div>
              <div className="d">{stats.decided ? `${stats.accepted} sur ${stats.decided} décidée${stats.decided > 1 ? "s" : ""}` : "Aucune réponse encore"}</div>
            </div>
            <div className="stat">
              <div className="k">Mensuel accepté</div>
              <div className="v">{money(stats.mrr, stats.cur)}</div>
              <div className="d">HT par mois, après remise</div>
            </div>
            <div className="stat">
              <div className="k">En attente de réponse</div>
              <div className="v">{stats.pending}</div>
              <div className="d">{stats.pending ? `${money(stats.pendingValue, stats.cur)} HT / mois en jeu` : "Rien en attente"}</div>
            </div>
          </div>

          <div className="pl-toolbar">
            <div className="seg pl-seg" role="tablist" aria-label="Filtrer par statut">
              {FILTERS.map((f) => (
                <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
                  {f.name}
                  {!!counts[f.id] && <span className="faint num">{counts[f.id]}</span>}
                </button>
              ))}
            </div>
            <label className="pl-search">
              <Search size={14} aria-hidden />
              <input placeholder="Rechercher un titre, un client, #12…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
            </label>
          </div>

          <div className="card pl-card">
            {shown.length === 0 ? (
              <EmptyState icon="search" title="Aucune proposition ne correspond" text="Change de filtre ou de recherche." />
            ) : (
              <div className="pl-scroll">
                <table className="tbl pl-tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 52 }}>N°</th>
                      <th>Proposition</th>
                      <th>Statut</th>
                      <th className="r">Mensuel HT</th>
                      <th className="r">Ponctuel HT</th>
                      <th>Dernier événement</th>
                      <th style={{ width: 44 }}>
                        <span className="sr">Responsable</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(({ p, st, monthly, oneOff, company }) => {
                      const ev = lastEvent(p, st);
                      const owner = ws.member(p.owner_id);
                      const href = `${ws.base}/proposals/${p.id}`;
                      return (
                        <tr key={p.id} className="pl-row" onClick={() => router.push(href)}>
                          <td className="mono faint">#{p.number}</td>
                          <td>
                            <Link href={href} className="pl-title" onClick={(e) => e.stopPropagation()}>
                              <span className="trunc">{p.title}</span>
                            </Link>
                            <span className="pl-client faint trunc">
                              {company ? (
                                <>
                                  <span className="pl-dot" style={{ ["--c" as string]: colorOf(company.color) }} />
                                  {company.name}
                                </>
                              ) : (
                                "Sans client"
                              )}
                            </span>
                          </td>
                          <td>
                            <Badge color={PROPOSAL_STATUS[st].color}>{PROPOSAL_STATUS[st].name}</Badge>
                          </td>
                          <td className="r num">{monthly ? money(monthly, p.currency) : <span className="fainter">–</span>}</td>
                          <td className="r num">{oneOff ? money(oneOff, p.currency) : <span className="fainter">–</span>}</td>
                          <td className="faint" title={fmtDate(ev.at.slice(0, 10), true)}>
                            {ev.label} {ago(ev.at)}
                          </td>
                          <td>
                            <Avatar profile={owner?.profile} size={22} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="pl-foot faint">
            <FileSignature size={13} aria-hidden /> Une proposition envoyée dont la date de validité est dépassée passe automatiquement en « Expirée ».
          </p>
        </>
      )}
    </div>
  );
}
