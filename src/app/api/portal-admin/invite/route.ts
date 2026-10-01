import type { NextRequest } from "next/server";
import { z } from "zod";

import { emailEnabled } from "@/lib/email";
import { ALL_PORTAL_FEATURES } from "@/lib/portal-admin/features";
import { appOrigin, json, sendPortalInvite } from "@/lib/portal-admin/server";
import { supabaseServer } from "@/lib/supabase/server";

const Body = z.object({ invitation_id: z.string().uuid(), reminder: z.boolean().optional() });

/** GET /api/portal-admin/invite : l'envoi d'emails est-il configuré ? (l'interface adapte ses textes) */
export async function GET() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return json({ error: "Connexion requise" }, 401);
  return json({ emailEnabled: emailEnabled() });
}

/**
 * POST /api/portal-admin/invite : envoie (ou relance) par email l'invitation au portail client.
 * Réservé aux membres non invités de l'espace. Sans configuration Resend, renvoie { sent: false, url } :
 * l'agence copie le lien et l'envoie elle-même.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Requête invalide" }, 400);
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return json({ error: "Connexion requise" }, 401);

  // Lecture avec les droits de l'utilisateur : la RLS ne montre les invitations qu'aux membres non invités,
  // et le rôle est revérifié explicitement.
  const { data: inv } = await sb
    .from("client_invitations")
    .select("id, workspace_id, company_id, email, features, contact_id, token, accepted_at, revoked_at")
    .eq("id", parsed.data.invitation_id)
    .maybeSingle();
  if (!inv) return json({ error: "Invitation introuvable" }, 404);
  const { data: canWrite } = await sb.rpc("can_write", { ws: inv.workspace_id });
  if (!canWrite) return json({ error: "Réservé aux membres de l'espace" }, 403);
  if (inv.revoked_at) return json({ error: "Cette invitation a été révoquée" }, 409);
  if (inv.accepted_at) return json({ error: "Cette invitation a déjà été acceptée" }, 409);

  const url = `${appOrigin(req)}/invite/c/${inv.token}`;
  if (!emailEnabled()) return json({ sent: false, url, emailEnabled: false });

  const [{ data: ws }, { data: company }, { data: portal }, { data: contact }, { data: me }] = await Promise.all([
    sb.from("workspaces").select("name").eq("id", inv.workspace_id).single(),
    sb.from("companies").select("name").eq("id", inv.company_id).single(),
    sb.from("client_portals").select("features, welcome").eq("company_id", inv.company_id).maybeSingle(),
    inv.contact_id ? sb.from("contacts").select("first_name").eq("id", inv.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("profiles").select("email").eq("id", auth.user.id).single(),
  ]);
  const open = portal?.features ?? ALL_PORTAL_FEATURES;
  const r = await sendPortalInvite({
    to: inv.email,
    firstName: contact?.first_name ?? "",
    agency: ws?.name ?? "",
    company: company?.name ?? "",
    features: inv.features ? inv.features.filter((f) => open.includes(f)) : open,
    url,
    welcome: portal?.welcome ?? "",
    reminder: !!parsed.data.reminder,
    replyTo: me?.email,
  });
  return json({ sent: r.sent, url, email: r.sent ? inv.email : undefined, error: r.error, emailEnabled: true });
}
