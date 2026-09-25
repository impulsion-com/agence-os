"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound, Lock, RefreshCw } from "lucide-react";

import { ConfirmModal } from "@/components/ui/overlay";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { SiteRow } from "@/lib/tracking/load";
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

function newSecret() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return `sk_${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function ApiTab({ site, secret, appUrl }: { site: SiteRow; secret: string | null; appUrl: string }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ex, setEx] = useState<Ex>("curl");
  const key = secret ?? "sk_…";
  const masked = secret ? `${secret.slice(0, 7)}${"•".repeat(20)}${secret.slice(-4)}` : "";
  const shownKey = show ? key : "sk_VOTRE_CLE_SECRETE";
  const endpoint = `${appUrl}/api/t/conversion`;

  return (
    <div className="trk-col">
      <section className="card">
        <div className="card-h">
          <h2>
            <KeyRound size={15} style={{ display: "inline", verticalAlign: -2, marginRight: 6 }} />
            Clé secrète
          </h2>
        </div>
        <div className="card-b trk-prose">
          {secret === null ? (
            <div className="rp-note">
              <Lock size={15} />
              <span>La clé secrète n&apos;est visible que des membres qui peuvent modifier l&apos;espace.</span>
            </div>
          ) : (
            <>
              <p>
                Elle authentifie les conversions envoyées depuis un serveur (Stripe, CRM, Zapier). Ne la mets jamais dans le code du site : la clé publique{" "}
                <code>{site.public_key}</code> suffit au script.
              </p>
              <div className="trk-key">
                <input className="input mono" readOnly value={show ? secret : masked} aria-label="Clé secrète" onFocus={(e) => show && e.currentTarget.select()} />
                <button type="button" className="btn btn-sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>
                  {show ? <EyeOff size={12} /> : <Eye size={12} />}
                  {show ? "Masquer" : "Afficher"}
                </button>
                <CopyButton text={secret} />
                {ws.canWrite && (
                  <button type="button" className="btn btn-sm" onClick={() => setConfirm(true)}>
                    <RefreshCw size={12} /> Régénérer
                  </button>
                )}
              </div>
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
          {!show && secret && <p className="faint" style={{ fontSize: 12 }}>Les exemples affichent un faux jeton. « Afficher » y insère ta vraie clé.</p>}

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

      {confirm && (
        <ConfirmModal
          title="Régénérer la clé secrète ?"
          text="L'ancienne clé cesse de fonctionner immédiatement : Stripe, Zapier ou ton serveur devront utiliser la nouvelle. Le script du site n'est pas concerné."
          confirmLabel="Régénérer"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            const next = newSecret();
            await mutate(async (sb) => must(await sb.from("tracking_sites").update({ secret_key: next }).eq("id", site.id)), { success: "Nouvelle clé générée" });
            setShow(true);
          }}
        />
      )}
    </div>
  );
}
