"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, FileText, Link2, RefreshCw } from "lucide-react";

import "@/styles/reporting.css";
import { SetCrumbs, type Crumb } from "@/components/shell/crumbs";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/misc";
import { colorOf } from "@/lib/constants";
import { ago, fmtDate, initials } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import { rangeLabel } from "@/lib/ads/metrics";
import type { SyncResult } from "@/lib/ads/types";

/** Lance /api/reporting/sync (un compte ou tout l'espace) puis rafraîchit la page. */
export function useSync() {
  const { workspace } = useWorkspace();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (accountId?: string, opts: { full?: boolean; quiet?: boolean } = {}) => {
    setBusy(accountId ?? "all");
    try {
      const res = await fetch("/api/reporting/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspace.id, account_id: accountId, full: opts.full }),
      });
      const json = (await res.json().catch(() => ({}))) as { results?: SyncResult[]; error?: string };
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      const results = json.results ?? [];
      const failed = results.filter((r) => !r.ok);
      if (!results.length) {
        if (!opts.quiet) toast("Aucun compte connecté à synchroniser");
      } else if (failed.length) toast(`${failed.length} compte${failed.length > 1 ? "s" : ""} en erreur : ${failed[0].error}`, { error: true });
      else if (!opts.quiet) toast(`${results.length} compte${results.length > 1 ? "s" : ""} synchronisé${results.length > 1 ? "s" : ""}`);
      router.refresh();
      return results;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}

export function SyncButton({ accountId, label = "Synchroniser", small, disabled }: { accountId?: string; label?: string; small?: boolean; disabled?: boolean }) {
  const { canWrite } = useWorkspace();
  const { run, busy } = useSync();
  if (!canWrite) return null;
  const on = busy !== null;
  return (
    <button type="button" className={`btn${small ? " btn-sm" : ""}`} onClick={() => run(accountId)} disabled={on || disabled} aria-busy={on}>
      <RefreshCw size={small ? 12 : 14} className={on ? "rp-spin" : undefined} />
      {on ? "Synchronisation…" : label}
    </button>
  );
}

/** Pastille client (initiale colorée). */
export function CompanyMark({ name, color, size = 22 }: { name: string; color: string; size?: number }) {
  return (
    <span className="av" style={{ ["--s" as string]: `${size}px`, ["--c" as string]: colorOf(color), borderRadius: 5 }} aria-hidden>
      {initials(name).slice(0, 1)}
    </span>
  );
}

// ---------------------------------------------------------------------
// Tri de tableau
// ---------------------------------------------------------------------
export type SortDir = "asc" | "desc";

export function useSort<K extends string>(initial: K, dir: SortDir = "desc") {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: initial, dir });
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === ("name" as K) ? "asc" : "desc" }));
  const apply = <T,>(rows: T[], get: (r: T, k: K) => number | string | null) =>
    [...rows].sort((a, b) => {
      const x = get(a, sort.key);
      const y = get(b, sort.key);
      if (x === null && y === null) return 0;
      if (x === null) return 1; // valeurs absentes toujours en bas
      if (y === null) return -1;
      const c = typeof x === "string" ? x.localeCompare(String(y), "fr") : x - (y as number);
      return sort.dir === "asc" ? c : -c;
    });
  return { sort, toggle, apply };
}

export function SortTh<K extends string>({ k, sort, onSort, children, right, className }: { k: K; sort: { key: K; dir: SortDir }; onSort: (k: K) => void; children: ReactNode; right?: boolean; className?: string }) {
  const on = sort.key === k;
  return (
    <th className={`${right ? "r " : ""}${className ?? ""}`} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => onSort(k)}>
        {children}
        {on && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------
// Liste des rapports
// ---------------------------------------------------------------------
export interface ReportItem {
  id: string;
  company_id: string;
  title: string;
  period_start: string;
  period_end: string;
  shared: boolean;
  created_at: string;
}

export function ReportsTable({ reports, showCompany = true, empty }: { reports: ReportItem[]; showCompany?: boolean; empty?: ReactNode }) {
  const ws = useWorkspace();
  const router = useRouter();
  if (!reports.length) return <>{empty}</>;
  return (
    <div className="rp-scroll">
      <table className="tbl rp-tbl" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th>Rapport</th>
            {showCompany && <th>Client</th>}
            <th>Période</th>
            <th>Partage</th>
            <th className="r">Créé</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => {
            const c = ws.company(r.company_id);
            const href = `${ws.base}/reporting/reports/${r.id}`;
            return (
              <tr key={r.id} className="link" onClick={() => router.push(href)}>
                <td>
                  <Link href={href} className="client" onClick={(e) => e.stopPropagation()}>
                    <FileText size={14} className="faint" />
                    <span className="trunc" style={{ fontWeight: 500 }}>{r.title}</span>
                  </Link>
                </td>
                {showCompany && (
                  <td>
                    {c ? (
                      <span className="client">
                        <CompanyMark name={c.name} color={c.color} size={18} />
                        <span className="trunc">{c.name}</span>
                      </span>
                    ) : (
                      <span className="faint">–</span>
                    )}
                  </td>
                )}
                <td className="muted">{rangeLabel(r.period_start, r.period_end)}</td>
                <td>
                  {r.shared ? (
                    <Badge color="var(--green)">
                      <Link2 size={11} /> Partagé
                    </Badge>
                  ) : (
                    <Badge color="var(--gray)">Brouillon</Badge>
                  )}
                </td>
                <td className="r faint" title={fmtDate(r.created_at.slice(0, 10), true)}>{ago(r.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Fil d'Ariane posé après le premier rendu : le CrumbsProvider réinitialise la surcharge
 * dans un effet parent qui s'exécute après ceux des enfants (sinon la surcharge est perdue).
 */
export function Crumbs({ items }: { items: Crumb[] }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, []);
  return ready ? <SetCrumbs items={items} /> : null;
}
