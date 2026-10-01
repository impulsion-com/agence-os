// Test de sécurité du portail client : un compte client ne doit lire AUCUNE table en direct,
// seulement ses propres lignes, et les fonctions portal_* doivent refuser les autres entreprises.
// Usage : node --env-file=.env.local scripts/test-portal-security.mjs   (espace de démo studio-demo requis)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mk = () => createClient(url, anon, { auth: { persistSession: false } });
export const CLIENT = { email: "client@agence-os.dev", password: "Client-agence-2026!" };

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "  ok " : "ECHEC"}  ${name}${detail ? "  " + detail : ""}`);
};

async function signIn(email, password, name) {
  const sb = mk();
  let r = await sb.auth.signInWithPassword({ email, password });
  if (r.error) r = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
  if (r.error) throw r.error;
  return sb;
}

const { data: ws } = await admin.from("workspaces").select("id").eq("slug", "studio-demo").single();
const { data: cos } = await admin.from("companies").select("id, name").eq("workspace_id", ws.id);
const lumen = cos.find((c) => c.name === "Maison Lumen");
const kalia = cos.find((c) => c.name === "Kalia Cosmetics");

// Mise en place : portail Maison Lumen ouvert sur reporting + tâches, invitation du client
await admin.from("client_portals").upsert({ company_id: lumen.id, workspace_id: ws.id, enabled: true, features: ["reporting", "tasks"] });
await admin.from("client_portals").upsert({ company_id: kalia.id, workspace_id: ws.id, enabled: true });
const client = await signIn(CLIENT.email, CLIENT.password, "Claire Dubois");
const intrus = await signIn("intrus@agence-os.dev", "Demo-agence-2026!", "Intrus");
const { data: me } = await client.auth.getUser();
await admin.from("client_users").delete().eq("user_id", me.user.id);
const { data: inv } = await admin
  .from("client_invitations")
  .upsert({ workspace_id: ws.id, company_id: lumen.id, email: CLIENT.email, revoked_at: null, accepted_at: null }, { onConflict: "company_id,email" })
  .select("token")
  .single();

console.log("\nInvitation");
const wrong = await intrus.rpc("accept_client_invitation", { p_token: inv.token });
check("un autre compte ne peut pas utiliser le lien", !!wrong.error, wrong.error?.message ?? "");
const acc = await client.rpc("accept_client_invitation", { p_token: inv.token });
check("le bon compte accepte l'invitation", !acc.error && acc.data?.slug === "studio-demo", acc.error?.message ?? "");

console.log("\nLecture directe des tables (doit être vide ou refusée)");
const types = readFileSync("src/lib/database.types.ts", "utf8");
const block = types.slice(types.indexOf("Tables: {"), types.indexOf("Views: {"));
const tables = [...block.matchAll(/^      ([a-z_0-9]+): \{$/gm)].map((m) => m[1]);
const OWN = { client_users: 1, profiles: 1 }; // ses propres lignes uniquement
for (const t of tables) {
  const { data, error } = await client.from(t).select("*").limit(1000);
  const n = data?.length ?? 0;
  if (t in OWN) check(t, !error && n <= OWN[t], `${n} ligne(s) (les siennes)`);
  else if (t === "notifications") check(t, !error && (data ?? []).every((r) => r.user_id === me.user.id), `${n} à lui`);
  else check(t, n === 0, error ? `refusé (${error.code})` : "0 ligne");
}
const views = [...types.slice(types.indexOf("Views: {"), types.indexOf("Functions: {")).matchAll(/^      ([a-z_0-9]+): \{$/gm)].map((m) => m[1]);
for (const v of views) {
  const { data, error } = await client.from(v).select("*").limit(1000);
  check(`vue ${v}`, (data?.length ?? 0) === 0, error ? `refusé (${error.code})` : "0 ligne");
}

console.log("\nÉcriture directe (doit être refusée)");
const w1 = await client.from("tasks").update({ title: "piraté" }).eq("workspace_id", ws.id).select("id");
check("modifier des tâches", (w1.data?.length ?? 0) === 0);
const w2 = await client.from("client_users").update({ features: null, company_id: kalia.id }).eq("user_id", me.user.id).select("id");
check("élargir ses propres droits", (w2.data?.length ?? 0) === 0);
const w3 = await client.from("client_users").insert({ workspace_id: ws.id, company_id: kalia.id, user_id: me.user.id }).select("id");
check("s'ajouter à une autre entreprise", !!w3.error);
const w4 = await client.from("workspace_members").insert({ workspace_id: ws.id, user_id: me.user.id, role: "admin" }).select("user_id");
check("se déclarer membre de l'espace", !!w4.error);
const w5 = await client.from("client_portals").update({ features: ["reporting", "tasks", "files"] }).eq("company_id", lumen.id).select("company_id");
check("ouvrir des fonctionnalités du portail", (w5.data?.length ?? 0) === 0);

console.log("\nFonctions de contrôle d'accès");
const f1 = await client.rpc("portal_features", { p_company: lumen.id });
check("ses fonctionnalités sur Maison Lumen", JSON.stringify([...(f1.data ?? [])].sort()) === '["reporting","tasks"]', JSON.stringify(f1.data));
const f2 = await client.rpc("portal_features", { p_company: kalia.id });
check("aucune fonctionnalité sur Kalia", (f2.data ?? []).length === 0, JSON.stringify(f2.data));
const f3 = await client.rpc("portal_can", { p_company: lumen.id, p_feature: "files" });
check("fonctionnalité non ouverte refusée", f3.data === false);
const f4 = await intrus.rpc("portal_features", { p_company: lumen.id });
check("un inconnu n'a rien", (f4.data ?? []).length === 0);
const pm = await client.rpc("portal_me");
check("portal_me ne liste que Maison Lumen", pm.data?.length === 1 && pm.data[0].company === "Maison Lumen");

// Les agents ajoutent ici les tests de leurs fonctions portal_* (voir scripts/test-portal-rpc.mjs)
console.log(failed ? `\n${failed} vérification(s) en échec` : "\nToutes les vérifications passent");
process.exit(failed ? 1 : 0);
