import { createHmac, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { json, readBody } from "@/lib/tracking/cors";
import { recordConversion, siteBySecretKey } from "@/lib/tracking/ingest";

/**
 * Adaptateur Stripe → conversion. URL du webhook à déclarer dans Stripe :
 *   https://<app>/api/t/webhooks/stripe?key=sk_…
 * Évènements traités : checkout.session.completed (paiement réussi) et invoice.paid (abonnements).
 * Si STRIPE_WEBHOOK_SECRET est défini, la signature « Stripe-Signature » est vérifiée.
 * Pour relier l'achat au visiteur, passe window.aos.id en client_reference_id (ou metadata.aos_id).
 */
function verify(payload: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const got = Buffer.from(p.slice(3));
      const want = Buffer.from(expected);
      return got.length === want.length && timingSafeEqual(got, want);
    });
}

interface StripeObject {
  id: string;
  amount_total?: number | null;
  amount_paid?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  metadata?: Record<string, string> | null;
  payment_status?: string;
  created?: number;
}

export async function POST(req: NextRequest) {
  const site = await siteBySecretKey(req.nextUrl.searchParams.get("key") ?? "");
  if (!site) return json({ error: "Clé secrète invalide (paramètre ?key=sk_…)" }, 401);
  const payload = await readBody(req, 512_000);
  if (payload === null) return json({ error: "Corps trop volumineux" }, 413);

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret && !verify(payload, req.headers.get("stripe-signature") ?? "", secret)) return json({ error: "Signature Stripe invalide" }, 400);

  let event: { type?: string; data?: { object?: StripeObject } };
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "JSON invalide" }, 400);
  }
  const o = event.data?.object;
  if (!o || (event.type !== "checkout.session.completed" && event.type !== "invoice.paid")) return json({ ok: true, ignored: event.type ?? null });
  if (event.type === "checkout.session.completed" && o.payment_status && o.payment_status !== "paid" && o.payment_status !== "no_payment_required")
    return json({ ok: true, ignored: "paiement en attente" });

  const email = o.customer_details?.email ?? o.customer_email ?? undefined;
  const anon = o.metadata?.aos_id ?? o.client_reference_id ?? undefined;
  const cents = event.type === "invoice.paid" ? o.amount_paid : o.amount_total;
  const res = await recordConversion(
    site,
    {
      email,
      anon_id: anon && /^[A-Za-z0-9_-]{8,64}$/.test(anon) ? anon : undefined,
      type: "purchase",
      value: typeof cents === "number" ? cents / 100 : undefined,
      currency: o.currency?.toUpperCase() ?? undefined,
      order_id: o.id,
      name: o.customer_details?.name ?? undefined,
      phone: o.customer_details?.phone ?? undefined,
      ts: o.created,
      props: { stripe_event: event.type },
    },
    "stripe",
  );
  if (!res.ok) return json({ error: res.error }, res.status === 400 ? 200 : res.status); // 200 : pas de relance Stripe sur une donnée inexploitable
  return json({ ok: true, duplicate: res.duplicate });
}
