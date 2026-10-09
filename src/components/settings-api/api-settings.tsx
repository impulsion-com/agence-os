"use client";

import "./api.css";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Plus, ShieldCheck, Terminal, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/misc";
import { ConfirmModal, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { SetPage, SetSection } from "@/components/workspace/settings/shell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago, fmtDate } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";

export interface ApiToken {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  scope: "read" | "write" | "ext";
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  state: "active" | "revoked" | "expired";
}

export interface ToolGroup {
  label: string;
  tools: { name: string; title: string; write: boolean }[];
}

const PLACEHOLDER = "aos_…";

// ---------------------------------------------------------------------
// Instructions de connexion, avec le jeton (réel ou fictif)
// ---------------------------------------------------------------------
function snippets(appUrl: string, token: string) {
  const endpoint = `${appUrl}/api/mcp`;
  return {
    endpoint,
    claudeCode: `claude mcp add --transport http agence-os ${endpoint} --header "Authorization: Bearer ${token}"`,
    secretUrl: `${endpoint}/${token}`,
    desktopJson: JSON.stringify(
      {
        mcpServers: {
          "agence-os": {
            command: "npx",
            args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${AGENCE_OS_AUTH}"],
            env: { AGENCE_OS_AUTH: `Bearer ${token}` },
          },
        },
      },
      null,
      2,
    ),
    genericJson: JSON.stringify({ mcpServers: { "agence-os": { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  };
}

function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          toast("Copie impossible : sélectionne le texte à la main", { error: true });
        }
      }}
      aria-label={label}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copié" : label}
    </button>
  );
}

function Code({ code, wrap }: { code: string; wrap?: boolean }) {
  return (
    <div className="api-code">
      <pre className={wrap ? "wrap" : undefined}>
        <code>{code}</code>
      </pre>
      <div className="api-code-copy">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

type Client = "code" | "desktop" | "other";

function Instructions({ appUrl, token, localhost }: { appUrl: string; token: string; localhost: boolean }) {
  const [client, setClient] = useState<Client>("code");
  const s = snippets(appUrl, token);
  const real = token !== PLACEHOLDER;
  return (
    <div className="api-howto">
      <div className="seg" role="tablist" aria-label="Client">
        {(
          [
            ["code", "Claude Code"],
            ["desktop", "Claude Desktop et Cowork"],
            ["other", "Autres clients MCP"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={client === id} className={client === id ? "on" : undefined} onClick={() => setClient(id)}>
            {label}
          </button>
        ))}
      </div>

      {client === "code" && (
        <div className="api-steps">
          <p>Dans un terminal, lance :</p>
          <Code code={s.claudeCode} wrap />
          <p className="faint">
            Ajoute <code>--scope user</code> pour l&apos;utiliser dans tous tes projets. Vérifie ensuite avec <code>/mcp</code> dans Claude Code, puis demande par exemple : « Quelles tâches sont en retard ? ».
          </p>
        </div>
      )}

      {client === "desktop" && (
        <div className="api-steps">
          <p>
            <b>Connecteur personnalisé</b> (le plus simple) : dans Claude, ouvre Réglages &gt; Connecteurs &gt; Ajouter un connecteur personnalisé, nomme-le « Agence OS » et colle cette URL :
          </p>
          <Code code={s.secretUrl} wrap />
          <p className="faint">
            Cette URL contient ton jeton : traite-la comme un mot de passe, et préfère un jeton en lecture seule si tu la partages entre plusieurs appareils. Le connecteur est disponible dans Claude Desktop, Cowork et claude.ai.
            {localhost && " Il faut que l'application soit accessible sur Internet : une adresse localhost ne fonctionne pas pour un connecteur."}
          </p>
          <p>
            <b>Ou fichier de configuration</b> de Claude Desktop (<code>claude_desktop_config.json</code>, via Réglages &gt; Développeur &gt; Modifier la configuration). Nécessite Node.js :
          </p>
          <Code code={s.desktopJson} />
          <p className="faint">Redémarre Claude Desktop après l&apos;enregistrement.</p>
        </div>
      )}

      {client === "other" && (
        <div className="api-steps">
          <p>
            Cursor, Windsurf, VS Code et la plupart des clients MCP acceptent un serveur distant en HTTP (Streamable HTTP) avec un en-tête d&apos;authentification :
          </p>
          <Code code={s.genericJson} />
          <p className="faint">
            Adresse du serveur : <code>{s.endpoint}</code> · En-tête : <code>Authorization: Bearer {real ? `${token.slice(0, 12)}…` : PLACEHOLDER}</code>
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Création d'un jeton
// ---------------------------------------------------------------------
const EXPIRY = [
  { id: "never", label: "Jamais", days: null },
  { id: "30", label: "30 jours", days: 30 },
  { id: "90", label: "90 jours", days: 90 },
  { id: "365", label: "1 an", days: 365 },
] as const;

function CreateModal({ appUrl, localhost, onClose, onCreated }: { appUrl: string; localhost: boolean; onClose: () => void; onCreated: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write" | "ext">(ws.canWrite ? "write" : "read");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]["id"]>("never");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const days = EXPIRY.find((e) => e.id === expiry)?.days ?? null;
    const { data, error } = await supabaseBrowser().rpc("create_api_token", {
      p_ws: ws.workspace.id,
      p_name: name.trim(),
      p_scope: scope,
      p_expires_at: days ? new Date(Date.now() + days * 864e5).toISOString() : undefined,
    });
    setBusy(false);
    if (error) return toast(error.message, { error: true });
    setToken((data as { token: string }).token);
    onCreated();
  };

  if (token)
    return (
      <Modal
        title="Ton jeton est prêt"
        size="lg"
        onClose={onClose}
        footer={
          <button className="btn btn-primary" onClick={onClose}>
            J&apos;ai copié mon jeton
          </button>
        }
      >
        <div className="api-created">
          <p className="api-warn">
            <KeyRound size={15} />
            <span>Copie-le maintenant : pour ta sécurité, il ne sera plus jamais affiché. Seule son empreinte est conservée.</span>
          </p>
          <div className="api-token-box">
            <code>{token}</code>
            <CopyButton text={token} label="Copier le jeton" />
          </div>
          {scope === "ext" ? (
            <>
              <h3>Brancher l&apos;extension</h3>
              <p>
                Ouvre l&apos;extension « Colonnes CRM pour Ads Manager », colle l&apos;adresse <code>{appUrl}</code> et ce jeton, puis teste la connexion. Elle affichera
                les chiffres du site rattaché au compte publicitaire ouvert dans Ads Manager.
              </p>
            </>
          ) : (
            <>
              <h3>Connecter Claude</h3>
              <Instructions appUrl={appUrl} token={token} localhost={localhost} />
            </>
          )}
        </div>
      </Modal>
    );

  return (
    <Modal
      title="Nouveau jeton d'accès"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>
            {busy ? "Création…" : "Créer le jeton"}
          </button>
        </>
      }
    >
      <form
        className="set-form"
        style={{ marginTop: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="field">
          <label htmlFor="api-name">Nom</label>
          <input id="api-name" className="input" autoFocus maxLength={80} placeholder="Claude Code sur mon Mac" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="hint">Pour le reconnaître dans la liste et le révoquer plus tard.</span>
        </div>
        <div className="field">
          <span className="label">Accès</span>
          <div className="api-scopes">
            <label className={`api-scope${scope === "read" ? " on" : ""}`}>
              <input type="radio" name="scope" checked={scope === "read"} onChange={() => setScope("read")} />
              <span>
                <b>Lecture seule</b>
                <small>Claude consulte tâches, CRM, propositions et reporting, sans rien modifier.</small>
              </span>
            </label>
            <label className={`api-scope${scope === "write" ? " on" : ""}${ws.canWrite ? "" : " off"}`}>
              <input type="radio" name="scope" checked={scope === "write"} disabled={!ws.canWrite} onChange={() => setScope("write")} />
              <span>
                <b>Lecture et écriture</b>
                <small>{ws.canWrite ? "Claude peut aussi créer et modifier tâches, projets, deals, propositions et liens, en ton nom." : "Indisponible : ton rôle d'invité est en lecture seule."}</small>
              </span>
            </label>
            <label className={`api-scope${scope === "ext" ? " on" : ""}`}>
              <input type="radio" name="scope" checked={scope === "ext"} onChange={() => setScope("ext")} />
              <span>
                <b>Extension Chrome</b>
                <small>Pour l&apos;extension qui affiche les chiffres du tracking dans Ads Manager. Lecture de l&apos;attribution seulement, aucun accès au serveur MCP.</small>
              </span>
            </label>
          </div>
        </div>
        <div className="field">
          <label htmlFor="api-exp">Expiration</label>
          <select id="api-exp" className="select" value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)} style={{ maxWidth: 200 }}>
            {EXPIRY.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
export function ApiSettings({ tokens, appUrl, tools }: { tokens: ApiToken[]; appUrl: string; tools: ToolGroup[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [deleting, setDeleting] = useState<ApiToken | null>(null);
  const localhost = /\/\/(localhost|127\.0\.0\.1)/.test(appUrl);
  const state = (t: ApiToken) => t.state;
  const sorted = [...tokens].sort((a, b) => Number(state(a) !== "active") - Number(state(b) !== "active") || b.created_at.localeCompare(a.created_at));
  const writeCount = tools.reduce((n, g) => n + g.tools.filter((t) => t.write).length, 0);
  const total = tools.reduce((n, g) => n + g.tools.length, 0);

  return (
    <SetPage
      wide
      title="API et MCP"
      lead="Connecte Claude Code, Claude Desktop ou Cowork à ton espace : Claude consulte et met à jour tes tâches, ton CRM, tes propositions et ton reporting, avec tes droits."
    >
      <SetSection
        title="Jetons d'accès"
        action={
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus size={13} />
            Nouveau jeton
          </button>
        }
      >
        {sorted.length ? (
          <div className="api-list">
            {sorted.map((t) => {
              const st = state(t);
              const owner = t.user_id !== ws.me.id ? ws.member(t.user_id)?.profile.full_name ?? "Ancien membre" : null;
              return (
                <div key={t.id} className={`api-row${st !== "active" ? " dim" : ""}`}>
                  <span className="api-ic">
                    <KeyRound size={15} />
                  </span>
                  <div className="api-main">
                    <div className="api-name">
                      <b className="trunc">{t.name}</b>
                      {st === "active" ? (
                        <Badge color={t.scope === "write" ? "var(--amber)" : t.scope === "ext" ? "var(--teal)" : "var(--blue)"}>{t.scope === "write" ? "Lecture et écriture" : t.scope === "ext" ? "Extension Chrome" : "Lecture seule"}</Badge>
                      ) : (
                        <Badge color="var(--gray)">{st === "revoked" ? "Révoqué" : "Expiré"}</Badge>
                      )}
                      {owner && <span className="faint">de {owner}</span>}
                    </div>
                    <div className="api-meta faint">
                      <code>{t.prefix}…</code>
                      <span>Créé le {fmtDate(t.created_at.slice(0, 10), true)}</span>
                      <span>{t.last_used_at ? `Utilisé ${ago(t.last_used_at)}` : "Jamais utilisé"}</span>
                      {t.expires_at && st === "active" && <span>Expire le {fmtDate(t.expires_at.slice(0, 10), true)}</span>}
                    </div>
                  </div>
                  {st === "active" ? (
                    <button className="btn btn-sm" onClick={() => setRevoking(t)}>
                      Révoquer
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setDeleting(t)} aria-label={`Supprimer ${t.name}`} title="Supprimer">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="api-empty">
            <KeyRound size={18} />
            <div>
              <b>Aucun jeton pour l&apos;instant</b>
              <p className="faint">Crée un jeton, puis colle la commande proposée dans Claude Code ou Claude Desktop.</p>
            </div>
          </div>
        )}
      </SetSection>

      <SetSection title="Connecter Claude">
        <p className="api-intro faint">
          <Terminal size={14} />
          <span>
            Remplace <code>{PLACEHOLDER}</code> par ton jeton (la commande complète s&apos;affiche à la création). Serveur MCP distant en Streamable HTTP : <code>{appUrl}/api/mcp</code>
          </span>
        </p>
        <Instructions appUrl={appUrl} token={PLACEHOLDER} localhost={localhost} />
      </SetSection>

      <SetSection title={`Ce que Claude peut faire (${total} outils)`}>
        <div className="api-tools">
          {tools.map((g) => (
            <div key={g.label} className="api-tool-group">
              <h3>{g.label}</h3>
              <ul>
                {g.tools.map((t) => (
                  <li key={t.name}>
                    <span>{t.title}</span>
                    <code>{t.name}</code>
                    {t.write && <i title="Outil d'écriture">écriture</i>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="faint api-note">
          Les {writeCount} outils d&apos;écriture n&apos;apparaissent qu&apos;avec un jeton en lecture et écriture, et jamais pour un invité. Exemples : « Quelles tâches sont en retard cette semaine ? », « Crée un deal pour Atelier Brun à 1 200 € par mois », « Compare la performance de Maison Lumen au mois dernier et propose trois actions ».
        </p>
      </SetSection>

      <SetSection title="Sécurité">
        <ul className="api-security">
          <li>
            <ShieldCheck size={14} />
            <span>Un jeton agit en ton nom dans cet espace uniquement, avec ton rôle actuel : s&apos;il change ou si tu quittes l&apos;espace, l&apos;accès suit aussitôt.</span>
          </li>
          <li>
            <ShieldCheck size={14} />
            <span>Seule l&apos;empreinte SHA-256 du jeton est conservée. La révocation est immédiate. Les écritures apparaissent dans le journal d&apos;activité à ton nom.</span>
          </li>
          <li>
            <ShieldCheck size={14} />
            <span>Limite de 120 appels par minute et par jeton. Les admins voient et peuvent révoquer tous les jetons de l&apos;espace.</span>
          </li>
        </ul>
      </SetSection>

      {creating && <CreateModal appUrl={appUrl} localhost={localhost} onClose={() => setCreating(false)} onCreated={() => router.refresh()} />}
      {revoking && (
        <ConfirmModal
          title={`Révoquer « ${revoking.name} » ?`}
          text="Les clients qui l'utilisent (Claude Code, Claude Desktop…) perdront l'accès immédiatement. Cette action est définitive."
          confirmLabel="Révoquer"
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.rpc("revoke_api_token", { p_id: revoking.id })), { success: "Jeton révoqué" });
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={`Supprimer « ${deleting.name} » ?`}
          text="Le jeton disparaît de la liste. Il est déjà inutilisable."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("api_tokens").delete().eq("id", deleting.id).select("id")), { success: "Jeton supprimé" });
          }}
        />
      )}
    </SetPage>
  );
}
