"use client";

import Link from "next/link";
import { BellRing } from "lucide-react";

import { diffDays, parseDay, relDate, today } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { tsToDay, useSynced } from "./lib";
import { CompanyMark } from "./shared";

export interface FollowUp {
  id: string;
  body: string;
  due_at: string | null;
  deal_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  deal_title?: string | null;
}

// Panneau « À relancer » : activités de type tâche non faites, triées par échéance.
export function FollowUps({ items, onClose }: { items: FollowUp[]; onClose?: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [list, setList] = useSynced(items);
  const sorted = [...list].sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));

  const done = (id: string) => {
    const prev = list;
    setList((l) => l.filter((x) => x.id !== id));
    mutate(async (sb) => must(await sb.from("crm_activities").update({ done: true }).eq("id", id)), {
      success: "Relance faite",
      undo: async () => {
        setList(prev);
        await mutate(async (sb) => must(await sb.from("crm_activities").update({ done: false }).eq("id", id)), { refresh: false });
      },
    });
  };

  return (
    <aside className="crm-follow card" aria-label="À relancer">
      <div className="card-h">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BellRing size={15} className="faint" /> À relancer
          <span className="count">{sorted.length}</span>
        </h3>
        {onClose && (
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Masquer
          </button>
        )}
      </div>
      {sorted.length ? (
        <ul className="crm-follow-list">
          {sorted.map((f) => {
            const day = tsToDay(f.due_at);
            const n = day ? diffDays(parseDay(day)!, today()) : null;
            const co = ws.company(f.company_id);
            const href = f.deal_id
              ? `${ws.base}/crm/deals/${f.deal_id}`
              : f.company_id
                ? `${ws.base}/crm/companies/${f.company_id}`
                : f.contact_id
                  ? `${ws.base}/crm/contacts/${f.contact_id}`
                  : null;
            return (
              <li key={f.id}>
                <input
                  type="checkbox"
                  className="check"
                  aria-label={`Marquer « ${f.body} » comme fait`}
                  disabled={!ws.canWrite}
                  onChange={() => done(f.id)}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  {href ? (
                    <Link href={href} className="crm-follow-body">{f.body || "Relance"}</Link>
                  ) : (
                    <span className="crm-follow-body">{f.body || "Relance"}</span>
                  )}
                  <div className="crm-follow-meta">
                    {day && (
                      <span className="num" style={{ color: n! < 0 ? "var(--red)" : n! <= 1 ? "var(--amber)" : undefined }}>
                        {relDate(day)}
                      </span>
                    )}
                    {co && (
                      <span className="crm-co-inline">
                        <CompanyMark name={co.name} color={co.color} size={14} />
                        <span className="trunc">{f.deal_title ?? co.name}</span>
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="faint" style={{ padding: "0 14px 16px", fontSize: "var(--fs-sm)" }}>
          Rien à relancer. Ajoute une activité « À faire » sur un deal pour la retrouver ici.
        </p>
      )}
    </aside>
  );
}
