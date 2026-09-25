"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Ellipsis, Minus, Search, Trash2, UserPlus, X } from "lucide-react";

import "@/styles/workspace.css";
import { useUI } from "@/components/shell/ui-context";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { ConfirmModal, Menu } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { ROLE, ROLES, colorOf } from "@/lib/constants";
import { ago, fmtDate } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Member, Role } from "@/lib/types";
import type { Invitation } from "./queries";

type Tab = "members" | "invites" | "roles";

const ROLE_COLOR: Record<Role, string> = { owner: "var(--violet)", admin: "var(--blue)", member: "var(--green)", guest: "var(--gray)" };

// Matrice des permissions, alignée sur les policies RLS de la base
const PERMS: { label: string; roles: Role[] }[] = [
  { label: "Voir les projets, tâches, CRM, propositions et rapports", roles: ["owner", "admin", "member", "guest"] },
  { label: "Créer et modifier projets, tâches, deals et propositions", roles: ["owner", "admin", "member"] },
  { label: "Commenter et joindre des fichiers", roles: ["owner", "admin", "member"] },
  { label: "Inviter, retirer des membres et changer les rôles", roles: ["owner", "admin"] },
  { label: "Réglages de l'espace, pipeline, services et connexions publicitaires", roles: ["owner", "admin"] },
  { label: "Charger ou supprimer les données de démo", roles: ["owner", "admin"] },
  { label: "Nommer un autre propriétaire", roles: ["owner"] },
  { label: "Supprimer l'espace de travail", roles: ["owner"] },
];

export function MembersView({ openByUser, invitations, embedded }: { openByUser: Record<string, number>; invitations: Invitation[]; embedded?: boolean }) {
  const ws = useWorkspace();
  const ui = useUI();
  const [tab, setTab] = useState<Tab>("members");
  const pending = invitations.length;

  return (
    <>
      {embedded ? (
        <div className="ph" style={{ marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: "var(--fs-xl)" }}>Membres et invitations</h1>
            <p>Qui a accès à {ws.workspace.name}, avec quel rôle.</p>
          </div>
          {ws.isAdmin && <InviteButton />}
        </div>
      ) : (
        <PageHeader
          title="Membres"
          sub={`${ws.members.length} personne${ws.members.length > 1 ? "s" : ""} dans ${ws.workspace.name}${ws.isAdmin && pending ? ` · ${pending} invitation${pending > 1 ? "s" : ""} en attente` : ""}`}
        >
          {ws.isAdmin && <InviteButton />}
        </PageHeader>
      )}

      <div className="tabs" role="tablist" aria-label="Sections">
        <button role="tab" aria-selected={tab === "members"} className={`tab${tab === "members" ? " on" : ""}`} onClick={() => setTab("members")}>
          Membres <span className="count">{ws.members.length}</span>
        </button>
        {ws.isAdmin && (
          <button role="tab" aria-selected={tab === "invites"} className={`tab${tab === "invites" ? " on" : ""}`} onClick={() => setTab("invites")}>
            Invitations {pending > 0 && <span className="count accent">{pending}</span>}
          </button>
        )}
        <button role="tab" aria-selected={tab === "roles"} className={`tab${tab === "roles" ? " on" : ""}`} onClick={() => setTab("roles")}>
          Rôles et permissions
        </button>
      </div>

      {tab === "members" && <MembersTable openByUser={openByUser} />}
      {tab === "invites" && <InvitesTable invitations={invitations} onInvite={() => ui.create({ kind: "invite" })} />}
      {tab === "roles" && <RolesTable />}
    </>
  );
}

function InviteButton() {
  const ui = useUI();
  return (
    <button className="btn btn-primary" onClick={() => ui.create({ kind: "invite" })}>
      <UserPlus size={14} />
      Inviter
    </button>
  );
}

function MembersTable({ openByUser }: { openByUser: Record<string, number> }) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "all">("all");
  const [team, setTeam] = useState<string>("all");
  const [removing, setRemoving] = useState<Member | null>(null);
  const isOwner = ws.role === "owner";

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ws.members.filter(
      (m) =>
        (role === "all" || m.role === role) &&
        (team === "all" || (team === "none" ? !m.team_id : m.team_id === team)) &&
        (!s || m.profile.full_name.toLowerCase().includes(s) || m.profile.email.toLowerCase().includes(s) || (m.profile.title || m.title).toLowerCase().includes(s)),
    );
  }, [ws.members, q, role, team]);

  const update = (m: Member, values: { role?: Role; team_id?: string | null }, success: string) =>
    mutate(async (sb) => must(await sb.from("workspace_members").update(values).eq("workspace_id", ws.workspace.id).eq("user_id", m.user_id).select("user_id")), { success });

  const canEdit = (m: Member) => ws.isAdmin && (m.role !== "owner" || isOwner);
  const roleOptions = ROLES.filter((r) => r.id !== "owner" || isOwner);

  return (
    <>
      <div className="filters">
        <label className="search-mini">
          <Search size={13} />
          <input className="input" placeholder="Nom, email ou titre…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un membre" />
        </label>
        <span className="seg" role="group" aria-label="Filtrer par rôle">
          <button className={role === "all" ? "on" : ""} onClick={() => setRole("all")}>Tous</button>
          {ROLES.map((r) => (
            <button key={r.id} className={role === r.id ? "on" : ""} onClick={() => setRole(r.id)}>{r.name}</button>
          ))}
        </span>
        {ws.teams.length > 0 && (
          <select className="select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filtrer par équipe">
            <option value="all">Toutes les équipes</option>
            {ws.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
            <option value="none">Sans équipe</option>
          </select>
        )}
      </div>

      <div className="card card-scroll">
        {rows.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 14 }}>Membre</th>
                <th className="hide-sm">Titre</th>
                <th>Rôle</th>
                <th className="hide-sm">Équipe</th>
                <th className="r">Tâches ouvertes</th>
                <th className="hide-sm">Arrivée</th>
                <th style={{ width: 44 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const t = ws.teams.find((x) => x.id === m.team_id);
                const me = m.user_id === ws.me.id;
                return (
                  <tr key={m.user_id}>
                    <td style={{ paddingLeft: 14, height: 52 }}>
                      <Link href={`${ws.base}/members/${m.user_id}`} className="who">
                        <Avatar profile={m.profile} size={28} />
                        <span style={{ minWidth: 0 }}>
                          <span className="nm trunc">
                            {m.profile.full_name}
                            {me && <span className="faint" style={{ fontWeight: 400 }}>(toi)</span>}
                          </span>
                          <span className="em trunc" style={{ display: "block" }}>{m.profile.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="hide-sm muted-cell trunc" style={{ maxWidth: 200 }}>{m.profile.title || m.title || "·"}</td>
                    <td>
                      {canEdit(m) && !me ? (
                        <select
                          className="select inline"
                          value={m.role}
                          aria-label={`Rôle de ${m.profile.full_name}`}
                          onChange={(e) => update(m, { role: e.target.value as Role }, `${m.profile.full_name} est maintenant ${ROLE[e.target.value as Role].name.toLowerCase()}`)}
                        >
                          {roleOptions.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      ) : (
                        <Badge color={ROLE_COLOR[m.role]}>{ROLE[m.role].name}</Badge>
                      )}
                    </td>
                    <td className="hide-sm">
                      {ws.isAdmin ? (
                        <select
                          className="select inline"
                          value={m.team_id ?? ""}
                          aria-label={`Équipe de ${m.profile.full_name}`}
                          onChange={(e) => update(m, { team_id: e.target.value || null }, "Équipe mise à jour")}
                        >
                          <option value="">Aucune équipe</option>
                          {ws.teams.map((x) => (
                            <option key={x.id} value={x.id}>{x.name}</option>
                          ))}
                        </select>
                      ) : t ? (
                        <Link href={`${ws.base}/teams/${t.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-sm)" }}>
                          <Icon name={t.icon} size={14} style={{ color: colorOf(t.color) }} />
                          {t.name}
                        </Link>
                      ) : (
                        <span className="fainter">Aucune</span>
                      )}
                    </td>
                    <td className="r num">{openByUser[m.user_id] ?? 0}</td>
                    <td className="hide-sm muted-cell num">{fmtDate(m.joined_at.slice(0, 10))}</td>
                    <td className="r" style={{ paddingRight: 10 }}>
                      <Menu
                        align="end"
                        trigger={(open) => (
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label={`Actions pour ${m.profile.full_name}`}>
                            <Ellipsis size={15} />
                          </button>
                        )}
                        items={[
                          { label: "Voir la fiche", icon: <Icon name="users" size={14} />, onSelect: () => router.push(`${ws.base}/members/${m.user_id}`) },
                          { label: "Copier l'email", icon: <Copy size={14} />, onSelect: () => navigator.clipboard.writeText(m.profile.email) },
                          ...(canEdit(m) && !me ? [{ label: "", separator: true }, { label: "Retirer de l'espace", icon: <Trash2 size={14} />, danger: true, onSelect: () => setRemoving(m) }] : []),
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState icon="users" title="Aucun membre trouvé" text="Modifie la recherche ou les filtres." />
        )}
      </div>

      {removing && (
        <ConfirmModal
          title={`Retirer ${removing.profile.full_name} ?`}
          text={
            <>
              {removing.profile.full_name} perdra immédiatement l&apos;accès à {ws.workspace.name}. Ses tâches restent en place mais ne lui seront plus
              visibles. Tu pourras l&apos;inviter de nouveau plus tard.
            </>
          }
          confirmLabel="Retirer"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("workspace_members").delete().eq("workspace_id", ws.workspace.id).eq("user_id", removing.user_id).select("user_id")), {
              success: `${removing.profile.full_name} a été retiré de l'espace`,
            });
          }}
        />
      )}
    </>
  );
}

function InvitesTable({ invitations, onInvite }: { invitations: Invitation[]; onInvite: () => void }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (i: Invitation) => {
    navigator.clipboard.writeText(`${location.origin}/invite/${i.token}`);
    setCopied(i.id);
    toast("Lien d'invitation copié");
    setTimeout(() => setCopied((c) => (c === i.id ? null : c)), 1600);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div className="card card-scroll">
        {invitations.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ paddingLeft: 14 }}>Email</th>
                <th>Rôle</th>
                <th className="hide-sm">Équipe</th>
                <th className="hide-sm">Invité par</th>
                <th className="hide-sm">Envoyée</th>
                <th className="r" style={{ paddingRight: 14 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => {
                const by = ws.member(i.invited_by);
                const t = ws.teams.find((x) => x.id === i.team_id);
                return (
                  <tr key={i.id}>
                    <td style={{ paddingLeft: 14 }}>
                      <span className="who">
                        <Avatar profile={{ full_name: i.email, color: "#8A867E" }} size={24} />
                        <span className="trunc">{i.email}</span>
                      </span>
                    </td>
                    <td><Badge color={ROLE_COLOR[i.role]}>{ROLE[i.role].name}</Badge></td>
                    <td className="hide-sm muted-cell">{t?.name ?? "Aucune"}</td>
                    <td className="hide-sm muted-cell">{by?.profile.full_name ?? "·"}</td>
                    <td className="hide-sm muted-cell">{ago(i.created_at)}</td>
                    <td className="r" style={{ paddingRight: 14, whiteSpace: "nowrap" }}>
                      <button className="btn btn-sm" onClick={() => copy(i)}>
                        {copied === i.id ? <Check size={13} /> : <Copy size={13} />}
                        Copier le lien
                      </button>{" "}
                      <button className="btn btn-sm btn-ghost" onClick={() => setRevoking(i)}>
                        <X size={13} />
                        Révoquer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState icon="user-plus" title="Aucune invitation en attente" text="Invite un collègue, un freelance ou un client (en invité, lecture seule).">
            <button className="btn btn-sm btn-primary" onClick={onInvite}>
              <UserPlus size={13} />
              Inviter
            </button>
          </EmptyState>
        )}
      </div>
      <p className="faint" style={{ fontSize: "var(--fs-xs)", marginTop: 10 }}>
        Envoie le lien à la personne : elle crée son compte avec cette adresse puis rejoint l&apos;espace en l&apos;ouvrant.
      </p>
      {revoking && (
        <ConfirmModal
          title="Révoquer l'invitation ?"
          text={<>Le lien envoyé à {revoking.email} ne fonctionnera plus.</>}
          confirmLabel="Révoquer"
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("invitations").delete().eq("id", revoking.id).select("id")), { success: "Invitation révoquée" });
          }}
        />
      )}
    </div>
  );
}

function RolesTable() {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="card card-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>Permission</th>
              {ROLES.map((r) => (
                <th key={r.id} className="c">{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMS.map((p) => (
              <tr key={p.label}>
                <td style={{ paddingLeft: 14 }}>{p.label}</td>
                {ROLES.map((r) => (
                  <td key={r.id} className="c">
                    {p.roles.includes(r.id) ? (
                      <Check size={15} className="perm-yes" aria-label="Oui" />
                    ) : (
                      <Minus size={15} className="perm-no" aria-label="Non" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dash-2" style={{ marginTop: 16 }}>
        {ROLES.map((r) => (
          <div key={r.id} className="card" style={{ padding: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Badge color={ROLE_COLOR[r.id]}>{r.name}</Badge>
            <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{r.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
