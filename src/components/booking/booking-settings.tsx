"use client";

import "@/styles/booking.css";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Code, Copy, Ellipsis, ExternalLink, Info, Mail, Pencil, Plus, Trash2, UserRound } from "lucide-react";

import { SetCrumbs } from "@/components/shell/crumbs";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ConfirmModal, Menu } from "@/components/ui/overlay";
import type { loadBookingSettings } from "@/lib/booking/load";
import { LOCATION, durationLabel, slugify, type BookingType, type LocationKind } from "@/lib/booking/shared";
import { colorOf } from "@/lib/constants";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { AvailabilityEditor, OverridesEditor } from "./availability";
import { CopyButton, publicBase } from "./common";
import { CalcomConnector, GoogleCalendar } from "./connections";
import { TypeModal } from "./type-modal";

type Data = Awaited<ReturnType<typeof loadBookingSettings>>;
type Tab = "page" | "dispos" | "google" | "calcom";

const TABS: [Tab, string][] = [
  ["page", "Page et types"],
  ["dispos", "Disponibilités"],
  ["google", "Google Agenda"],
  ["calcom", "Cal.com"],
];

export function BookingSettings(d: Data) {
  const ws = useWorkspace();
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (TABS.some(([t]) => t === sp.get("tab")) ? sp.get("tab") : "page") as Tab;
  const flashError = sp.get("error");
  const flashGoogle = sp.get("google") === "ok";
  const p = d.profile;
  const canEdit = !!p && ws.canWrite && (d.isSelf || ws.isAdmin);
  const member = p ? ws.member(p.user_id) : undefined;
  const q = (t: Tab) => {
    const x = new URLSearchParams();
    x.set("tab", t);
    if (sp.get("m")) x.set("m", sp.get("m")!);
    return `${ws.base}/booking/settings?${x}`;
  };

  return (
    <div className="page">
      <SetCrumbs items={[{ label: "Rendez-vous", href: `${ws.base}/booking` }, { label: "Réglages" }]} />
      <PageHeader title="Réglages des rendez-vous" sub="Ta page de réservation, tes types de rendez-vous, tes disponibilités et tes agendas.">
        <Link href={`${ws.base}/booking`} className="btn">
          <ArrowLeft size={14} /> Rendez-vous
        </Link>
        {ws.isAdmin && d.profiles.length > 1 && (
          <Menu
            align="end"
            trigger={(open) => (
              <button className="btn" onClick={open}>
                {member ? <Avatar profile={member.profile} size={18} /> : <UserRound size={14} />}
                {d.isSelf ? "Ma page" : (member?.profile.full_name ?? "Membre")}
              </button>
            )}
            items={d.profiles.map((x) => {
              const m = ws.member(x.user_id);
              return {
                label: m?.profile.full_name || x.display_name || x.slug,
                icon: m ? <Avatar profile={m.profile} size={16} /> : undefined,
                checked: x.id === p?.id,
                onSelect: () => router.push(`${ws.base}/booking/settings?tab=${tab}&m=${x.user_id}`),
              };
            })}
          />
        )}
      </PageHeader>

      <div className="tabs">
        {TABS.map(([t, label]) => (
          <Link key={t} href={q(t)} className={`tab${tab === t ? " on" : ""}`} replace scroll={false}>
            {label}
          </Link>
        ))}
      </div>

      <div className="bk-set">
        {flashError && (
          <div className="bk-callout bad">
            <AlertTriangle size={15} />
            <span>{flashError}</span>
          </div>
        )}
        {flashGoogle && tab === "google" && (
          <div className="bk-callout ok">
            <CheckCircle2 size={15} />
            <span>Google Agenda est connecté. Choisis ci-dessous les agendas à utiliser.</span>
          </div>
        )}
        {!p ? (
          <div className="card">
            <EmptyState icon="calendar" title="Pas de page de réservation" text="Les invités de l'espace n'ont pas de page de réservation." />
          </div>
        ) : tab === "page" ? (
          <PageTab d={d} canEdit={canEdit} />
        ) : tab === "dispos" ? (
          <>
            <AvailabilityEditor key={`w-${p.id}`} profile={p} canEdit={canEdit} />
            <OverridesEditor profile={p} overrides={d.overrides} canEdit={canEdit} />
          </>
        ) : tab === "google" ? (
          <GoogleCalendar profile={p} isSelf={d.isSelf} google={d.google} configured={d.googleConfigured} appUrl={d.appUrl} />
        ) : (
          <CalcomConnector settings={d.settings} count={d.calcomCount} appUrl={d.appUrl} />
        )}
      </div>
    </div>
  );
}

function PageTab({ d, canEdit }: { d: Data; canEdit: boolean }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const p = d.profile!;
  const base = publicBase(d.appUrl);
  const [form, setForm] = useState({ display_name: p.display_name, headline: p.headline, welcome: p.welcome, slug: p.slug, active: p.active });
  const [editing, setEditing] = useState<BookingType | "new" | null>(null);
  const [del, setDel] = useState<BookingType | null>(null);
  const [embedType, setEmbedType] = useState<string>("");
  const dirty = form.display_name !== p.display_name || form.headline !== p.headline || form.welcome !== p.welcome || form.slug !== p.slug || form.active !== p.active;
  const link = `${base}/b/${p.slug}`;

  const saveProfile = () =>
    mutate(
      async (sb) => {
        const slug = slugify(form.slug).slice(0, 40);
        if (slug.length < 2) throw new Error("L'adresse doit faire au moins 2 caractères (lettres, chiffres, tirets).");
        const res = await sb
          .from("booking_profiles")
          .update({ display_name: form.display_name.trim(), headline: form.headline.trim(), welcome: form.welcome.trim(), slug, active: form.active })
          .eq("id", p.id);
        if (res.error?.code === "23505") throw new Error("Cette adresse est déjà prise, choisis-en une autre.");
        return must(res);
      },
      { success: "Page enregistrée" },
    );

  const toggleType = (t: BookingType) => mutate(async (sb) => must(await sb.from("booking_types").update({ active: !t.active }).eq("id", t.id)), { success: t.active ? "Type masqué de ta page" : "Type proposé sur ta page" });
  const duplicate = (t: BookingType) =>
    mutate(async (sb) => {
      const { id: _id, created_at: _c, demo: _d, ...rest } = t;
      void _id;
      void _c;
      void _d;
      let slug = `${t.slug}-copie`.slice(0, 60);
      for (let i = 2; d.types.some((x) => x.slug === slug); i++) slug = `${t.slug}-copie-${i}`.slice(0, 60);
      return must(await sb.from("booking_types").insert({ ...rest, name: `${t.name} (copie)`, slug, active: false, position: d.types.length }));
    }, { success: "Type dupliqué (masqué)" });

  const embedPath = embedType ? `/b/${p.slug}/${embedType}` : `/b/${p.slug}`;
  const snippet = `<iframe id="aos-booking" src="${base}${embedPath}?embed=1" style="width:100%;min-height:700px;border:0" loading="lazy" title="Prendre rendez-vous"></iframe>
<script>(function(){var f=document.getElementById("aos-booking"),u=new URL(f.src),q=new URLSearchParams(location.search);q.forEach(function(v,k){if(/^utm_|^(gclid|fbclid|ttclid|msclkid|_aos_id)$/.test(k))u.searchParams.set(k,v)});var m=document.cookie.match(/(?:^|; )_aos_id=([^;]+)/);if(m&&!u.searchParams.has("_aos_id"))u.searchParams.set("_aos_id",m[1]);u.searchParams.set("ref",location.href.split("#")[0]);f.src=u.toString();addEventListener("message",function(e){if(e.origin===u.origin&&e.data&&e.data.type==="aos-booking:height")f.style.height=e.data.height+"px"})})();</script>`;

  return (
    <>
      {!d.emailOn && (
        <div className="bk-callout">
          <Mail size={15} />
          <span>
            Les emails ne sont pas configurés (<code>RESEND_API_KEY</code>, <code>EMAIL_FROM</code>) : pas de confirmation ni de rappel par email. Le prospect peut ajouter le rendez-vous à son agenda
            depuis la page de confirmation, et tu es notifié dans l&apos;app.
          </span>
        </div>
      )}

      <section className="bk-sec">
        <h2>
          Ta page de réservation
          <span className="aside bk-inline">
            <CopyButton text={link} small label="Copier le lien" msg="Lien copié" />
            <a className="btn btn-sm" href={link} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Ouvrir
            </a>
          </span>
        </h2>
        <div className="bk-g2">
          <div className="field">
            <label htmlFor="bp-slug">Adresse</label>
            <div className="bk-prefix">
              <span>{base.replace(/^https?:\/\//, "")}/b/</span>
              <input id="bp-slug" className="input" disabled={!canEdit} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="bp-name">Nom affiché</label>
            <input id="bp-name" className="input" disabled={!canEdit} value={form.display_name} placeholder={ws.member(p.user_id)?.profile.full_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="bp-head">Accroche</label>
            <input id="bp-head" className="input" disabled={!canEdit} value={form.headline} placeholder="Media buyer freelance · Meta et Google Ads" onChange={(e) => setForm({ ...form, headline: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="bp-wel">Message d&apos;accueil</label>
            <input id="bp-wel" className="input" disabled={!canEdit} value={form.welcome} placeholder="Choisissez le créneau qui vous arrange." onChange={(e) => setForm({ ...form, welcome: e.target.value })} />
          </div>
        </div>
        <div className="bk-inline" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <label className="bk-inline" style={{ fontSize: "var(--fs-sm)" }}>
            <input type="checkbox" className="toggle" disabled={!canEdit} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Page en ligne
          </label>
          <button className="btn btn-primary btn-sm" disabled={!canEdit || !dirty} onClick={saveProfile}>
            Enregistrer
          </button>
        </div>
      </section>

      <section className="bk-sec">
        <h2>
          Types de rendez-vous
          {canEdit && (
            <span className="aside">
              <button className="btn btn-sm" onClick={() => setEditing("new")}>
                <Plus size={13} /> Nouveau type
              </button>
            </span>
          )}
        </h2>
        {d.types.length ? (
          <div className="bk-tcards">
            {d.types.map((t) => (
              <div key={t.id} className={`bk-tcard${t.active ? "" : " off"}`} style={{ ["--c" as string]: colorOf(t.color) }}>
                <span className="bar" />
                <span className="tx">
                  <b className="trunc">{t.name}</b>
                  <span>
                    {durationLabel(t.duration_min)} · {LOCATION[t.location_kind as LocationKind]?.name}
                    {t.create_deal ? " · deal au CRM" : ""}
                    {t.daily_limit ? ` · ${t.daily_limit} par jour max.` : ""}
                    {t.active ? "" : " · masqué"}
                  </span>
                </span>
                <CopyButton text={`${base}/b/${p.slug}/${t.slug}`} small label="Lien" msg="Lien du type copié" />
                {canEdit && (
                  <>
                    <input type="checkbox" className="toggle" aria-label="Proposé sur ta page" title="Proposé sur ta page" checked={t.active} onChange={() => toggleType(t)} />
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label="Modifier" onClick={() => setEditing(t)}>
                      <Pencil size={13} />
                    </button>
                    <Menu
                      align="end"
                      trigger={(open) => (
                        <button className="btn btn-ghost btn-sm btn-icon" aria-label="Plus d'actions" onClick={open}>
                          <Ellipsis size={14} />
                        </button>
                      )}
                      items={[
                        { label: "Dupliquer", icon: <Copy size={13} />, onSelect: () => duplicate(t) },
                        { label: "Supprimer", icon: <Trash2 size={13} />, danger: true, onSelect: () => setDel(t) },
                      ]}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="calendar" title="Aucun type de rendez-vous" text="Crée ton premier type (appel découverte, point client…) pour ouvrir ta page.">
            {canEdit && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                <Plus size={14} /> Nouveau type
              </button>
            )}
          </EmptyState>
        )}
      </section>

      <section className="bk-sec">
        <h2>
          <Code size={16} /> Intégrer sur ton site
        </h2>
        <p className="lead">
          Colle ce code dans une page de ton site ou d&apos;une landing. Le calendrier s&apos;ajuste en hauteur, reprend les UTM de la page et l&apos;identifiant du script de tracking : si le site de ton
          agence est suivi dans Attribution, chaque rendez-vous y compte comme conversion « booking ».
        </p>
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor="bk-embed">Rendez-vous proposé</label>
          <select id="bk-embed" className="select" value={embedType} onChange={(e) => setEmbedType(e.target.value)}>
            <option value="">Tous les types (page complète)</option>
            {d.types
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.slug}>{t.name}</option>
              ))}
          </select>
        </div>
        <pre className="bk-code">{snippet}</pre>
        <div className="bk-inline" style={{ flexWrap: "wrap" }}>
          <CopyButton text={snippet} label="Copier le code" msg="Code d'intégration copié" primary />
          <a className="btn" href={`${base}${embedPath}?embed=1`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Aperçu intégré
          </a>
        </div>
        <div className="bk-callout">
          <Info size={15} />
          <span>
            Lien direct dans une publicité ou un email : ajoute tes UTM à l&apos;adresse (ex. <code>{`${base}${embedPath}?utm_source=facebook&utm_medium=paid_social&utm_campaign=rdv`}</code>). Ils deviennent la
            source du deal.
          </span>
        </div>
      </section>

      {editing && (
        <TypeModal
          type={editing === "new" ? null : editing}
          profileId={p.id}
          workspaceId={p.workspace_id}
          nextPosition={d.types.length}
          googleOn={!!d.google}
          onClose={() => setEditing(null)}
        />
      )}
      {del && (
        <ConfirmModal
          title={`Supprimer « ${del.name} » ?`}
          text="Le lien de ce type ne fonctionnera plus. Les rendez-vous déjà réservés sont conservés."
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("booking_types").delete().eq("id", del.id)), { success: "Type supprimé" });
          }}
        />
      )}
    </>
  );
}
