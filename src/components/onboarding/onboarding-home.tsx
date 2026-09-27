"use client";

import "@/styles/onboarding.css";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive, CircleAlert, Copy, Ellipsis, ExternalLink, KeyRound, Pencil, Plus, RotateCcw, Search, Send, Settings2, Trash2,
} from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, PageHeader, Progress } from "@/components/ui/misc";
import { ConfirmModal, Menu } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { colorOf } from "@/lib/constants";
import { ago, fmtDate } from "@/lib/format";
import { FORM_STATUS, PLACEHOLDERS, questionCount, uid } from "@/lib/onboarding/logic";
import type { Answers, FormStatus, OnboardingSettings, OnboardingTemplate, Section, Verified } from "@/lib/onboarding/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { SendOnboardingModal } from "./send-modal";
import { accessStats, copyText, deleteForm, formUrl, sendForm, useOrigin } from "./shared";

export type Tab = "forms" | "templates" | "settings";

export interface FormRow {
  id: string;
  title: string;
  company_id: string | null;
  contact_id: string | null;
  template_id: string | null;
  status: FormStatus;
  progress: number;
  token: string;
  sections: Section[];
  answers: Answers;
  verified: Verified;
  sent_at: string;
  opened_at: string | null;
  last_activity_at: string | null;
  completed_at: string | null;
  reminded_at: string | null;
  remind_count: number;
  created_by: string | null;
}

type Filter = "all" | FormStatus | "access";

export function OnboardingHome({
  tab, forms, templates, settings, contacts, emailOn,
}: {
  tab: Tab;
  forms: FormRow[];
  templates: OnboardingTemplate[];
  settings: OnboardingSettings | null;
  contacts: { id: string; first_name: string; last_name: string; email: string }[];
  emailOn: boolean;
}) {
  const ws = useWorkspace();
  const [sending, setSending] = useState(false);
  const counts = useMemo(() => {
    const c = { sent: 0, in_progress: 0, completed: 0 };
    for (const f of forms) c[f.status]++;
    return c;
  }, [forms]);

  return (
    <div className="page">
      <PageHeader
        title="Onboarding clients"
        sub={
          forms.length
            ? `${counts.in_progress + counts.sent} en attente · ${counts.completed} terminé${counts.completed > 1 ? "s" : ""}`
            : "Envoie un formulaire à tes nouveaux clients : infos, objectifs, créas et accès, sans relance par email"
        }
      >
        {ws.canWrite && (
          <button className="btn btn-primary" onClick={() => setSending(true)}>
            <Send size={14} />
            Envoyer un formulaire
          </button>
        )}
      </PageHeader>

      <nav className="tabs onb-tabs" aria-label="Sections">
        <Link href={`${ws.base}/onboarding`} className={`tab${tab === "forms" ? " on" : ""}`} aria-current={tab === "forms" ? "page" : undefined}>
          Formulaires envoyés {forms.length > 0 && <span className="count">{forms.length}</span>}
        </Link>
        <Link href={`${ws.base}/onboarding?tab=templates`} className={`tab${tab === "templates" ? " on" : ""}`} aria-current={tab === "templates" ? "page" : undefined}>
          Modèles {templates.filter((t) => !t.archived).length > 0 && <span className="count">{templates.filter((t) => !t.archived).length}</span>}
        </Link>
        <Link href={`${ws.base}/onboarding?tab=settings`} className={`tab${tab === "settings" ? " on" : ""}`} aria-current={tab === "settings" ? "page" : undefined}>
          Réglages
        </Link>
      </nav>

      {tab === "forms" && <FormsList forms={forms} templates={templates} contacts={contacts} emailOn={emailOn} onSend={() => setSending(true)} />}
      {tab === "templates" && <TemplatesTab templates={templates} forms={forms} />}
      {tab === "settings" && <SettingsTab settings={settings} />}

      {sending && <SendOnboardingModal onClose={() => setSending(false)} emailOn={emailOn} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Formulaires envoyés
// ---------------------------------------------------------------------
function FormsList({
  forms, templates, contacts, emailOn, onSend,
}: {
  forms: FormRow[];
  templates: OnboardingTemplate[];
  contacts: { id: string; first_name: string; last_name: string; email: string }[];
  emailOn: boolean;
  onSend: () => void;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const mutate = useMutate();
  const origin = useOrigin();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<FormRow | null>(null);

  const rows = useMemo(
    () =>
      forms.map((f) => ({
        f,
        company: ws.company(f.company_id),
        contact: contacts.find((c) => c.id === f.contact_id),
        template: templates.find((t) => t.id === f.template_id),
        access: accessStats(f.sections, f.answers, f.verified),
        last: f.completed_at ?? f.last_activity_at ?? f.opened_at ?? f.sent_at,
      })),
    [forms, contacts, templates, ws],
  );
  const [now] = useState(() => Date.now());
  const stats = useMemo(() => {
    const m30 = now - 30 * 864e5;
    return {
      pending: rows.filter((r) => r.f.status !== "completed").length,
      progress: rows.filter((r) => r.f.status === "in_progress").length,
      done30: rows.filter((r) => r.f.completed_at && new Date(r.f.completed_at).getTime() >= m30).length,
      toVerify: rows.filter((r) => r.f.status === "completed" && r.access.checked < r.access.total).length,
      accessLeft: rows.filter((r) => r.f.status === "completed").reduce((n, r) => n + r.access.total - r.access.checked, 0),
    };
  }, [rows, now]);

  const shown = rows.filter((r) => {
    if (filter === "access" ? !(r.f.status === "completed" && r.access.checked < r.access.total) : filter !== "all" && r.f.status !== filter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (r.company?.name ?? "").toLowerCase().includes(s) || r.f.title.toLowerCase().includes(s) || `${r.contact?.first_name} ${r.contact?.last_name}`.toLowerCase().includes(s);
  });

  async function remind(f: FormRow) {
    try {
      const r = await sendForm(f.id, true);
      if (r.sent) toast(`Relance envoyée à ${r.email}`);
      else {
        const ok = await copyText(r.url);
        toast(ok ? "Lien copié : colle-le dans ton message de relance" : "Relance enregistrée");
      }
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { error: true });
    }
  }

  if (!forms.length)
    return (
      <div className="card">
        <EmptyState
          icon="list-checks"
          title="Aucun formulaire envoyé"
          text="Choisis un client et un modèle (e-commerce, génération de leads ou local) : il reçoit un lien, remplit à son rythme et tu es prévenu quand c'est terminé."
        >
          {ws.canWrite && (
            <button className="btn btn-primary" onClick={onSend}>
              <Send size={14} />
              Envoyer mon premier formulaire
            </button>
          )}
        </EmptyState>
      </div>
    );

  const FILTERS: { id: Filter; name: string; n: number }[] = [
    { id: "all", name: "Tous", n: rows.length },
    { id: "sent", name: "Envoyés", n: rows.filter((r) => r.f.status === "sent").length },
    { id: "in_progress", name: "En cours", n: stats.progress },
    { id: "completed", name: "Terminés", n: rows.filter((r) => r.f.status === "completed").length },
    { id: "access", name: "Accès à vérifier", n: stats.toVerify },
  ];

  return (
    <>
      <div className="stats onb-stats">
        <div className="stat">
          <div className="k">En attente du client</div>
          <div className="v">{stats.pending}</div>
          <div className="d">{stats.progress ? `dont ${stats.progress} commencé${stats.progress > 1 ? "s" : ""}` : "Aucun commencé"}</div>
        </div>
        <div className="stat">
          <div className="k">Terminés sur 30 jours</div>
          <div className="v">{stats.done30}</div>
          <div className="d">{rows.filter((r) => r.f.status === "completed").length} au total</div>
        </div>
        <div className="stat">
          <div className="k">Accès restant à vérifier</div>
          <div className="v">{stats.accessLeft}</div>
          <div className="d">{stats.toVerify ? `sur ${stats.toVerify} client${stats.toVerify > 1 ? "s" : ""}` : "Tout est vérifié"}</div>
        </div>
      </div>

      <div className="onb-toolbar">
        <div className="seg onb-seg" role="tablist" aria-label="Filtrer par statut">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
              {f.name}
              {f.n > 0 && <span className="faint num">{f.n}</span>}
            </button>
          ))}
        </div>
        <label className="onb-search">
          <Search size={14} aria-hidden />
          <input placeholder="Rechercher un client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        </label>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {shown.length === 0 ? (
          <EmptyState icon="search" title="Aucun formulaire ne correspond" text="Change de filtre ou de recherche." />
        ) : (
          <div className="onb-scroll">
            <table className="tbl onb-tbl">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Modèle</th>
                  <th>Statut</th>
                  <th>Accès</th>
                  <th>Dernière activité</th>
                  <th style={{ width: 44 }}>
                    <span className="sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ f, company, contact, template, access, last }) => {
                  const href = `${ws.base}/onboarding/${f.id}`;
                  const url = formUrl(origin, f.token);
                  return (
                    <tr key={f.id} className="onb-row" onClick={() => router.push(href)}>
                      <td>
                        <div className="onb-client">
                          <span className="onb-dot" style={{ ["--c" as string]: colorOf(company?.color) }} />
                          <div className="onb-client-t">
                            <Link href={href} onClick={(e) => e.stopPropagation()} className="trunc">
                              <strong>{company?.name ?? "Client supprimé"}</strong>
                            </Link>
                            <span className="trunc">{contact ? `${contact.first_name} ${contact.last_name}`.trim() || contact.email : "Sans contact"}</span>
                          </div>
                        </div>
                      </td>
                      <td className="faint trunc" style={{ maxWidth: 220 }}>
                        {template?.name ?? f.title.split(" · ")[0]}
                      </td>
                      <td>
                        <div className="onb-status">
                          <Badge color={FORM_STATUS[f.status].color}>
                            {f.status === "in_progress" ? `En cours · ${f.progress} %` : FORM_STATUS[f.status].name}
                          </Badge>
                          {f.status === "in_progress" && <Progress value={f.progress} color="var(--amber)" />}
                        </div>
                      </td>
                      <td>
                        {access.total ? (
                          <span className={`onb-acc-count${access.checked === access.total ? " ok" : ""}`} title={`${access.declared} déclaré${access.declared > 1 ? "s" : ""} par le client, ${access.checked} vérifié${access.checked > 1 ? "s" : ""} par l'agence`}>
                            <KeyRound size={13} />
                            <span className="num">
                              {f.status === "completed" ? `${access.checked} / ${access.total} vérifiés` : `${access.declared} / ${access.total} donnés`}
                            </span>
                          </span>
                        ) : (
                          <span className="fainter">–</span>
                        )}
                      </td>
                      <td className="faint" title={fmtDate(last.slice(0, 10), true)}>
                        {f.status === "completed" ? "Terminé" : f.last_activity_at ? "Rempli" : f.opened_at ? "Ouvert" : "Envoyé"} {ago(last)}
                        {f.remind_count > 0 && f.status !== "completed" && (
                          <span className="fainter">
                            {" "}· {f.remind_count} relance{f.remind_count > 1 ? "s" : ""}
                          </span>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Menu
                          align="end"
                          trigger={(open) => (
                            <button className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label="Actions">
                              <Ellipsis size={15} />
                            </button>
                          )}
                          items={[
                            { label: "Copier le lien", icon: <Copy size={14} />, onSelect: () => void copyText(url).then((ok) => toast(ok ? "Lien copié" : "Copie impossible")) },
                            { label: "Ouvrir la page client", icon: <ExternalLink size={14} />, onSelect: () => window.open(url, "_blank", "noopener") },
                            ...(f.status !== "completed" && ws.canWrite
                              ? [{ label: emailOn && contact?.email ? "Relancer par email" : "Relancer (copier le lien)", icon: <Send size={14} />, onSelect: () => void remind(f) }]
                              : []),
                            ...(ws.canWrite ? [{ separator: true, label: "" }, { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirm(f) }] : []),
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title="Supprimer ce formulaire ?"
          text="Les réponses et les fichiers déposés par le client seront définitivement supprimés, et le lien ne fonctionnera plus."
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await mutate((sb) => deleteForm(sb, confirm.id), { success: "Formulaire supprimé" });
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Modèles
// ---------------------------------------------------------------------
function TemplatesTab({ templates, forms }: { templates: OnboardingTemplate[]; forms: FormRow[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const [showArchived, setShowArchived] = useState(false);
  const active = templates.filter((t) => !t.archived);
  const archived = templates.filter((t) => t.archived);
  const list = showArchived ? archived : active;
  const used = (id: string) => forms.filter((f) => f.template_id === id).length;

  async function create(from?: OnboardingTemplate) {
    const created = await mutate(
      async (sb) =>
        must(
          await sb
            .from("onboarding_templates")
            .insert({
              workspace_id: ws.workspace.id,
              name: from ? `${from.name} (copie)` : "Nouveau modèle",
              description: from?.description ?? "",
              icon: from?.icon ?? "list-checks",
              position: templates.length,
              sections: JSON.parse(
                JSON.stringify(
                  from?.sections ?? [
                    {
                      id: uid("s"),
                      title: "Votre entreprise",
                      description: "",
                      questions: [{ id: uid(), type: "short", label: "Nom de l'entreprise", required: true }],
                    },
                  ],
                ),
              ),
            })
            .select("id")
            .single(),
        ),
      { success: from ? "Modèle dupliqué" : "Modèle créé", refresh: false },
    );
    if (created) router.push(`${ws.base}/onboarding/templates/${created.id}`);
  }

  return (
    <>
      <div className="onb-toolbar">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={!showArchived} className={!showArchived ? "on" : ""} onClick={() => setShowArchived(false)}>
            Actifs <span className="faint num">{active.length}</span>
          </button>
          <button role="tab" aria-selected={showArchived} className={showArchived ? "on" : ""} onClick={() => setShowArchived(true)}>
            Archivés <span className="faint num">{archived.length}</span>
          </button>
        </div>
        {ws.canWrite && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              onClick={() => void mutate(async (sb) => must(await sb.rpc("restore_onboarding_templates", { ws: ws.workspace.id })), { success: "Modèles par défaut restaurés" })}
              title="Recrée les modèles e-commerce, génération de leads et local s'ils ont été archivés ou supprimés"
            >
              <RotateCcw size={14} />
              Restaurer les modèles par défaut
            </button>
            <button className="btn btn-primary" onClick={() => void create()}>
              <Plus size={14} />
              Nouveau modèle
            </button>
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className="card">
          <EmptyState icon="list-checks" title={showArchived ? "Aucun modèle archivé" : "Aucun modèle actif"} text={showArchived ? undefined : "Restaure les modèles par défaut ou crée le tien."} />
        </div>
      ) : (
        <div className="onb-tpl-grid">
          {list.map((t) => (
            <article key={t.id} className="onb-tpl">
              <div className="onb-tpl-h">
                <span className="obj-ic" style={{ ["--s" as string]: "32px", ["--c" as string]: "var(--accent)" }}>
                  <Icon name={t.icon} size={17} />
                </span>
                <div>
                  <Link href={`${ws.base}/onboarding/templates/${t.id}`}>
                    <strong>{t.name}</strong>
                  </Link>
                  {t.key && <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>Fourni avec Agence OS</span>}
                </div>
                {ws.canWrite && (
                  <Menu
                    align="end"
                    trigger={(open) => (
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label="Actions">
                        <Ellipsis size={15} />
                      </button>
                    )}
                    items={[
                      { label: "Modifier", icon: <Pencil size={14} />, onSelect: () => router.push(`${ws.base}/onboarding/templates/${t.id}`) },
                      { label: "Dupliquer", icon: <Copy size={14} />, onSelect: () => void create(t) },
                      t.archived
                        ? { label: "Réactiver", icon: <RotateCcw size={14} />, onSelect: () => void mutate(async (sb) => must(await sb.from("onboarding_templates").update({ archived: false }).eq("id", t.id)), { success: "Modèle réactivé" }) }
                        : { label: "Archiver", icon: <Archive size={14} />, onSelect: () => void mutate(async (sb) => must(await sb.from("onboarding_templates").update({ archived: true }).eq("id", t.id)), { success: "Modèle archivé" }) },
                    ]}
                  />
                )}
              </div>
              {t.description && <p>{t.description}</p>}
              <div className="onb-tpl-meta">
                <span>{t.sections.length} étapes</span>
                <span>{questionCount(t.sections)} questions</span>
                <span>{used(t.id) ? `${used(t.id)} envoi${used(t.id) > 1 ? "s" : ""}` : "Jamais envoyé"}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------
function SettingsTab({ settings }: { settings: OnboardingSettings | null }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const initial = {
    meta_business_id: settings?.meta_business_id ?? "",
    google_mcc_id: settings?.google_mcc_id ?? "",
    access_email: settings?.access_email ?? "",
    intro: settings?.intro ?? "",
    auto_project: settings?.auto_project ?? true,
    auto_kpis: settings?.auto_kpis ?? true,
    auto_company: settings?.auto_company ?? true,
  };
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((x) => ({ ...x, [k]: v }));
  const disabled = !ws.canWrite;

  return (
    <form
      className="onb-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await mutate(
          async (sb) =>
            must(
              await sb.from("onboarding_settings").upsert(
                { workspace_id: ws.workspace.id, ...s, meta_business_id: s.meta_business_id.trim(), google_mcc_id: s.google_mcc_id.trim(), access_email: s.access_email.trim() },
                { onConflict: "workspace_id" },
              ),
            ),
          { success: "Réglages enregistrés" },
        );
        setBusy(false);
      }}
    >
      <section className="card">
        <div className="card-h">
          <h2>Identifiants de l&apos;agence</h2>
        </div>
        <div className="card-b">
          <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
            Affichés au client dans les tutoriels d&apos;accès, avec un bouton pour les copier. Ils remplacent les variables{" "}
            {PLACEHOLDERS.filter((p) => p.key !== "agence").map((p, i) => (
              <span key={p.key}>
                {i > 0 && ", "}
                <code className="mono">{`{${p.key}}`}</code>
              </span>
            ))}{" "}
            des modèles.
          </p>
          <div className="onb-grid2">
            <div className="field">
              <label htmlFor="st-bm">ID du Business Manager Meta de l&apos;agence</label>
              <input id="st-bm" className="input mono" inputMode="numeric" placeholder="1234567890123456" value={s.meta_business_id} disabled={disabled} onChange={(e) => set("meta_business_id", e.target.value)} />
              <span className="hint">Paramètres de l&apos;entreprise &gt; Informations sur l&apos;entreprise</span>
            </div>
            <div className="field">
              <label htmlFor="st-mcc">Compte administrateur Google Ads (MCC)</label>
              <input id="st-mcc" className="input mono" placeholder="123-456-7890" value={s.google_mcc_id} disabled={disabled} onChange={(e) => set("google_mcc_id", e.target.value)} />
              <span className="hint">Numéro affiché en haut à droite de ton compte administrateur</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="st-email">Email à inviter sur GA4, GTM, Search Console, Shopify…</label>
            <input id="st-email" className="input" type="email" placeholder="acces@mon-agence.fr" value={s.access_email} disabled={disabled} onChange={(e) => set("access_email", e.target.value)} />
            <span className="hint">Idéalement une adresse partagée de l&apos;agence. Vide : l&apos;email de la personne qui envoie le formulaire.</span>
          </div>
          {(!s.meta_business_id || !s.google_mcc_id) && (
            <div className="onb-warn">
              <CircleAlert size={15} />
              <span>Tant qu&apos;un identifiant manque, le client voit « information communiquée par l&apos;agence » à sa place.</span>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <h2>Envoi et automatisations par défaut</h2>
        </div>
        <div className="card-b">
          <div className="field">
            <label htmlFor="st-intro">Message d&apos;accueil par défaut</label>
            <textarea
              id="st-intro"
              className="textarea"
              rows={3}
              placeholder="Merci pour votre confiance ! Ce formulaire nous permet de préparer vos campagnes…"
              value={s.intro}
              disabled={disabled}
              onChange={(e) => set("intro", e.target.value)}
            />
            <span className="hint">Affiché en haut du formulaire et dans l&apos;email. Modifiable à chaque envoi.</span>
          </div>
          <label className="onb-toggle-row">
            <input type="checkbox" className="toggle" checked={s.auto_project} disabled={disabled} onChange={(e) => set("auto_project", e.target.checked)} />
            <span>
              Créer le projet d&apos;onboarding et une tâche « Vérifier l&apos;accès » par accès
              <small>Le projet part du modèle « Onboarding client » si le client n&apos;a aucun projet actif.</small>
            </span>
          </label>
          <label className="onb-toggle-row">
            <input type="checkbox" className="toggle" checked={s.auto_kpis} disabled={disabled} onChange={(e) => set("auto_kpis", e.target.checked)} />
            <span>
              Enregistrer le CPA et le ROAS cibles dans le reporting du client
              <small>Questions reliées à « KPI cible » dans l&apos;éditeur de modèle.</small>
            </span>
          </label>
          <label className="onb-toggle-row">
            <input type="checkbox" className="toggle" checked={s.auto_company} disabled={disabled} onChange={(e) => set("auto_company", e.target.checked)} />
            <span>Compléter le site web et le secteur de la fiche client s&apos;ils sont vides</span>
          </label>
        </div>
      </section>

      {ws.canWrite && (
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
            <Settings2 size={14} />
            {busy ? "Enregistrement…" : "Enregistrer les réglages"}
          </button>
        </div>
      )}
    </form>
  );
}
