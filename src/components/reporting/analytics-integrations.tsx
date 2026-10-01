"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Flame, Info, KeyRound, Link2, MonitorPlay, Plus, RefreshCw, Search, Unplug, X } from "lucide-react";

import "@/styles/reporting.css";
import { CompanyPicker } from "@/components/pickers";
import { Badge } from "@/components/ui/misc";
import { ConfirmModal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import type { AvailableAccount, ConnectionPublic } from "@/lib/ads/types";
import { CLARITY_MIN_INTERVAL_H, CLARITY_REQUESTS_PER_SYNC, clarityLinks } from "@/lib/analytics/clarity-rows";
import type { AnalyticsSource } from "@/lib/analytics/types";
import { ago, fmtDate } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { useSync } from "./common";

// Cartes « Google Analytics 4 » et « Microsoft Clarity » de Réglages > Connexions.
// Mêmes états que Meta Ads et Google Ads : non configuré côté serveur (avec le pas à pas),
// non connecté, connecté, en erreur. Aucun jeton ne transite par le navigateur après l'envoi.

/** Jours restants avant une échéance (négatif si dépassée). */
const daysUntil = (ts: string) => Math.round((new Date(ts).getTime() - Date.now()) / 864e5);

const GA4_COLOR = "var(--viz-4)";
const CLARITY_COLOR = "var(--viz-7)";

export interface AnalyticsStatus {
  ga4: { configured: boolean; missing: string[] };
  redirect: string;
}

// =====================================================================
// Google Analytics 4
// =====================================================================
export function Ga4Card({ status, connections, sources, activeConnIds }: { status: AnalyticsStatus; connections: ConnectionPublic[]; sources: AnalyticsSource[]; activeConnIds: string[] }) {
  const ws = useWorkspace();
  const st = status.ga4;
  const startUrl = `/api/integrations/ga4/start?ws=${encodeURIComponent(ws.workspace.slug)}`;
  const tracked = sources.filter((s) => s.kind === "ga4" && !s.is_demo);
  const failing = tracked.some((s) => s.sync_error) || connections.some((c) => c.last_error);

  return (
    <div className="card" id="ga4">
      <div className="card-h">
        <div className="head">
          <span className="logo" style={{ background: GA4_COLOR }} aria-hidden>
            A
          </span>
          <div>
            <h2>Google Analytics 4</h2>
            <p>Trafic du site : sessions, canaux, sources, pages de destination, évènements clés et revenu, par jour.</p>
          </div>
        </div>
        {connections.length ? (
          failing ? <Badge color="var(--red)">En erreur</Badge> : <Badge color="var(--green)">Connecté</Badge>
        ) : !st.configured ? (
          <Badge color="var(--gray)">Non configuré</Badge>
        ) : (
          <Badge color="var(--amber)">Non connecté</Badge>
        )}
      </div>

      {!st.configured && connections.length > 0 && (
        <div className="card-b">
          <div className="rp-note warn">
            <Info size={15} />
            <span>
              Variables manquantes sur le serveur : <code>{st.missing.join(", ")}</code>. La synchronisation de Google Analytics échouera tant qu&apos;elles ne sont pas renseignées.
            </span>
          </div>
        </div>
      )}

      {!st.configured && !connections.length ? (
        <div className="card-b">
          <div className="rp-note warn">
            <Info size={15} />
            <div>
              <p>
                L&apos;administrateur du serveur doit d&apos;abord renseigner : <code>{st.missing.join(", ")}</code>. C&apos;est le même client OAuth que Google Ads : s&apos;il est déjà configuré, il n&apos;y a que les étapes 1 et 2 à faire.
              </p>
              <ol className="rp-steps">
                <li>Sur console.cloud.google.com, dans le projet du client OAuth, active « Google Analytics Data API » et « Google Analytics Admin API » (API et services &gt; Bibliothèque).</li>
                <li>
                  Dans l&apos;identifiant OAuth « Application Web », ajoute l&apos;URI de redirection : <code>{status.redirect}</code>
                </li>
                <li>
                  Sur l&apos;écran de consentement, ajoute le champ d&apos;application <code>…/auth/analytics.readonly</code> et publie l&apos;application (en mode Test, l&apos;accès expire au bout de 7 jours).
                </li>
                <li>
                  Renseigne <code>GOOGLE_CLIENT_ID</code> et <code>GOOGLE_CLIENT_SECRET</code>, puis redéploie. Aucun jeton développeur n&apos;est nécessaire pour Analytics.
                </li>
              </ol>
            </div>
          </div>
        </div>
      ) : !connections.length ? (
        <div className="card-b" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Accès en lecture seule aux propriétés du compte Google. Les jetons restent sur le serveur, jamais dans le navigateur.
          </span>
          {ws.isAdmin ? (
            <a className="btn btn-primary" href={startUrl}>
              <Link2 size={14} /> Connecter Google Analytics
            </a>
          ) : (
            <span className="faint" style={{ fontSize: 12.5 }}>Demande à un admin de l&apos;espace de connecter Google Analytics.</span>
          )}
        </div>
      ) : (
        <>
          {connections.map((c) => (
            <Ga4Connection key={c.id} conn={c} sources={sources} activeConnIds={activeConnIds} />
          ))}
          {ws.isAdmin && (
            <div className="who" style={{ justifyContent: "flex-start" }}>
              <a className="btn btn-ghost btn-sm" href={startUrl}>
                <Link2 size={13} /> Connecter un autre compte Google
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Ga4Connection({ conn, sources, activeConnIds }: { conn: ConnectionPublic; sources: AnalyticsSource[]; activeConnIds: string[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<"refresh" | "delete" | null>(null);
  const [confirm, setConfirm] = useState(false);

  const tracked = useMemo(() => new Map(sources.filter((s) => s.kind === "ga4").map((s) => [s.external_id, s])), [sources]);
  const list = conn.accounts ?? [];
  const filtered = list
    .filter((a) => !q || `${a.name} ${a.external_id} ${a.manager_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(tracked.has(b.external_id)) - Number(tracked.has(a.external_id)));
  const trackedHere = sources.filter((s) => s.connection_id === conn.id).length;

  const refresh = async () => {
    setBusy("refresh");
    const res = await fetch(`/api/integrations/connections/${conn.id}`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { accounts?: number; error?: string };
    setBusy(null);
    if (!res.ok) toast(json.error || "Actualisation impossible", { error: true });
    else toast(`${json.accounts} propriété${json.accounts === 1 ? "" : "s"} accessible${json.accounts === 1 ? "" : "s"}`);
    router.refresh();
  };

  const disconnect = async () => {
    setBusy("delete");
    const res = await fetch(`/api/integrations/connections/${conn.id}`, { method: "DELETE" });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!res.ok) toast(json.error || "Déconnexion impossible", { error: true });
    else toast("Connexion supprimée, l'historique est conservé");
    router.refresh();
  };

  return (
    <>
      <div className="who">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }} className="trunc">
            {conn.label || "Compte Google"}
          </div>
          <div className="faint" style={{ fontSize: 12, display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
            <span suppressHydrationWarning>Connecté {ago(conn.created_at)}</span>
            <span>
              {list.length} propriété{list.length > 1 ? "s" : ""} accessible{list.length > 1 ? "s" : ""}, {trackedHere} suivie{trackedHere > 1 ? "s" : ""}
            </span>
            <span>Accès permanent (refresh token)</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ws.canWrite && (
            <button className="btn btn-sm" onClick={refresh} disabled={busy !== null}>
              <RefreshCw size={12} className={busy === "refresh" ? "rp-spin" : undefined} /> Actualiser la liste
            </button>
          )}
          {ws.isAdmin && (
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)} disabled={busy !== null} style={{ color: "var(--red)" }}>
              <Unplug size={12} /> Déconnecter
            </button>
          )}
        </div>
      </div>
      {conn.last_error && (
        <div className="who" style={{ paddingTop: 0, borderTop: 0 }}>
          <div className="rp-note err" style={{ width: "100%" }}>
            <AlertTriangle size={15} style={{ color: "var(--red)" }} />
            <span>{conn.last_error}</span>
          </div>
        </div>
      )}

      {list.length > 6 && (
        <div className="who" style={{ gap: 8 }}>
          <label className="searchbox" style={{ flex: 1, minWidth: 180, width: "auto", background: "var(--surface)" }}>
            <Search size={13} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher une propriété (nom, compte ou identifiant)…"
              aria-label="Rechercher une propriété"
              style={{ border: 0, outline: 0, background: "transparent", width: "100%", fontSize: 12.5 }}
            />
          </label>
        </div>
      )}

      {filtered.map((a) => (
        <Ga4PropertyRow key={a.external_id} conn={conn} property={a} tracked={tracked.get(a.external_id)} activeConnIds={activeConnIds} />
      ))}
      {!list.length && !conn.last_error && (
        <div className="who faint" style={{ fontSize: 12.5 }}>
          Aucune propriété GA4 accessible avec ce compte Google. Vérifie qu&apos;il a au moins le rôle Lecteur sur la propriété du client, puis actualise la liste.
        </div>
      )}
      {list.length > 0 && !filtered.length && <div className="who faint" style={{ fontSize: 12.5 }}>Aucune propriété ne correspond à ta recherche.</div>}

      {confirm && (
        <ConfirmModal
          title={`Déconnecter ${conn.label || "Google Analytics"} ?`}
          text="Les jetons d'accès sont supprimés et la synchronisation s'arrête. Les propriétés suivies et tout leur historique restent disponibles dans le reporting."
          confirmLabel="Déconnecter"
          onClose={() => setConfirm(false)}
          onConfirm={disconnect}
        />
      )}
    </>
  );
}

function Ga4PropertyRow({ conn, property, tracked, activeConnIds }: { conn: ConnectionPublic; property: AvailableAccount; tracked: AnalyticsSource | undefined; activeConnIds: string[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const { run, busy } = useSync();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [events, setEvents] = useState<string[] | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const isTracked = !!tracked;
  const elsewhere = !!tracked && !!tracked.connection_id && tracked.connection_id !== conn.id && activeConnIds.includes(tracked.connection_id);
  const detached = !!tracked && tracked.connection_id !== conn.id && !elsewhere;
  const keyEvent = tracked?.settings?.key_event ?? "";

  const track = async () => {
    setPending(true);
    const row = await mutate(
      async (sb) =>
        must(
          await sb
            .from("analytics_sources")
            .upsert(
              { workspace_id: ws.workspace.id, kind: "ga4", connection_id: conn.id, external_id: property.external_id, name: property.name },
              { onConflict: "workspace_id,kind,external_id" },
            )
            .select("id")
            .single(),
        ),
    );
    setPending(false);
    if (row?.id) {
      toast(`${property.name} suivie : import des 90 derniers jours…`);
      await run(undefined, { sourceId: row.id, quiet: true });
    }
  };

  const reattach = () =>
    mutate(async (sb) => must(await sb.from("analytics_sources").update({ connection_id: conn.id, sync_error: null }).eq("id", tracked!.id)), { success: "Propriété rattachée à cette connexion" });

  const untrack = async () => {
    await mutate(async (sb) => must(await sb.from("analytics_sources").delete().eq("id", tracked!.id)), { success: "Propriété retirée du suivi" });
  };

  const setCompany = (company_id: string | null) =>
    mutate(async (sb) => must(await sb.from("analytics_sources").update({ company_id }).eq("id", tracked!.id)), { success: company_id ? "Client associé" : "Client retiré" });

  const loadEvents = async () => {
    if (events || loadingEvents || !tracked) return;
    setLoadingEvents(true);
    const res = await fetch(`/api/integrations/ga4/key-events?source=${tracked.id}`);
    const json = (await res.json().catch(() => ({}))) as { events?: { name: string }[]; error?: string };
    setLoadingEvents(false);
    if (!res.ok) toast(json.error || "Lecture des évènements clés impossible", { error: true });
    else setEvents((json.events ?? []).map((e) => e.name));
  };

  // Changer de conversion : les 90 jours sont relus avec le nouvel évènement clé
  const setKeyEvent = async (value: string) => {
    if (!tracked) return;
    const ok = await mutate(
      async (sb) => {
        must(await sb.from("analytics_sources").update({ settings: { ...tracked.settings, key_event: value || null }, first_synced_at: null }).eq("id", tracked.id));
        return true;
      },
      { success: value ? `Conversion principale : ${value}. Réimport des 90 jours…` : "Conversion : tous les évènements clés. Réimport des 90 jours…" },
    );
    if (ok) await run(undefined, { sourceId: tracked.id, full: true, quiet: true });
  };

  const syncing = busy !== null || pending;
  const options = [...new Set([...(events ?? []), ...(keyEvent ? [keyEvent] : [])])];

  return (
    <div className="acc">
      <input
        type="checkbox"
        className="check"
        checked={isTracked}
        disabled={!ws.canWrite || syncing || elsewhere}
        onChange={() => (isTracked ? setConfirm(true) : track())}
        aria-label={`Suivre ${property.name}`}
      />
      <div className="nm">
        <div className="t trunc">{property.name}</div>
        <div className="s">
          <span className="mono">{property.external_id}</span>
          {property.manager_name && <span>{property.manager_name}</span>}
          {tracked && !elsewhere && !detached && (
            <span suppressHydrationWarning>{syncing ? "Synchronisation…" : tracked.last_synced_at ? `Synchronisée ${ago(tracked.last_synced_at)}` : "Jamais synchronisée"}</span>
          )}
          {elsewhere && <span>Suivie via une autre connexion</span>}
        </div>
      </div>
      {tracked && !elsewhere ? (
        detached ? (
          <button className="btn btn-sm" onClick={reattach} disabled={!ws.canWrite}>
            Rattacher
          </button>
        ) : (
          <CompanyPicker value={tracked.company_id} onChange={ws.canWrite ? setCompany : () => {}} />
        )
      ) : (
        <span />
      )}
      {tracked && !elsewhere && !detached && ws.canWrite ? (
        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => run(undefined, { sourceId: tracked.id })} disabled={syncing} title="Synchroniser maintenant" aria-label={`Synchroniser ${property.name}`}>
          <RefreshCw size={13} className={syncing ? "rp-spin" : undefined} />
        </button>
      ) : (
        <span />
      )}
      {tracked && !elsewhere && !detached && (
        <label className="opt">
          Conversion principale
          <select
            className="select"
            value={keyEvent}
            disabled={!ws.canWrite || syncing}
            onFocus={loadEvents}
            onMouseDown={loadEvents}
            onChange={(e) => setKeyEvent(e.target.value)}
            aria-label={`Conversion principale de ${property.name}`}
          >
            <option value="">Tous les évènements clés</option>
            {options.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            {loadingEvents && <option disabled>Chargement…</option>}
          </select>
          <span>sert au taux de conversion du site</span>
        </label>
      )}
      {tracked?.sync_error && !elsewhere && <div className="err">{tracked.sync_error}</div>}
      {tracked && !tracked.company_id && !elsewhere && !detached && <div className="err" style={{ color: "var(--amber)" }}>Associe un client pour voir cette propriété dans le reporting.</div>}
      {confirm && (
        <ConfirmModal
          title={`Ne plus suivre ${property.name} ?`}
          text="La propriété sort du reporting et son historique est supprimé. Tu pourras la suivre à nouveau (90 jours seront réimportés)."
          confirmLabel="Ne plus suivre"
          onClose={() => setConfirm(false)}
          onConfirm={untrack}
        />
      )}
    </div>
  );
}

// =====================================================================
// Microsoft Clarity
// =====================================================================
export function ClarityCard({ sources }: { sources: AnalyticsSource[] }) {
  const ws = useWorkspace();
  const projects = sources.filter((s) => s.kind === "clarity" && !s.is_demo);
  const [adding, setAdding] = useState(false);
  const failing = projects.some((s) => s.sync_error);

  return (
    <div className="card" id="clarity">
      <div className="card-h">
        <div className="head">
          <span className="logo" style={{ background: CLARITY_COLOR }} aria-hidden>
            C
          </span>
          <div>
            <h2>Microsoft Clarity</h2>
            <p>Comportement sur le site : clics de rage, clics morts, retours rapides, défilement, erreurs de script, par page et par appareil.</p>
          </div>
        </div>
        {projects.length ? failing ? <Badge color="var(--red)">En erreur</Badge> : <Badge color="var(--green)">Connecté</Badge> : <Badge color="var(--amber)">Non connecté</Badge>}
      </div>

      <div className="card-b">
        <div className="rp-note">
          <Info size={15} />
          <span>
            Les données Clarity commencent le jour où tu ajoutes le projet : son API ne donne que les 3 derniers jours, sans historique, et
            10 requêtes par projet et par jour. Agence OS enregistre donc un instantané par jour ({CLARITY_REQUESTS_PER_SYNC} requêtes), au plus toutes les {CLARITY_MIN_INTERVAL_H} heures.
          </span>
        </div>
      </div>

      {projects.map((s) => (
        <ClarityProjectRow key={s.id} source={s} />
      ))}

      {!projects.length && !adding && (
        <div className="card-b">
          <ol className="rp-steps" style={{ fontSize: 13, color: "var(--text-2)" }}>
            <li>Dans Clarity, ouvre le projet du client puis Settings &gt; Data Export &gt; Generate new API token (réservé aux admins du projet).</li>
            <li>Copie le jeton, et l&apos;identifiant du projet visible dans l&apos;adresse : clarity.microsoft.com/projects/view/<b>identifiant</b>/dashboard.</li>
            <li>Ajoute le projet ici et associe-le au client : le premier instantané est pris aussitôt.</li>
          </ol>
        </div>
      )}

      {adding ? (
        <ClarityForm onClose={() => setAdding(false)} />
      ) : (
        <div className="who" style={{ justifyContent: "flex-start" }}>
          {ws.isAdmin ? (
            <button className={projects.length ? "btn btn-ghost btn-sm" : "btn btn-primary"} onClick={() => setAdding(true)}>
              <Plus size={13} /> Ajouter un projet Clarity
            </button>
          ) : (
            <span className="faint" style={{ fontSize: 12.5 }}>Demande à un admin de l&apos;espace d&apos;ajouter un projet Clarity.</span>
          )}
        </div>
      )}
    </div>
  );
}

function ClarityForm({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", project_id: "", token: "", company_id: null as string | null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = form.project_id.trim().length >= 6 && form.token.trim().length >= 20;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/clarity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: ws.workspace.id, ...form, name: form.name.trim() || undefined }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; rows?: number; warning?: string | null; error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "Ajout impossible");
      return;
    }
    toast(json.warning ? `Projet ajouté. ${json.warning}` : json.rows ? "Projet ajouté, premier instantané enregistré" : "Projet ajouté. Aucune session sur les dernières 24 heures : le suivi commence maintenant.", { error: !!json.warning });
    onClose();
    router.refresh();
  };

  return (
    <form className="rp-form" onSubmit={submit}>
      <label className="field">
        <span className="label">Nom du projet</span>
        <input className="input" value={form.name} maxLength={80} placeholder="Site du client" onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <div className="field">
        <span className="label">Client</span>
        <CompanyPicker value={form.company_id} onChange={(company_id) => setForm({ ...form, company_id })} />
      </div>
      <label className="field wide">
        <span className="label">Identifiant du projet</span>
        <input className="input mono" value={form.project_id} placeholder="abcd1234ef, ou l'adresse du projet dans Clarity" autoComplete="off" spellCheck={false} onChange={(e) => setForm({ ...form, project_id: e.target.value })} />
        <span className="hint">Il figure dans l&apos;adresse du projet : clarity.microsoft.com/projects/view/identifiant/dashboard. Tu peux coller l&apos;adresse entière.</span>
      </label>
      <label className="field wide">
        <span className="label">Jeton API (Data Export)</span>
        <input className="input mono" type="password" value={form.token} placeholder="Colle le jeton généré dans Clarity" autoComplete="off" spellCheck={false} onChange={(e) => setForm({ ...form, token: e.target.value })} />
        <span className="hint">Clarity &gt; Settings &gt; Data Export &gt; Generate new API token. Le jeton est enregistré sur le serveur et n&apos;est plus jamais affiché.</span>
      </label>
      {error && (
        <div className="rp-note err wide" role="alert">
          <AlertTriangle size={15} style={{ color: "var(--red)" }} />
          <span>{error}</span>
        </div>
      )}
      <div className="foot">
        <span className="faint" style={{ fontSize: 12, marginRight: "auto" }}>L&apos;ajout vérifie le jeton en prenant le premier instantané ({CLARITY_REQUESTS_PER_SYNC} requêtes).</span>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
          {busy ? "Vérification…" : "Ajouter le projet"}
        </button>
      </div>
    </form>
  );
}

function ClarityProjectRow({ source }: { source: AnalyticsSource }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const router = useRouter();
  const toast = useToast();
  const { run, busy } = useSync();
  const [confirm, setConfirm] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const links = clarityLinks(source.external_id);
  const exp = source.settings?.token_exp ?? null;
  const expSoon = exp ? daysUntil(exp) < 30 : false;
  const syncing = busy !== null;

  const replace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim().length < 20) return;
    setSaving(true);
    const res = await fetch(`/api/integrations/clarity/${source.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setSaving(false);
    if (!res.ok) return toast(json.error || "Remplacement impossible", { error: true });
    toast("Jeton remplacé : il servira à la prochaine synchronisation");
    setToken("");
    setTokenOpen(false);
    router.refresh();
  };

  return (
    <div className="acc">
      <span className="rp-dot" style={{ ["--c" as string]: CLARITY_COLOR, marginLeft: 3 }} aria-hidden />
      <div className="nm">
        <div className="t trunc">{source.name}</div>
        <div className="s">
          <span className="mono">{source.external_id}</span>
          <span suppressHydrationWarning>
            {syncing ? "Synchronisation…" : source.last_synced_at ? `Dernier instantané ${ago(source.last_synced_at)}` : "Aucun instantané pour l'instant"}
          </span>
          {source.first_synced_at && <span>Données depuis le {fmtDate(source.first_synced_at.slice(0, 10), true)}</span>}
          {exp && expSoon && <span style={{ color: "var(--red)" }}>Jeton valable jusqu&apos;au {fmtDate(exp.slice(0, 10), true)}</span>}
        </div>
      </div>
      <CompanyPicker
        value={source.company_id}
        onChange={(company_id) => ws.canWrite && mutate(async (sb) => must(await sb.from("analytics_sources").update({ company_id }).eq("id", source.id)), { success: company_id ? "Client associé" : "Client retiré" })}
      />
      <span className="links">
        <a className="btn btn-sm btn-ghost btn-icon" href={links.dashboard} target="_blank" rel="noreferrer" title="Tableau de bord Clarity" aria-label={`Tableau de bord Clarity de ${source.name}`}>
          <ExternalLink size={13} />
        </a>
        <a className="btn btn-sm btn-ghost btn-icon" href={links.recordings} target="_blank" rel="noreferrer" title="Enregistrements de sessions" aria-label={`Enregistrements de sessions de ${source.name}`}>
          <MonitorPlay size={13} />
        </a>
        <a className="btn btn-sm btn-ghost btn-icon" href={links.heatmaps} target="_blank" rel="noreferrer" title="Cartes de chaleur" aria-label={`Cartes de chaleur de ${source.name}`}>
          <Flame size={13} />
        </a>
        {ws.canWrite && (
          <button className="btn btn-sm btn-ghost btn-icon" onClick={() => run(undefined, { sourceId: source.id })} disabled={syncing} title="Prendre l'instantané du jour" aria-label={`Synchroniser ${source.name}`}>
            <RefreshCw size={13} className={syncing ? "rp-spin" : undefined} />
          </button>
        )}
        {ws.isAdmin && (
          <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setTokenOpen((v) => !v)} title="Remplacer le jeton API" aria-label={`Remplacer le jeton API de ${source.name}`} aria-expanded={tokenOpen}>
            <KeyRound size={13} />
          </button>
        )}
        {ws.canWrite && (
          <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirm(true)} title="Supprimer" aria-label={`Supprimer ${source.name}`}>
            <X size={13} />
          </button>
        )}
      </span>
      {tokenOpen && (
        <form className="opt" onSubmit={replace} style={{ gap: 6 }}>
          <input className="input mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Nouveau jeton API Clarity" autoComplete="off" spellCheck={false} aria-label="Nouveau jeton API" style={{ flex: 1, minWidth: 180, height: 28, fontSize: 12 }} />
          <button className="btn btn-sm btn-primary" type="submit" disabled={saving || token.trim().length < 20}>
            {saving ? "Enregistrement…" : "Remplacer"}
          </button>
        </form>
      )}
      {source.sync_error && <div className="err">{source.sync_error}</div>}
      {!source.company_id && <div className="err" style={{ color: "var(--amber)" }}>Associe un client pour voir ce projet dans le reporting.</div>}
      {confirm && (
        <ConfirmModal
          title={`Supprimer ${source.name} ?`}
          text="Le jeton et tous les instantanés enregistrés sont supprimés. Clarity ne donnant aucun historique, ils ne pourront pas être récupérés."
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("analytics_sources").delete().eq("id", source.id)), { success: "Projet supprimé" });
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Sources hors connexion active (démo, connexion Google supprimée)
// =====================================================================
export function OtherSources({ sources, activeConnIds }: { sources: AnalyticsSource[]; activeConnIds: string[] }) {
  const others = sources.filter((s) => s.is_demo || (s.kind === "ga4" && (!s.connection_id || !activeConnIds.includes(s.connection_id))));
  if (!others.length) return null;
  return (
    <div className="card">
      <div className="card-h">
        <div className="head">
          <div>
            <h2>Sources d&apos;analytics sans connexion et de démonstration</h2>
            <p>Propriétés GA4 dont la connexion a été supprimée (l&apos;historique est conservé, la synchro est arrêtée) et sources générées pour la démo.</p>
          </div>
        </div>
      </div>
      {others.map((s) => (
        <OtherSourceRow key={s.id} source={s} />
      ))}
    </div>
  );
}

function OtherSourceRow({ source }: { source: AnalyticsSource }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="acc">
      <span className="rp-dot" style={{ ["--c" as string]: source.kind === "ga4" ? GA4_COLOR : CLARITY_COLOR, marginLeft: 3 }} aria-hidden />
      <div className="nm">
        <div className="t trunc">{source.name}</div>
        <div className="s">
          <span>{source.kind === "ga4" ? "Google Analytics 4" : "Microsoft Clarity"}</span>
          <span>{source.is_demo ? "Démo" : "Sans connexion"}</span>
        </div>
      </div>
      <CompanyPicker
        value={source.company_id}
        onChange={(company_id) => ws.canWrite && mutate(async (sb) => must(await sb.from("analytics_sources").update({ company_id }).eq("id", source.id)), { success: "Client associé" })}
      />
      {ws.canWrite ? (
        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirm(true)} title="Supprimer" aria-label={`Supprimer ${source.name}`}>
          <X size={13} />
        </button>
      ) : (
        <span />
      )}
      {confirm && (
        <ConfirmModal
          title={`Supprimer ${source.name} ?`}
          text="La source et tout son historique sont supprimés du reporting."
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("analytics_sources").delete().eq("id", source.id)), { success: "Source supprimée" });
          }}
        />
      )}
    </div>
  );
}
