"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartColumn, CircleAlert, Copy, DoorOpen, ExternalLink, Info, ListChecks, Mail, Palette, Paperclip, RefreshCw, Trash2, UserPlus, X } from "lucide-react";

import "@/styles/portal-admin.css";
import { Avatar } from "@/components/ui/avatar";
import { ObjIcon } from "@/components/ui/misc";
import { ConfirmModal, Menu, Popover } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { ago } from "@/lib/format";
import { MODULE } from "@/lib/modules";
import {
  ALL_PORTAL_FEATURES, PORTAL_FEATURE, PORTAL_FEATURES, PORTAL_MODE, PORTAL_MODES, featureSummary, portalPath, sortFeatures,
} from "@/lib/portal-admin/features";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ClientUser, Company, Contact, PortalFeature, PortalMode } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { PortalInviteModal, inviteUrl, sendInvite } from "./invite-modal";

interface PortalRow {
  enabled: boolean;
  features: PortalFeature[];
  welcome: string;
}
interface Invitation {
  id: string;
  email: string;
  features: PortalFeature[] | null;
  token: string;
  created_at: string;
}
interface Summary {
  // tâches visibles par projet, dont celles en validation client
  visible: Record<string, number>;
  review: number;
  concepts: number;
  files: number;
  reports: number;
}

/**
 * Onglet « Portail » d'une fiche client : activation, fonctionnalités ouvertes, message d'accueil,
 * personnes ayant accès, invitations, et résumé de ce que le client voit.
 * Charge ses données lui-même (l'onglet n'est monté que s'il est ouvert).
 */
export function CompanyPortal({ company, contacts }: { company: Company; contacts: Contact[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const ro = !ws.canWrite;
  const [portal, setPortal] = useState<PortalRow | null | undefined>(undefined);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [emailOn, setEmailOn] = useState<boolean | null>(null);
  const [welcome, setWelcome] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<ClientUser | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const [modes, setModes] = useState<Record<string, PortalMode>>({});
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const projects = useMemo(() => ws.projects.filter((p) => p.company_id === company.id && !p.archived_at), [ws.projects, company.id]);
  const modeOf = useCallback((p: { id: string; portal_mode: PortalMode }) => modes[p.id] ?? p.portal_mode ?? "selected", [modes]);
  const people = ws.clients.filter((c) => c.company_id === company.id && !gone.includes(c.id));
  const projectKey = projects.map((p) => `${p.id}:${modeOf(p)}`).join(",");

  useEffect(() => {
    let alive = true;
    const sb = supabaseBrowser();
    const pairs = projectKey ? projectKey.split(",").map((x) => x.split(":")) : [];
    const ids = pairs.map((x) => x[0]);
    const sharedIds = pairs.filter((x) => x[1] !== "none").map((x) => x[0]);
    void Promise.all([
      sb.from("client_portals").select("enabled, features, welcome").eq("company_id", company.id).maybeSingle(),
      // Les invitations ne sont lisibles que par les membres non invités (RLS) : liste vide sinon
      sb.from("client_invitations").select("id, email, features, token, created_at").eq("company_id", company.id).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }),
      ids.length
        ? sb.from("tasks").select("id, project_id, status, client_visible").in("project_id", ids).is("archived_at", null)
        : Promise.resolve({ data: [] as { id: string; project_id: string; status: string; client_visible: boolean }[] }),
      sb.from("creative_concepts").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("client_review", "pending"),
      // un projet en mode « Aucune tâche » ne montre pas non plus ses fichiers
      sharedIds.length
        ? sb.from("attachments").select("id", { count: "exact", head: true }).in("project_id", sharedIds).eq("client_visible", true)
        : Promise.resolve({ count: 0 }),
      sb.from("reports").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("shared", true),
    ]).then(([p, inv, tasks, concepts, files, reports]) => {
      if (!alive) return;
      const row = (p.data as PortalRow | null) ?? null;
      setPortal(row);
      setWelcome(row?.welcome ?? "");
      setInvites((inv.data ?? []) as Invitation[]);
      const mode = new Map(projectKey.split(",").filter(Boolean).map((x) => x.split(":") as [string, PortalMode]));
      const visible: Record<string, number> = {};
      let review = 0;
      for (const t of tasks.data ?? []) {
        const m = mode.get(t.project_id);
        if (m === "all" || (m === "selected" && t.client_visible)) {
          visible[t.project_id] = (visible[t.project_id] ?? 0) + 1;
          if (t.status === "review") review++;
        }
      }
      setSummary({ visible, review, concepts: concepts.count ?? 0, files: files.count ?? 0, reports: reports.count ?? 0 });
    });
    return () => {
      alive = false;
    };
  }, [company.id, projectKey, tick]);

  useEffect(() => {
    let alive = true;
    fetch("/api/portal-admin/invite")
      .then((r) => r.json())
      .then((b: { emailEnabled?: boolean }) => alive && setEmailOn(!!b.emailEnabled))
      .catch(() => alive && setEmailOn(false));
    return () => {
      alive = false;
    };
  }, []);

  // ----- Réglages du portail -----
  const save = (patch: Partial<PortalRow>, success?: string) => {
    const prev = portal;
    const next: PortalRow = { enabled: false, features: ALL_PORTAL_FEATURES.filter((f) => ws.has(PORTAL_FEATURE[f].module)), welcome: "", ...(portal ?? {}), ...patch };
    setPortal(next);
    void mutate(
      async (sb) => {
        const r = await sb.from("client_portals").upsert({ company_id: company.id, workspace_id: ws.workspace.id, ...next, updated_at: new Date().toISOString() });
        if (r.error) setPortal(prev);
        return must(r);
      },
      { success, refresh: false },
    );
  };
  const toggleFeature = (f: PortalFeature, on: boolean) => {
    const cur = portal?.features ?? [];
    save({ features: sortFeatures(on ? [...cur, f] : cur.filter((x) => x !== f)) });
  };

  // ----- Personnes -----
  const setPersonFeatures = (u: ClientUser, features: PortalFeature[] | null) =>
    mutate(async (sb) => must(await sb.from("client_users").update({ features }).eq("id", u.id)), { success: "Accès mis à jour" });
  const remove = async (u: ClientUser) => {
    setGone((g) => [...g, u.id]);
    const ok = await mutate(
      async (sb) => {
        must(await sb.from("client_users").delete().eq("id", u.id));
        // L'ancien lien d'invitation ne doit plus permettre de revenir
        await sb.from("client_invitations").update({ revoked_at: new Date().toISOString() }).eq("company_id", company.id).ilike("email", u.profile.email);
        return true;
      },
      { success: `Accès retiré à ${u.profile.full_name || u.profile.email}` },
    );
    if (!ok) setGone((g) => g.filter((x) => x !== u.id));
  };

  // ----- Invitations -----
  const copy = (text: string, msg = "Lien copié") => {
    void navigator.clipboard.writeText(text);
    toast(msg);
  };
  const remind = async (i: Invitation) => {
    try {
      const r = await sendInvite(i.id, true);
      if (r.sent) toast(`Relance envoyée à ${i.email}`);
      else {
        copy(r.url, r.emailEnabled ? `Email non envoyé${r.error ? ` (${r.error})` : ""} : lien copié` : "Emails non configurés : lien copié, envoie-le toi-même");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    }
  };
  const revoke = (i: Invitation) => {
    setInvites((l) => l.filter((x) => x.id !== i.id));
    void mutate(async (sb) => must(await sb.from("client_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", i.id)), {
      success: "Invitation révoquée : le lien ne fonctionne plus",
      refresh: false,
    });
  };

  // ----- Projets -----
  const setMode = (id: string, portal_mode: PortalMode) => {
    setModes((m) => ({ ...m, [id]: portal_mode }));
    void mutate(async (sb) => must(await sb.from("projects").update({ portal_mode }).eq("id", id)), { success: `Partage du projet : ${PORTAL_MODE[portal_mode].name.toLowerCase()}` });
  };

  const preview = portalPath(ws.workspace.slug, company.id);
  const address = typeof window === "undefined" ? "" : `${(process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, "")}/c/${ws.workspace.slug}`;
  const open = sortFeatures(portal?.features ?? []);
  const visibleTotal = summary ? Object.values(summary.visible).reduce((a, b) => a + b, 0) : 0;

  if (portal === undefined)
    return (
      <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }} aria-busy="true">
        <span className="sk" style={{ width: "40%", height: 18 }} />
        <span className="sk" style={{ width: "70%", height: 14 }} />
        <span className="sk" style={{ width: "100%", height: 90 }} />
      </div>
    );

  return (
    <div className="pa-grid">
      <div className="pa-main">
        <section className="card" aria-label="Portail client">
          <div className={`pa-head${portal?.enabled ? " on" : ""}`}>
            <span className="ic"><DoorOpen size={18} /></span>
            <div className="t">
              <b>{portal?.enabled ? "Portail activé" : portal ? "Portail désactivé" : "Portail pas encore activé"}</b>
              <span>
                {portal?.enabled
                  ? `${company.name} voit uniquement ce que tu partages : tâches cochées, créas envoyées en validation, fichiers partagés et rapports publiés.`
                  : portal
                    ? "Les personnes invitées ne peuvent plus se connecter. Tes réglages et les accès sont conservés."
                    : `Donne à ${company.name} un espace pour suivre l'avancement, valider les créas et retrouver ses rapports.`}
              </span>
            </div>
            <div className="acts">
              {portal && (
                <a className="btn" href={preview} target="_blank" rel="noreferrer" title="Ouvre le portail tel que le client le voit, sans te déconnecter">
                  <ExternalLink size={14} /> Voir comme le client
                </a>
              )}
              {!ro &&
                (portal ? (
                  <label className="pa-switch">
                    <input type="checkbox" className="toggle" checked={portal.enabled} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "Portail activé" : "Portail désactivé")} aria-label="Portail activé" />
                    {portal.enabled ? "Activé" : "Désactivé"}
                  </label>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => save({ enabled: true }, "Portail activé")}>
                    Activer le portail
                  </button>
                ))}
            </div>
          </div>

          {portal && (
            <>
              <div className="pa-sec">
                <h4>Fonctionnalités ouvertes</h4>
                <span className="hint">Ce que les personnes de {company.name} trouvent dans leur portail. Tu peux restreindre l&apos;accès personne par personne plus bas.</span>
                <div className="pa-feats">
                  {PORTAL_FEATURES.map((f) => {
                    const off = !ws.has(f.module);
                    const on = open.includes(f.id);
                    return (
                      <label key={f.id} className={`pa-feat${on && !off ? " on" : ""}${off ? " off" : ""}`}>
                        <input type="checkbox" className="check" checked={on && !off} disabled={off || ro} onChange={(e) => toggleFeature(f.id, e.target.checked)} />
                        <span style={{ minWidth: 0 }}>
                          <b>{f.name}</b>
                          <span className="d">{f.desc}</span>
                          {off && <span className="why">Module {MODULE[f.module].name} désactivé dans l&apos;espace</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="pa-sec">
                <h4><label htmlFor="pa-welcome">Message d&apos;accueil</label></h4>
                <span className="hint">Affiché en haut du portail. Écris-le pour ton client, comme tu lui parles d&apos;habitude.</span>
                <textarea
                  id="pa-welcome"
                  className="textarea pa-welcome"
                  value={welcome}
                  disabled={ro}
                  maxLength={600}
                  placeholder="Bienvenue dans votre espace client. Vous y suivez l'avancement de vos campagnes, validez les créas et retrouvez vos rapports."
                  onChange={(e) => setWelcome(e.target.value)}
                  onBlur={() => welcome !== (portal.welcome ?? "") && save({ welcome }, "Message d'accueil enregistré")}
                />
              </div>
            </>
          )}
        </section>

        {portal && (
          <section className="card crm-panel" aria-label="Personnes ayant accès">
            <div className="card-h">
              <h3>Personnes ayant accès <span className="count">{people.length}</span></h3>
              {!ro && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setInviting(true)}>
                  <UserPlus size={13} /> Inviter
                </button>
              )}
            </div>
            {!portal.enabled && (people.length > 0 || invites.length > 0) && (
              <div className="pa-note warn" style={{ margin: "0 14px 10px" }}>
                <CircleAlert size={15} />
                <span>Le portail est désactivé : ces personnes ne peuvent pas se connecter pour l&apos;instant.</span>
              </div>
            )}
            {people.length ? (
              <ul className="pa-people">
                {people.map((u) => (
                  <li key={u.id} className="pa-person">
                    <Avatar profile={u.profile} size={26} title={false} />
                    <span className="who">
                      <b className="trunc">{u.profile.full_name || u.profile.email}</b>
                      <span className="trunc">{u.profile.email}</span>
                    </span>
                    <span className="seen" title={u.last_seen_at ? new Date(u.last_seen_at).toLocaleString("fr-FR") : undefined}>
                      {u.last_seen_at ? `Vu ${ago(u.last_seen_at)}` : "Jamais connecté"}
                    </span>
                    <FeaturePicker value={u.features} open={open} disabled={ro} onChange={(f) => void setPersonFeatures(u, f)} />
                    {!ro && (
                      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Retirer l'accès de ${u.profile.full_name || u.profile.email}`} title="Retirer l'accès" onClick={() => setRemoving(u)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="crm-panel-empty">
                Personne n&apos;a encore accès. {ro ? "" : "Invite ton interlocuteur : il crée son compte avec son email et ne voit que cette entreprise."}
              </p>
            )}
            {invites.length > 0 && (
              <>
                <div className="pa-sub">Invitations en attente</div>
                <ul className="pa-people">
                  {invites.map((i) => (
                    <li key={i.id} className="pa-person">
                      <span className="mail"><Mail size={13} /></span>
                      <span className="who">
                        <b className="trunc">{i.email}</b>
                        <span className="trunc">Invitée {ago(i.created_at)} · {featureSummary(i.features, open)}</span>
                      </span>
                      <span className="btns">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(inviteUrl(i.token))} title="Copier le lien d'invitation">
                          <Copy size={13} /> <span className="pa-hide-sm">Copier le lien</span>
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remind(i)} title={emailOn ? "Renvoyer l'email d'invitation" : "Emails non configurés : copie le lien"}>
                          <RefreshCw size={13} /> <span className="pa-hide-sm">Relancer</span>
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => revoke(i)} aria-label={`Révoquer l'invitation de ${i.email}`} title="Révoquer l'invitation">
                          <X size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {!portal && (
          <div className="pa-note">
            <Info size={15} />
            <span>
              Un client n&apos;est pas membre de ton espace : il a son propre accès, limité à son entreprise, et ne voit jamais tes commentaires internes, tes autres clients ni ton pipeline.
            </span>
          </div>
        )}
      </div>

      <aside className="pa-side">
        <section className="card crm-panel" aria-label="Ce que voit le client">
          <div className="card-h"><h3>Ce que voit le client</h3></div>
          <ul className="pa-stats">
            <li>
              <Link href={projects[0] ? `${ws.base}/projects/${projects[0].key}/list` : `${ws.base}/projects`}>
                <ListChecks size={15} /> Tâches visibles
                {summary && summary.review > 0 && <span className="x">{summary.review} à valider</span>}
                <span className="n">{summary ? visibleTotal : "…"}</span>
              </Link>
            </li>
            {ws.has("creatives") && (
              <li>
                <Link href={`${ws.base}/creatives`}>
                  <Palette size={15} /> Créas en attente de validation
                  <span className="n">{summary?.concepts ?? "…"}</span>
                </Link>
              </li>
            )}
            <li>
              <Link href={projects[0] ? `${ws.base}/projects/${projects[0].key}/files` : `${ws.base}/projects`}>
                <Paperclip size={15} /> Fichiers partagés
                <span className="n">{summary?.files ?? "…"}</span>
              </Link>
            </li>
            {ws.has("reporting") && (
              <li>
                <Link href={`${ws.base}/reporting/${company.id}`}>
                  <ChartColumn size={15} /> Rapports publiés
                  <span className="n">{summary?.reports ?? "…"}</span>
                </Link>
              </li>
            )}
          </ul>
        </section>

        {ws.has("projects") && (
          <section className="card crm-panel" aria-label="Projets partagés">
            <div className="card-h"><h3>Projets partagés</h3></div>
            {projects.length ? (
              <div style={{ padding: "0 6px 8px" }}>
                {projects.map((p) => {
                  const m = modeOf(p);
                  return (
                    <div key={p.id} className="pa-proj">
                      <ObjIcon icon={p.icon} color={p.color} size={20} />
                      <Link href={`${ws.base}/projects/${p.key}/overview`} className="name trunc" title={p.name}>{p.name}</Link>
                      <span className="faint num" style={{ fontSize: "var(--fs-xs)" }} title="Tâches visibles par le client">{summary?.visible[p.id] ?? 0}</span>
                      {ro ? (
                        <span className={`pa-mode ${m}`}>{PORTAL_MODE[m].name}</span>
                      ) : (
                        <Menu
                          align="end"
                          width={290}
                          trigger={(o) => (
                            <button type="button" className={`pa-mode ${m}`} onClick={o} aria-label={`Partage du projet ${p.name}`}>
                              {PORTAL_MODE[m].name}
                            </button>
                          )}
                          items={PORTAL_MODES.map((x) => ({ label: x.name, checked: x.id === m, onSelect: () => x.id !== m && setMode(p.id, x.id) }))}
                        />
                      )}
                    </div>
                  );
                })}
                <p className="faint" style={{ fontSize: "var(--fs-xs)", padding: "6px 8px 0", lineHeight: 1.45 }}>
                  Tâches cochées : seules celles marquées « Visible par le client » apparaissent. Les commentaires internes ne sont jamais montrés.
                </p>
              </div>
            ) : (
              <p className="crm-panel-empty">Aucun projet rattaché à ce client.</p>
            )}
          </section>
        )}

        {portal && (
          <section className="card crm-panel" aria-label="Adresse du portail">
            <div className="card-h"><h3>Adresse du portail</h3></div>
            <div className="pa-url">
              <input className="input mono" readOnly value={address} onFocus={(e) => e.currentTarget.select()} aria-label="Adresse du portail" />
              <button type="button" className="btn btn-sm" onClick={() => copy(address, "Adresse copiée")}>
                <Copy size={13} />
              </button>
            </div>
            <p className="crm-panel-empty">Une fois invitées, les personnes de {company.name} se connectent à cette adresse avec leur email.</p>
          </section>
        )}
      </aside>

      {inviting && portal && (
        <PortalInviteModal
          companyId={company.id}
          companyName={company.name}
          contacts={contacts}
          open={open}
          taken={people.map((u) => u.profile.email.toLowerCase())}
          emailOn={emailOn}
          portalOn={portal.enabled}
          onClose={() => setInviting(false)}
          onDone={reload}
        />
      )}
      {removing && (
        <ConfirmModal
          title={`Retirer l'accès de ${removing.profile.full_name || removing.profile.email} ?`}
          text={`Cette personne ne pourra plus ouvrir le portail de ${company.name} et son lien d'invitation sera révoqué. Ses commentaires et ses validations sont conservés.`}
          confirmLabel="Retirer l'accès"
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/** Fonctionnalités d'une personne : toutes celles du portail (null) ou un sous-ensemble. */
function FeaturePicker({ value, open, disabled, onChange }: { value: PortalFeature[] | null; open: PortalFeature[]; disabled?: boolean; onChange: (v: PortalFeature[] | null) => void }) {
  const label = featureSummary(value, open);
  if (disabled) return <span className="pa-mode">{label}</span>;
  const cur = value === null ? open : value.filter((f) => open.includes(f));
  return (
    <Popover
      align="end"
      trigger={(o) => (
        <button type="button" className={`pa-mode${value === null ? "" : " all"}`} onClick={o} title="Fonctionnalités de cette personne">
          {label}
        </button>
      )}
    >
      {() => (
        <div className="pa-feat-menu">
          <button type="button" className="mi" onClick={() => onChange(null)}>
            <input type="checkbox" className="check" readOnly checked={value === null} tabIndex={-1} />
            Toutes celles du portail
          </button>
          <div className="mi-sep" />
          {open.map((f) => {
            const on = cur.includes(f);
            return (
              <button key={f} type="button" className="mi" onClick={() => onChange(sortFeatures(on ? cur.filter((x) => x !== f) : [...cur, f]))}>
                <input type="checkbox" className="check" readOnly checked={on} tabIndex={-1} />
                {PORTAL_FEATURE[f].name}
              </button>
            );
          })}
          {!open.length && <div className="mi faint">Aucune fonctionnalité ouverte</div>}
        </div>
      )}
    </Popover>
  );
}
