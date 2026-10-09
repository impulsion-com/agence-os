"use client";

import { useState } from "react";
import { KeyRound, Lock, Plus } from "lucide-react";

import { ConfirmModal } from "@/components/ui/overlay";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { ago } from "@/lib/format";
import type { SiteKey, SiteRow } from "@/lib/tracking/load";
import { Code, CopyButton } from "./shared";

type Ex = "curl" | "zapier" | "stripe" | "shopify" | "woo" | "crm";
const EXAMPLES: { id: Ex; name: string }[] = [
  { id: "curl", name: "curl" },
  { id: "zapier", name: "Zapier / Make" },
  { id: "stripe", name: "Stripe" },
  { id: "shopify", name: "Shopify Flow" },
  { id: "woo", name: "WooCommerce" },
  { id: "crm", name: "Deals du CRM" },
];

export function ApiTab({ site, keys, appUrl }: { site: SiteRow; keys: SiteKey[]; appUrl: string }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // La clé complète n'existe qu'ici, juste après sa création : la base n'en garde que l'empreinte
  const [fresh, setFresh] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<SiteKey | null>(null);
  const [ex, setEx] = useState<Ex>("curl");
  const shownKey = fresh ?? "sk_VOTRE_CLE";
  const endpoint = `${appUrl}/api/t/conversion`;
  const active = keys.filter((k) => !k.revoked_at);
  const revoked = keys.filter((k) => k.revoked_at);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const res = await mutate(async (sb) => must(await sb.rpc("create_tracking_key", { p_site: site.id, p_name: name })) as { key: string }, { success: "Clé créée" });
    setBusy(false);
    if (res) {
      setFresh(res.key);
      setName("");
    }
  };

  return (
    <div className="trk-col">
      <section className="card">
        <div className="card-h">
          <h2>
            <KeyRound size={15} style={{ display: "inline", verticalAlign: -2, marginRight: 6 }} />
            Clés d&apos;envoi
          </h2>
        </div>
        <div className="card-b trk-prose">
          {!ws.canWrite ? (
            <div className="rp-note">
              <Lock size={15} />
              <span>Les clés d&apos;envoi ne sont visibles que des membres qui peuvent modifier l&apos;espace.</span>
            </div>
          ) : (
            <>
              <p>
                Une clé authentifie les conversions envoyées depuis un serveur (Stripe, CRM, Zapier). Crée-en une par outil : tu pourras en révoquer une sans couper les
                autres. Ne la mets jamais dans le code du site : la clé publique <code>{site.public_key}</code> suffit au script.
              </p>
              {fresh && (
                <div className="rp-note warn" role="status">
                  <KeyRound size={15} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                    <b>Copie cette clé maintenant, elle ne sera plus affichée.</b>
                    <span className="trk-key">
                      <input className="input mono" readOnly value={fresh} aria-label="Nouvelle clé d'envoi" onFocus={(e) => e.currentTarget.select()} />
                      <CopyButton text={fresh} />
                    </span>
                    <span>Les exemples ci-dessous l&apos;utilisent tant que tu restes sur cette page.</span>
                  </span>
                </div>
              )}
              {keys.length > 0 && (
                <ul className="trk-keys" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {[...active, ...revoked].map((k) => (
                    <li key={k.id}>
                      <span style={{ fontWeight: 500, color: "var(--text)" }}>{k.name}</span>
                      <code>{k.prefix}…</code>
                      <span className="meta">
                        {k.revoked_at ? `Révoquée ${ago(k.revoked_at)}` : k.last_used_at ? `Utilisée ${ago(k.last_used_at)}` : "Jamais utilisée"}
                      </span>
                      <span style={{ marginLeft: "auto" }}>
                        {k.revoked_at ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => mutate(async (sb) => must(await sb.from("tracking_keys").delete().eq("id", k.id)))}>
                            Retirer de la liste
                          </button>
                        ) : (
                          <button type="button" className="btn btn-sm" onClick={() => setRevoke(k)}>Révoquer</button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <form className="trk-key" onSubmit={create}>
                <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Nom de la clé, par exemple Stripe" aria-label="Nom de la nouvelle clé" />
                <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>
                  <Plus size={12} /> Créer une clé
                </button>
              </form>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <h2>Envoyer une conversion</h2>
        </div>
        <div className="card-b trk-prose">
          <p>
            <code>POST {endpoint}</code> avec <code>Authorization: Bearer sk_…</code>. Corps JSON : <code>email</code> ou <code>anon_id</code> (valeur de{" "}
            <code>window.aos.id</code> ou du cookie <code>_aos_id</code>), <code>type</code> (purchase, lead, booking ou nom libre), <code>value</code>,{" "}
            <code>currency</code>, <code>order_id</code>, <code>ts</code> (ISO 8601 ou secondes), <code>name</code>, <code>phone</code>, <code>props</code>.
          </p>
          <p className="faint">
            Idempotente : un second envoi avec le même type et le même order_id répond <code>200 {`{"duplicate": true}`}</code> sans doubler la vente. Réponses : 201
            créée, 400 requête invalide, 401 clé invalide, 429 trop de requêtes.
          </p>
          <div className="seg trk-guides" role="tablist" aria-label="Exemple">
            {EXAMPLES.map((e) => (
              <button key={e.id} type="button" role="tab" aria-selected={ex === e.id} className={ex === e.id ? "on" : ""} onClick={() => setEx(e.id)}>
                {e.name}
              </button>
            ))}
          </div>
          {!fresh && <p className="faint" style={{ fontSize: 12 }}>Les exemples affichent une fausse clé : remplace-la par l&apos;une des tiennes.</p>}

          {ex === "curl" && (
            <Code lang="Terminal">{`curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${shownKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "claire@exemple.fr",
    "type": "purchase",
    "value": 189.90,
    "currency": "EUR",
    "order_id": "CMD-1042"
  }'`}</Code>
          )}
          {ex === "zapier" && (
            <>
              <ol className="rp-steps">
                <li>Déclencheur : la vente dans ton outil (Stripe, Systeme.io, Calendly, Typeform, Google Sheets…).</li>
                <li>Action : « Webhooks by Zapier &gt; POST » (Make : module « HTTP &gt; Make a request »).</li>
                <li>URL : <code>{endpoint}</code>, type de contenu JSON, en-tête <code>Authorization</code> = <code>Bearer {shownKey}</code>.</li>
                <li>Données : associe les champs de l&apos;outil source.</li>
              </ol>
              <Code lang="JSON">{`{
  "email": "{{email du client}}",
  "type": "purchase",
  "value": {{montant}},
  "currency": "EUR",
  "order_id": "{{identifiant de la commande}}"
}`}</Code>
            </>
          )}
          {ex === "stripe" && (
            <>
              <ol className="rp-steps">
                <li>Stripe &gt; Développeurs &gt; Webhooks &gt; Ajouter un endpoint avec l&apos;URL ci-dessous.</li>
                <li>Évènements : <code>checkout.session.completed</code> et <code>invoice.paid</code> (abonnements).</li>
                <li>
                  Facultatif mais recommandé : copie la clé de signature (whsec_…) dans la variable d&apos;environnement <code>STRIPE_WEBHOOK_SECRET</code> du déploiement.
                </li>
                <li>
                  Pour relier l&apos;achat au parcours même si l&apos;email diffère, passe <code>client_reference_id: window.aos.id</code> à la création de la session
                  Checkout (ou <code>metadata.aos_id</code>).
                </li>
              </ol>
              <Code lang="URL du webhook">{`${appUrl}/api/t/webhooks/stripe?key=${shownKey}`}</Code>
            </>
          )}
          {ex === "shopify" && (
            <>
              <p>
                Si le pixel personnalisé (onglet Installation) ne suffit pas, Shopify Flow peut envoyer chaque commande payée : déclencheur « Order paid », action « Send
                HTTP request », méthode POST, en-têtes <code>Content-Type: application/json</code> et <code>Authorization: Bearer {shownKey}</code>.
              </p>
              <Code lang="Corps (Liquid)">{`{
  "email": "{{order.email}}",
  "type": "purchase",
  "value": {{order.totalPriceSet.shopMoney.amount}},
  "currency": "{{order.currencyCode}}",
  "order_id": "{{order.name}}"
}`}</Code>
              <p className="faint">
                Même order_id que le pixel ? Mets <code>{"{{order.id}}"}</code> des deux côtés : la vente ne sera comptée qu&apos;une fois.
              </p>
            </>
          )}
          {ex === "woo" && (
            <>
              <p>Pour compter les commandes au paiement effectif (virement, paiement différé), côté serveur :</p>
              <Code lang="PHP">{`add_action('woocommerce_payment_complete', function ($order_id) {
  $o = wc_get_order($order_id);
  wp_remote_post('${endpoint}', [
    'headers' => [
      'Authorization' => 'Bearer ${shownKey}',
      'Content-Type' => 'application/json',
    ],
    'body' => wp_json_encode([
      'email' => $o->get_billing_email(),
      'type' => 'purchase',
      'value' => (float) $o->get_total(),
      'currency' => $o->get_currency(),
      'order_id' => (string) $o->get_order_number(),
    ]),
    'timeout' => 5,
  ]);
});`}</Code>
            </>
          )}
          {ex === "crm" && (
            <p>
              {site.company_id
                ? "Ce site appartient à un client : les deals du CRM de l'agence ne le concernent pas. Envoie les ventes du client par l'API."
                : "Ce site est celui de l'agence : chaque deal passé en « gagné » dont le contact a l'email d'un visiteur identifié compte automatiquement comme conversion « deal gagné », avec la valeur du deal. Rien à brancher."}
            </p>
          )}
        </div>
      </section>

      {revoke && (
        <ConfirmModal
          title={`Révoquer la clé « ${revoke.name} » ?`}
          text="Elle cesse de fonctionner immédiatement : l'outil qui l'utilise devra en recevoir une nouvelle. Les autres clés et le script du site ne sont pas concernés."
          confirmLabel="Révoquer"
          onClose={() => setRevoke(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.rpc("revoke_tracking_key", { p_id: revoke.id })), { success: "Clé révoquée" });
          }}
        />
      )}
    </div>
  );
}
