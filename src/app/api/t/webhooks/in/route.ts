import type { NextRequest } from "next/server";

import { json, readBody } from "@/lib/tracking/cors";
import { ConversionSchema, bearer, clientIp, rateLimited, recordConversion, siteBySecretKey } from "@/lib/tracking/ingest";
import { WEBHOOK_FIELDS, readWebhook, type WebhookField } from "@/lib/tracking/sources";

/**
 * Webhook générique : un CRM, un agenda ou tout outil qui sait envoyer du JSON.
 *   POST https://<app>/api/t/webhooks/in?key=sk_…&type=booking[&email=chemin&phone=…&name=…&value=…&id=…&date=…&currency=…]
 * `type` est l'étape de l'entonnoir à compter. Chaque champ peut recevoir un chemin pointé dans les données
 * reçues (payload.attendees.0.email) ; sans chemin, il est cherché par son nom. La clé peut aussi venir
 * de l'en-tête Authorization. Une donnée inexploitable répond 200 : l'outil source ne doit pas la renvoyer en boucle.
 */
export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const key = q.get("key") || bearer(req);
  if (!key) return json({ error: "Clé d'envoi manquante (paramètre ?key=sk_… ou en-tête Authorization)" }, 401);
  if (rateLimited(`wh|${key.slice(0, 12)}|${clientIp(req)}`, 600)) return json({ error: "Trop de requêtes" }, 429);
  const site = await siteBySecretKey(key);
  if (!site) return json({ error: "Clé d'envoi invalide" }, 401);
  const type = (q.get("type") ?? "").trim();
  if (!type) return json({ error: "Paramètre « type » manquant : l'étape à compter (booking, show, purchase…)" }, 400);

  const text = await readBody(req, 256_000);
  if (text === null) return json({ error: "Corps trop volumineux" }, 413);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Certains outils envoient un formulaire encodé plutôt que du JSON
    data = Object.fromEntries(new URLSearchParams(text));
  }

  const paths: Partial<Record<WebhookField, string>> = {};
  for (const f of WEBHOOK_FIELDS) {
    const p = q.get(f);
    if (p) paths[f] = p.slice(0, 200);
  }
  const row = readWebhook(data, type, paths);
  if (!row) return json({ ok: true, ignored: "ni email ni téléphone dans les données reçues" });
  const parsed = ConversionSchema.safeParse(row);
  if (!parsed.success) return json({ ok: true, ignored: parsed.error.issues.map((i) => `${i.path.join(".") || "corps"} : ${i.message}`).join(" ; ") });

  const res = await recordConversion(site, parsed.data, "webhook");
  if (!res.ok) return json({ ok: res.status === 400, ignored: res.status === 400 ? res.error : undefined, error: res.status === 400 ? undefined : res.error }, res.status === 400 ? 200 : res.status);
  return json({ ok: true, duplicate: res.duplicate });
}
