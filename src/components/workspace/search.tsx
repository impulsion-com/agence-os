"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Contact, FileSignature, Handshake, Search } from "lucide-react";

import "@/styles/workspace.css";
import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, ObjIcon } from "@/components/ui/misc";
import { PriorityIcon, StatusIcon } from "@/components/ui/status";
import { DueText } from "@/components/pickers";
import { PROJECT_STATUS, colorOf } from "@/lib/constants";
import { money } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import type { Priority, ProjectStatus, ProposalStatus, TaskStatus } from "@/lib/types";
import { rowProps, useOpenTask } from "./hooks";
import { PROPOSAL_STATUS } from "./inbox";

export interface SearchResults {
  tasks: { id: string; title: string; number: number; status: TaskStatus; priority: Priority; project_id: string; due_date: string | null; assignee_id: string | null }[];
  projects: { id: string; key: string; name: string; status: ProjectStatus; icon: string; color: string; company_id: string | null; archived_at: string | null }[];
  companies: { id: string; name: string; status: string; industry: string; website: string; color: string }[];
  contacts: { id: string; first_name: string; last_name: string; email: string; job_title: string; company_id: string | null }[];
  deals: { id: string; title: string; value: number; billing: string; company_id: string | null; stage: { name: string; color: string } | null }[];
  proposals: { id: string; title: string; number: number; status: ProposalStatus; company_id: string | null }[];
}

const COMPANY_STATUS: Record<string, string> = { lead: "Prospect", client: "Client", former: "Ancien client" };

// Surligne toutes les occurrences du terme, sans tenir compte de la casse ni des accents
export function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  // Normalisation caractère par caractère : mêmes indices que le texte d'origine
  const norm = (s: string) => Array.from(s, (c) => (c.normalize("NFD")[0] ?? c).toLowerCase()).join("");
  const hay = norm(text);
  const needle = norm(q);
  if (!needle) return <>{text}</>;
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    if (j > i) out.push(<Fragment key={k++}>{text.slice(i, j)}</Fragment>);
    out.push(<mark key={k++} className="hl">{text.slice(j, j + needle.length)}</mark>);
    i = j + needle.length;
  }
  out.push(<Fragment key={k++}>{text.slice(i)}</Fragment>);
  return <>{out}</>;
}

export function SearchView({ q, results }: { q: string; results: SearchResults | null }) {
  const ws = useWorkspace();
  const router = useRouter();
  const path = usePathname();
  const openTask = useOpenTask();
  const [value, setValue] = useState(q);
  const [pending, start] = useTransition();

  // Met à jour l'URL (et donc les résultats serveur) après une courte pause de frappe
  useEffect(() => {
    if (value.trim() === q) return;
    const t = setTimeout(() => {
      start(() => router.replace(value.trim() ? `${path}?q=${encodeURIComponent(value.trim())}` : path, { scroll: false }));
    }, 250);
    return () => clearTimeout(t);
  }, [value, q, path, router]);

  const r = results;
  const total = r ? r.tasks.length + r.projects.length + r.companies.length + r.contacts.length + r.deals.length + r.proposals.length : 0;
  const cur = ws.workspace.currency;

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <h1 className="sr">Recherche</h1>
      <form
        className="search-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          start(() => router.replace(`${path}?q=${encodeURIComponent(value.trim())}`));
        }}
      >
        <Search size={17} />
        <input
          autoFocus
          className="input"
          type="search"
          placeholder="Rechercher des tâches, projets, clients, contacts, deals, propositions…"
          aria-label="Rechercher dans l'espace"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </form>
      <p className="faint" style={{ fontSize: "var(--fs-sm)", marginTop: 10, minHeight: 20 }} aria-live="polite">
        {pending
          ? "Recherche…"
          : !q
            ? "Tape au moins deux caractères. Astuce : ⌘K ouvre la recherche rapide depuis n'importe quelle page."
            : q.length < 2
              ? "Tape au moins deux caractères."
              : `${total} résultat${total > 1 ? "s" : ""} pour « ${q} »`}
      </p>

      {r && total === 0 && !pending && (
        <div className="card" style={{ marginTop: 16 }}>
          <EmptyState icon="search" title="Aucun résultat" text={`Rien ne correspond à « ${q} ». Vérifie l'orthographe ou essaie un mot plus court.`} />
        </div>
      )}

      {r && r.tasks.length > 0 && (
        <Group title="Tâches" n={r.tasks.length}>
          {r.tasks.map((t) => {
            const p = ws.project(t.project_id);
            const who = ws.member(t.assignee_id);
            return (
              <div key={t.id} className="sr-item" {...rowProps(() => openTask(t.id))}>
                <StatusIcon status={t.status} />
                <span className="mono fainter" style={{ fontSize: "var(--fs-2xs)" }}>{p?.key}-{t.number}</span>
                <span className="trunc"><Highlight text={t.title} q={q} /></span>
                <span className="sr-side">
                  {p && <span className="hide-sm" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ width: 7, height: 7, borderRadius: 2, background: colorOf(p.color) }} />{p.name}</span>}
                  <PriorityIcon priority={t.priority} />
                  <DueText date={t.due_date} done={t.status === "done"} />
                  <Avatar profile={who?.profile ?? null} size={18} />
                </span>
              </div>
            );
          })}
        </Group>
      )}

      {r && r.projects.length > 0 && (
        <Group title="Projets" n={r.projects.length}>
          {r.projects.map((p) => (
            <Link key={p.id} href={p.archived_at ? `${ws.base}/archive` : `${ws.base}/projects/${p.key}/board`} className="sr-item">
              <ObjIcon icon={p.icon} color={p.color} size={22} />
              <span className="trunc"><Highlight text={p.name} q={q} /></span>
              <span className="sr-side">
                {ws.company(p.company_id)?.name}
                {p.archived_at ? <Badge color="var(--gray)">Archivé</Badge> : <Badge color={PROJECT_STATUS[p.status].color}>{PROJECT_STATUS[p.status].name}</Badge>}
              </span>
            </Link>
          ))}
        </Group>
      )}

      {r && r.companies.length > 0 && (
        <Group title="Clients et prospects" n={r.companies.length}>
          {r.companies.map((c) => (
            <Link key={c.id} href={`${ws.base}/crm/companies/${c.id}`} className="sr-item">
              <span className="av" style={{ ["--s" as string]: "22px", ["--c" as string]: colorOf(c.color), borderRadius: 6 }}>{c.name[0]}</span>
              <span style={{ minWidth: 0 }}>
                <span className="trunc" style={{ display: "block" }}><Highlight text={c.name} q={q} /></span>
                {(c.website || c.industry) && <span className="sub trunc" style={{ display: "block" }}><Highlight text={[c.industry, c.website].filter(Boolean).join(" · ")} q={q} /></span>}
              </span>
              <span className="sr-side"><Building2 size={13} />{COMPANY_STATUS[c.status] ?? c.status}</span>
            </Link>
          ))}
        </Group>
      )}

      {r && r.contacts.length > 0 && (
        <Group title="Contacts" n={r.contacts.length}>
          {r.contacts.map((c) => {
            const name = `${c.first_name} ${c.last_name}`.trim() || c.email;
            return (
              <Link key={c.id} href={`${ws.base}/crm/contacts/${c.id}`} className="sr-item">
                <Avatar profile={{ full_name: name, color: "#6B7280" }} size={22} />
                <span style={{ minWidth: 0 }}>
                  <span className="trunc" style={{ display: "block" }}><Highlight text={name} q={q} /></span>
                  <span className="sub trunc" style={{ display: "block" }}><Highlight text={[c.job_title, c.email].filter(Boolean).join(" · ")} q={q} /></span>
                </span>
                <span className="sr-side"><Contact size={13} />{ws.company(c.company_id)?.name}</span>
              </Link>
            );
          })}
        </Group>
      )}

      {r && r.deals.length > 0 && (
        <Group title="Deals" n={r.deals.length}>
          {r.deals.map((d) => (
            <Link key={d.id} href={`${ws.base}/crm/deals/${d.id}`} className="sr-item">
              <Handshake size={16} className="faint" />
              <span className="trunc"><Highlight text={d.title} q={q} /></span>
              <span className="sr-side">
                {ws.company(d.company_id)?.name}
                <span className="num">{money(d.value, cur)}{d.billing === "monthly" ? " / mois" : ""}</span>
                {d.stage && <Badge color={colorOf(d.stage.color)}>{d.stage.name}</Badge>}
              </span>
            </Link>
          ))}
        </Group>
      )}

      {r && r.proposals.length > 0 && (
        <Group title="Propositions" n={r.proposals.length}>
          {r.proposals.map((p) => (
            <Link key={p.id} href={`${ws.base}/proposals/${p.id}`} className="sr-item">
              <FileSignature size={16} className="faint" />
              <span className="mono fainter" style={{ fontSize: "var(--fs-2xs)" }}>n° {p.number}</span>
              <span className="trunc"><Highlight text={p.title} q={q} /></span>
              <span className="sr-side">
                {ws.company(p.company_id)?.name}
                <Badge color={PROPOSAL_STATUS[p.status]?.color ?? "var(--gray)"}>{PROPOSAL_STATUS[p.status]?.name ?? p.status}</Badge>
              </span>
            </Link>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  return (
    <section className="sr-group">
      <h2>
        {title} <span className="fainter">{n}</span>
      </h2>
      <div className="rows">{children}</div>
    </section>
  );
}
