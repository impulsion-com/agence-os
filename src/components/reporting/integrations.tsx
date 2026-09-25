"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, CircleCheck, Copy, Info, Link2, RefreshCw, Search, Unplug, X } from "lucide-react";

import "@/styles/reporting.css";
import { CompanyPicker } from "@/components/pickers";
import { ConfirmModal } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { ago, fmtDate } from "@/lib/format";
import { platformColor, platformName } from "@/lib/ads/metrics";
import type { AvailableAccount, ConnectionPublic, TrackedAccount } from "@/lib/ads/types";
import { Crumbs, useSync } from "./common";

interface Status {
  meta: { configured: boolean; missing: string[] };
  google: { configured: boolean; missing: string[] };
  cron: boolean;
  redirect: { meta: string; google: string };
  cronPath: string;
}

interface Props {
  status: Status;
  connections: ConnectionPublic[];
  accounts: TrackedAccount[];
  notice: { connected?: string; accounts?: string; error?: string };
}

const INFO = {
  meta: {
    name: "Meta Ads",
    letter: "M",
    desc: "Facebook et Instagram : dépense, clics sur un lien, achats ou prospects, par campagne et par jour.",
    env: "META_APP_ID, META_APP_SECRET",
  },
  google: {
    name: "Google Ads",
    letter: "G",
    desc: "Search, Performance Max, YouTube : coût, clics, conversions et valeur, par campagne et par jour.",
    env: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN",
  },
} as const;

/** Jours restants avant une échéance (négatif si dépassée). */
const daysUntil = (ts: string) => Math.round((new Date(ts).getTime() - Date.now()) / 864e5);

const fmtGoogleId = (id: string) => id.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

export function Integrations({ status, connections, accounts, notice }: Props) {
  const ws = useWorkspace();
  const router = useRouter();
  const path = usePathname();
  const clearNotice = () => router.replace(path, { scroll: false });

  const detached = accounts.filter((a) => !a.connection_id && (a.platform === "meta" || a.platform === "google") && !a.external_id.startsWith("demo-") && !a.external_id.startsWith("csv-"));
  const others = accounts.filter((a) => !a.connection_id && (a.external_id.startsWith("demo-") || a.external_id.startsWith("csv-") || !["meta", "google"].includes(a.platform)));

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <Crumbs items={[{ label: "Réglages", href: `${ws.base}/settings` }, { label: "Connexions publicitaires" }]} />
      <div className="ph">
        <div>
          <h1>Connexions publicitaires</h1>
          <p>Connecte tes comptes Meta Ads et Google Ads en lecture seule, puis associe chaque compte à un client pour alimenter le reporting.</p>
        </div>
        <div className="actions">
          <Link className="btn" href={`${ws.base}/reporting`}>
            Voir le reporting
          </Link>
        </div>
      </div>

      {notice.connected && (
        <div className="rp-note" role="status" style={{ marginBottom: 16, background: "var(--green-soft)", borderColor: "color-mix(in srgb, var(--green) 25%, transparent)" }}>
          <CircleCheck size={15} style={{ color: "var(--green)" }} />
          <span style={{ flex: 1 }}>
            {INFO[notice.connected as "meta" | "google"]?.name ?? "Plateforme"} connecté.{" "}
            {Number(notice.accounts) > 0
              ? `${notice.accounts} compte${Number(notice.accounts) > 1 ? "s" : ""} publicitaire${Number(notice.accounts) > 1 ? "s" : ""} trouvé${Number(notice.accounts) > 1 ? "s" : ""} : coche ceux à suivre et associe-les à un client.`
              : "Aucun compte publicitaire trouvé pour l'instant : vérifie tes accès puis actualise la liste."}
          </span>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={clearNotice} aria-label="Fermer">
            <X size={13} />
          </button>
        </div>
      )}
      {notice.error && (
        <div className="rp-note err" role="alert" style={{ marginBottom: 16 }}>
          <AlertTriangle size={15} style={{ color: "var(--red)" }} />
          <span style={{ flex: 1 }}>{notice.error}</span>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={clearNotice} aria-label="Fermer">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="rp-conn">
        {(["meta", "google"] as const).map((p) => (
          <PlatformCard key={p} platform={p} status={status} connections={connections.filter((c) => c.platform === p)} accounts={accounts} activeConnIds={connections.map((c) => c.id)} />
        ))}

        {detached.length > 0 && (
          <div className="card">
            <div className="card-h">
              <div className="head">
                <div>
                  <h2>Comptes sans connexion</h2>
                  <p>Leur connexion a été supprimée : l&apos;historique est conservé mais la synchro est arrêtée. Reconnecte la plateforme pour les rattacher.</p>
                </div>
              </div>
            </div>
            {detached.map((a) => (
              <TrackedRow key={a.id} account={a} />
            ))}
          </div>
        )}

        {others.length > 0 && (
          <div className="card">
            <div className="card-h">
              <div className="head">
                <div>
                  <h2>Comptes importés et de démonstration</h2>
                  <p>Données importées en CSV (depuis la fiche reporting d&apos;un client) ou générées pour la démo. Pas de synchronisation automatique.</p>
                </div>
              </div>
            </div>
            {others.map((a) => (
              <TrackedRow key={a.id} account={a} />
            ))}
          </div>
        )}

        <div className="card">
          <div className="card-h">
            <div className="head">
              <div>
                <h2>Synchronisation automatique</h2>
                <p>Chaque jour, les 7 derniers jours sont relus pour intégrer les conversions attribuées en retard. La première synchro d&apos;un compte importe 90 jours.</p>
              </div>
            </div>
            {status.cron ? <Badge color="var(--green)">Active</Badge> : <Badge color="var(--amber)">À configurer</Badge>}
          </div>
          <div className="card-b" style={{ display: "grid", gap: 10 }}>
            {!status.cron && (
              <div className="rp-note warn">
                <Info size={15} />
                <span>
                  Ajoute la variable <code>CRON_SECRET</code> (une longue chaîne aléatoire) dans ton hébergement. Sur Vercel, le fichier <code>vercel.json</code> déclenche{" "}
                  <code>{status.cronPath}</code> tous les jours à 5 h (UTC). Ailleurs, appelle cette URL avec l&apos;en-tête <code>Authorization: Bearer &lt;CRON_SECRET&gt;</code>.
                </span>
              </div>
            )}
            <TechInfo status={status} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TechInfo({ status }: { status: Status }) {
  const toast = useToast();
  const copy = (v: string) =>
    navigator.clipboard.writeText(v).then(
      () => toast("Copié"),
      () => toast("Copie impossible", { error: true }),
    );
  return (
    <details>
      <summary className="faint" style={{ cursor: "pointer", fontSize: 12.5 }}>
        URL de redirection OAuth à déclarer
      </summary>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {(["meta", "google"] as const).map((p) => (
          <div key={p} className="field">
            <span className="label">{INFO[p].name}</span>
            <div className="rp-share-link">
              <input className="input" readOnly value={status.redirect[p]} onFocus={(e) => e.target.select()} aria-label={`URL de redirection ${INFO[p].name}`} />
              <button className="btn btn-icon" onClick={() => copy(status.redirect[p])} aria-label="Copier">
                <Copy size={14} />
              </button>
            </div>
          </div>
        ))}
        <span className="hint faint" style={{ fontSize: 12 }}>Le pas à pas complet est dans docs/reporting.md.</span>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------
// Carte d'une plateforme
// ---------------------------------------------------------------------
function PlatformCard({
  platform,
  status,
  connections,
  accounts,
  activeConnIds,
}: {
  platform: "meta" | "google";
  status: Status;
  connections: ConnectionPublic[];
  accounts: TrackedAccount[];
  activeConnIds: string[];
}) {
  const ws = useWorkspace();
  const info = INFO[platform];
  const st = status[platform];
  const startUrl = `/api/integrations/${platform}/start?ws=${encodeURIComponent(ws.workspace.slug)}`;

  return (
    <div className="card">
      <div className="card-h">
        <div className="head">
          <span className="logo" style={{ background: platformColor(platform) }} aria-hidden>
            {info.letter}
          </span>
          <div>
            <h2>{info.name}</h2>
            <p>{info.desc}</p>
          </div>
        </div>
        {connections.length ? (
          <Badge color="var(--green)">Connecté</Badge>
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
              Variables manquantes sur le serveur : <code>{st.missing.join(", ")}</code>. La synchronisation de cette plateforme échouera tant qu&apos;elles ne sont pas renseignées.
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
                L&apos;administrateur du serveur doit d&apos;abord renseigner : <code>{st.missing.join(", ")}</code>.
              </p>
              <ol className="rp-steps">
                {platform === "meta" ? (
                  <>
                    <li>Crée une app de type Entreprise sur developers.facebook.com et ajoute le produit « Facebook Login for Business » (ou « Facebook Login »).</li>
                    <li>Déclare l&apos;URL de redirection : <code>{status.redirect.meta}</code></li>
                    <li>Copie l&apos;identifiant et la clé secrète de l&apos;app dans les variables d&apos;environnement, puis redéploie.</li>
                  </>
                ) : (
                  <>
                    <li>Crée un projet sur console.cloud.google.com, active « Google Ads API » et configure l&apos;écran de consentement.</li>
                    <li>Crée un identifiant OAuth « Application Web » avec la redirection : <code>{status.redirect.google}</code></li>
                    <li>Demande un jeton développeur (accès de base) dans ton compte administrateur Google Ads, puis renseigne les trois variables.</li>
                  </>
                )}
              </ol>
            </div>
          </div>
        </div>
      ) : !connections.length ? (
        <div className="card-b" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Accès en lecture seule. Les jetons restent sur le serveur, jamais dans le navigateur.
          </span>
          {ws.isAdmin ? (
            <a className="btn btn-primary" href={startUrl}>
              <Link2 size={14} /> Connecter {info.name}
            </a>
          ) : (
            <span className="faint" style={{ fontSize: 12.5 }}>Demande à un admin de l&apos;espace de connecter {info.name}.</span>
          )}
        </div>
      ) : (
        <>
          {connections.map((c) => (
            <ConnectionBlock key={c.id} platform={platform} conn={c} accounts={accounts} activeConnIds={activeConnIds} />
          ))}
          {ws.isAdmin && (
            <div className="who" style={{ justifyContent: "flex-start" }}>
              <a className="btn btn-ghost btn-sm" href={startUrl}>
                <Link2 size={13} /> Connecter un autre compte {platform === "meta" ? "Facebook" : "Google"}
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConnectionBlock({ platform, conn, accounts, activeConnIds }: { platform: "meta" | "google"; conn: ConnectionPublic; accounts: TrackedAccount[]; activeConnIds: string[] }) {
  const ws = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "delete" | null>(null);
  const [confirm, setConfirm] = useState(false);

  const tracked = useMemo(() => new Map(accounts.filter((a) => a.platform === platform).map((a) => [a.external_id, a])), [accounts, platform]);
  const list = conn.accounts ?? [];
  const filtered = list
    .filter((a) => showInactive || a.active || tracked.has(a.external_id))
    .filter((a) => !q || `${a.name} ${a.external_id} ${a.manager_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(tracked.has(b.external_id)) - Number(tracked.has(a.external_id)));
  const inactive = list.filter((a) => !a.active && !tracked.has(a.external_id)).length;
  const trackedHere = accounts.filter((a) => a.connection_id === conn.id).length;

  const days = conn.expires_at ? daysUntil(conn.expires_at) : null;

  const refresh = async () => {
    setBusy("refresh");
    const res = await fetch(`/api/integrations/connections/${conn.id}`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { accounts?: number; error?: string };
    setBusy(null);
    if (!res.ok) toast(json.error || "Actualisation impossible", { error: true });
    else toast(`${json.accounts} compte${json.accounts === 1 ? "" : "s"} disponible${json.accounts === 1 ? "" : "s"}`);
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
            {conn.label || info(platform)}
          </div>
          <div className="faint" style={{ fontSize: 12, display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
            <span>Connecté {ago(conn.created_at)}</span>
            <span>
              {list.length} compte{list.length > 1 ? "s" : ""} accessible{list.length > 1 ? "s" : ""}, {trackedHere} suivi{trackedHere > 1 ? "s" : ""}
            </span>
            {platform === "meta" && days !== null && (
              <span style={{ color: days < 10 ? "var(--red)" : undefined }}>
                {days < 0 ? "Jeton expiré" : `Jeton valable jusqu'au ${fmtDate(conn.expires_at!.slice(0, 10), true)}`}
              </span>
            )}
            {platform === "google" && <span>Accès permanent (refresh token)</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ws.canWrite && (
            <button className="btn btn-sm" onClick={refresh} disabled={busy !== null}>
              <RefreshCw size={12} className={busy === "refresh" ? "rp-spin" : undefined} /> Actualiser la liste
            </button>
          )}
          {ws.isAdmin && (
            <>
              {platform === "meta" && days !== null && days < 10 && (
                <a className="btn btn-sm btn-primary" href={`/api/integrations/meta/start?ws=${encodeURIComponent(ws.workspace.slug)}`}>
                  Reconnecter
                </a>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)} disabled={busy !== null} style={{ color: "var(--red)" }}>
                <Unplug size={12} /> Déconnecter
              </button>
            </>
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
              placeholder="Rechercher un compte (nom ou identifiant)…"
              aria-label="Rechercher un compte"
              style={{ border: 0, outline: 0, background: "transparent", width: "100%", fontSize: 12.5 }}
            />
          </label>
          {inactive > 0 && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }} className="muted">
              <input type="checkbox" className="toggle" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Comptes inactifs ({inactive})
            </label>
          )}
        </div>
      )}

      {filtered.map((a) => (
        <AccountRow key={a.external_id} platform={platform} conn={conn} account={a} tracked={tracked.get(a.external_id)} activeConnIds={activeConnIds} />
      ))}
      {!list.length && !conn.last_error && (
        <div className="who faint" style={{ fontSize: 12.5 }}>
          Aucun compte publicitaire accessible avec cette connexion. Vérifie que ce compte {platform === "meta" ? "Facebook a un rôle sur les comptes publicitaires" : "Google a accès aux comptes Google Ads"}, puis actualise la liste.
        </div>
      )}
      {list.length > 0 && !filtered.length && <div className="who faint" style={{ fontSize: 12.5 }}>Aucun compte ne correspond à ta recherche.</div>}

      {confirm && (
        <ConfirmModal
          title={`Déconnecter ${conn.label || INFO[platform].name} ?`}
          text="Les jetons d'accès sont supprimés et la synchronisation s'arrête. Les comptes suivis et tout l'historique des métriques restent disponibles dans le reporting."
          confirmLabel="Déconnecter"
          onClose={() => setConfirm(false)}
          onConfirm={disconnect}
        />
      )}
    </>
  );
}

const info = (p: "meta" | "google") => INFO[p].name;

function AccountRow({
  platform,
  conn,
  account,
  tracked,
  activeConnIds,
}: {
  platform: "meta" | "google";
  conn: ConnectionPublic;
  account: AvailableAccount;
  tracked: TrackedAccount | undefined;
  activeConnIds: string[];
}) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const toast = useToast();
  const { run, busy } = useSync();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const isTracked = !!tracked;
  const elsewhere = tracked && tracked.connection_id && tracked.connection_id !== conn.id && activeConnIds.includes(tracked.connection_id);
  const detached = tracked && tracked.connection_id !== conn.id && !elsewhere;

  const track = async () => {
    setPending(true);
    const row = await mutate(
      async (sb) =>
        must(
          await sb
            .from("ad_accounts")
            .upsert(
              {
                workspace_id: ws.workspace.id,
                connection_id: conn.id,
                platform,
                external_id: account.external_id,
                name: account.name,
                currency: account.currency,
                login_customer_id: account.login_customer_id,
              },
              { onConflict: "workspace_id,platform,external_id" },
            )
            .select("id")
            .single(),
        ),
    );
    setPending(false);
    if (row?.id) {
      toast(`${account.name} suivi : import des 90 derniers jours…`);
      await run(row.id, { quiet: true });
    }
  };

  const reattach = () =>
    mutate(async (sb) => must(await sb.from("ad_accounts").update({ connection_id: conn.id, login_customer_id: account.login_customer_id, sync_error: null }).eq("id", tracked!.id)), {
      success: "Compte rattaché à cette connexion",
    });

  const untrack = async () => {
    await mutate(async (sb) => must(await sb.from("ad_accounts").delete().eq("id", tracked!.id)), { success: "Compte retiré du suivi" });
  };

  const setCompany = (company_id: string | null) =>
    mutate(async (sb) => must(await sb.from("ad_accounts").update({ company_id }).eq("id", tracked!.id)), { success: company_id ? "Client associé" : "Client retiré" });

  const syncing = busy !== null || pending;

  return (
    <div className={`acc${account.active ? "" : " off"}`}>
      <input
        type="checkbox"
        className="check"
        checked={isTracked}
        disabled={!ws.canWrite || syncing || !!elsewhere}
        onChange={() => (isTracked ? setConfirm(true) : track())}
        aria-label={`Suivre ${account.name}`}
      />
      <div className="nm">
        <div className="t trunc">{account.name}</div>
        <div className="s">
          <span className="mono">{platform === "google" ? fmtGoogleId(account.external_id) : account.external_id.replace(/^act_/, "")}</span>
          <span>{account.currency}</span>
          {!account.active && <span>{account.status}</span>}
          {account.manager_name && <span>{platform === "google" ? `via ${account.manager_name}` : account.manager_name}</span>}
          {tracked && !elsewhere && !detached && (
            <span>{syncing ? "Synchronisation…" : tracked.last_synced_at ? `Synchronisé ${ago(tracked.last_synced_at)}` : "Jamais synchronisé"}</span>
          )}
          {elsewhere && <span>Suivi via une autre connexion</span>}
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
        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => run(tracked.id)} disabled={syncing} title="Synchroniser maintenant" aria-label={`Synchroniser ${account.name}`}>
          <RefreshCw size={13} className={syncing ? "rp-spin" : undefined} />
        </button>
      ) : (
        <span />
      )}
      {tracked?.sync_error && !elsewhere && <div className="err">{tracked.sync_error}</div>}
      {tracked && !tracked.company_id && !elsewhere && !detached && <div className="err" style={{ color: "var(--amber)" }}>Associe un client pour voir ce compte dans le reporting.</div>}
      {confirm && (
        <ConfirmModal
          title={`Ne plus suivre ${account.name} ?`}
          text="Le compte sort du reporting et son historique de métriques est supprimé. Tu pourras le suivre à nouveau (90 jours seront réimportés)."
          confirmLabel="Ne plus suivre"
          onClose={() => setConfirm(false)}
          onConfirm={untrack}
        />
      )}
    </div>
  );
}

/** Compte suivi hors connexion active (CSV, démo, connexion supprimée). */
function TrackedRow({ account }: { account: TrackedAccount }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [confirm, setConfirm] = useState(false);
  const kind = account.external_id.startsWith("demo-") ? "Démo" : account.external_id.startsWith("csv-") ? "Import CSV" : "Sans connexion";
  return (
    <div className="acc">
      <span className="rp-dot" style={{ ["--c" as string]: platformColor(account.platform), marginLeft: 3 }} aria-hidden />
      <div className="nm">
        <div className="t trunc">{account.name}</div>
        <div className="s">
          <span>{platformName(account.platform)}</span>
          <span>{kind}</span>
          {account.last_synced_at && <span>Mis à jour {ago(account.last_synced_at)}</span>}
        </div>
      </div>
      <CompanyPicker
        value={account.company_id}
        onChange={(company_id) =>
          ws.canWrite && mutate(async (sb) => must(await sb.from("ad_accounts").update({ company_id }).eq("id", account.id)), { success: "Client associé" })
        }
      />
      {ws.canWrite ? (
        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirm(true)} title="Supprimer" aria-label={`Supprimer ${account.name}`}>
          <X size={13} />
        </button>
      ) : (
        <span />
      )}
      {confirm && (
        <ConfirmModal
          title={`Supprimer ${account.name} ?`}
          text="Le compte et tout son historique de métriques sont supprimés du reporting."
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("ad_accounts").delete().eq("id", account.id)), { success: "Compte supprimé" });
          }}
        />
      )}
    </div>
  );
}

