// Test des notifications du portail client, côté agence (migration 0092) : ce que l'agence partage
// prévient le client, ce qui est interne ne part jamais vers lui, et ses réponses reviennent à l'agence.
// Usage : node --env-file=.env.local scripts/test-portal-agency.mjs
// Prérequis : espace studio-demo avec ses données de démo, et scripts/test-portal-security.mjs lancé une fois
// (il crée le compte client@agence-os.dev rattaché à Maison Lumen). Le script remet tout en l'état.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mk = () => createClient(url, anon, { auth: { persistSession: false } });

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "  ok " : "ECHEC"}  ${name}${detail ? "  " + detail : ""}`);
};
const must = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

const agency = mk();
must(await agency.auth.signInWithPassword({ email: "demo@agence-os.dev", password: "Demo-agence-2026!" }));
const client = mk();
must(await client.auth.signInWithPassword({ email: "client@agence-os.dev", password: "Client-agence-2026!" }));
const me = (await agency.auth.getUser()).data.user.id;
const cid = (await client.auth.getUser()).data.user.id;

const ws = must(await admin.from("workspaces").select("id").eq("slug", "studio-demo").single());
const lumen = must(await admin.from("companies").select("id").eq("workspace_id", ws.id).eq("name", "Maison Lumen").single());
const project = must(await admin.from("projects").select("id, portal_mode").eq("workspace_id", ws.id).eq("key", "LUM").single());
const before = {
  portal: must(await admin.from("client_portals").select("*").eq("company_id", lumen.id).maybeSingle()),
  cu: must(await admin.from("client_users").select("id, features").eq("company_id", lumen.id).eq("user_id", cid).maybeSingle()),
};
if (!before.cu) {
  console.error("Compte client de test absent : lance d'abord scripts/test-portal-security.mjs");
  process.exit(1);
}
const ALL = ["reporting", "tasks", "creatives", "files", "documents", "onboarding", "booking"];
const setPortal = (patch) => admin.from("client_portals").upsert({ company_id: lumen.id, workspace_id: ws.id, enabled: true, features: ALL, ...patch });
await setPortal({});
await admin.from("client_users").update({ features: null }).eq("id", before.cu.id);
await admin.from("projects").update({ portal_mode: "selected" }).eq("id", project.id);

// Objets de test
const task = must(await agency.from("tasks").insert({ workspace_id: ws.id, project_id: project.id, title: "Test portail agence", status: "progress", position: 999999 }).select("id").single());
const concept = must(await agency.from("creative_concepts").insert({ workspace_id: ws.id, company_id: lumen.id, title: "Créa de test portail", owner_id: me, position: 999999 }).select("id").single());
const report = must(await agency.from("reports").insert({ workspace_id: ws.id, company_id: lumen.id, title: "Rapport de test portail", period_start: "2026-09-01", period_end: "2026-09-30", shared: false }).select("id").single());
const file = must(await agency.from("attachments").insert({ workspace_id: ws.id, project_id: project.id, name: "test-portail.pdf", path: `${ws.id}/${project.id}/test-portail-agence.pdf`, size: 1, mime: "application/pdf" }).select("id").single());

const t0 = new Date().toISOString();
const mine = async (who = cid) => must(await admin.from("notifications").select("kind, body, portal_link, task_id, concept_id, actor_id").eq("user_id", who).gte("created_at", t0).order("created_at"));
const reset = () => admin.from("notifications").delete().gte("created_at", t0).in("user_id", [cid, me]);

try {
  console.log("\nTâches");
  await agency.from("tasks").update({ status: "review" }).eq("id", task.id);
  check("tâche masquée en validation : rien pour le client", (await mine()).length === 0);
  await agency.from("tasks").update({ client_visible: true }).eq("id", task.id);
  let n = await mine();
  check("tâche rendue visible en validation : notification", n.length === 1 && n[0].kind === "portal" && n[0].portal_link === `tasks?task=${task.id}` && n[0].actor_id === me, n[0]?.body);
  await agency.from("tasks").update({ title: "Test portail agence (renommée)" }).eq("id", task.id);
  await agency.from("tasks").update({ client_visible: true, status: "review" }).eq("id", task.id);
  check("pas de doublon si rien ne change", (await mine()).length === 1);
  await reset();

  console.log("\nCommentaires");
  await agency.from("comments").insert({ workspace_id: ws.id, task_id: task.id, body: "Note interne de test" });
  check("commentaire interne : rien pour le client", (await mine()).length === 0);
  await agency.from("comments").insert({ workspace_id: ws.id, task_id: task.id, body: "Message partagé de test", visibility: "client" });
  n = await mine();
  check("commentaire partagé : notification", n.length === 1 && n[0].task_id === task.id && n[0].body.includes("Message partagé de test"));
  await reset();
  // Tâche créée par le client : un commentaire interne ne doit pas lui arriver par notify_comment
  await admin.from("tasks").update({ created_by: cid }).eq("id", task.id);
  await agency.from("comments").insert({ workspace_id: ws.id, task_id: task.id, body: "Autre note interne" });
  check("commentaire interne sur une tâche créée par le client : toujours rien", (await mine()).length === 0);
  // Commentaire écrit par le client : l'agence (responsable du projet) est prévenue, pas le client
  await admin.from("tasks").update({ created_by: me, assignee_id: me }).eq("id", task.id);
  await admin.from("comments").insert({ workspace_id: ws.id, task_id: task.id, author_id: cid, body: "Réponse du client", visibility: "client" });
  check("commentaire du client : pas de notification au client", (await mine()).length === 0);
  n = await mine(me);
  check("commentaire du client : l'agence est prévenue", n.some((x) => x.kind === "commented" && x.actor_id === cid && x.body === "Réponse du client"));
  await reset();

  console.log("\nFonctionnalités et portail");
  await admin.from("client_users").update({ features: ["reporting"] }).eq("id", before.cu.id);
  await agency.from("comments").insert({ workspace_id: ws.id, task_id: task.id, body: "Partagé, mais la personne n'a pas les tâches", visibility: "client" });
  check("personne sans la fonctionnalité : rien", (await mine()).length === 0);
  await admin.from("client_users").update({ features: null }).eq("id", before.cu.id);
  await setPortal({ features: ["reporting"] });
  await agency.from("comments").insert({ workspace_id: ws.id, task_id: task.id, body: "Partagé, mais le portail n'ouvre pas les tâches", visibility: "client" });
  check("fonctionnalité fermée sur le portail : rien", (await mine()).length === 0);
  await setPortal({ enabled: false });
  await agency.from("creative_concepts").update({ client_review: "pending" }).eq("id", concept.id);
  check("portail désactivé : rien", (await mine()).length === 0);
  await agency.from("creative_concepts").update({ client_review: null }).eq("id", concept.id);
  await setPortal({});

  console.log("\nCréas");
  await agency.from("creative_concepts").update({ client_review: "pending" }).eq("id", concept.id);
  n = await mine();
  check("créa envoyée en validation : notification", n.length === 1 && n[0].portal_link === `creatives?c=${concept.id}` && n[0].concept_id === concept.id, n[0]?.body);
  await reset();
  await admin.from("creative_concepts").update({ client_review: "changes", client_feedback: "À revoir", client_reviewed_by: cid, client_reviewed_at: new Date().toISOString() }).eq("id", concept.id);
  n = await mine(me);
  check("modifications demandées : le responsable du concept est prévenu", n.length === 1 && n[0].kind === "creative" && n[0].concept_id === concept.id && n[0].body.startsWith("Modifications demandées"), n[0]?.body);
  check("réponse du client : rien pour le client", (await mine()).length === 0);
  await reset();
  await admin.from("creative_concepts").update({ client_review: "approved" }).eq("id", concept.id);
  n = await mine(me);
  check("créa approuvée : le responsable du concept est prévenu", n.length === 1 && n[0].body.startsWith("Créa approuvée"));
  await reset();

  console.log("\nRapports et fichiers");
  await agency.from("reports").update({ shared: true }).eq("id", report.id);
  n = await mine();
  check("rapport publié : notification", n.length === 1 && n[0].portal_link === `performance?report=${report.id}`, n[0]?.body);
  await agency.from("reports").update({ title: "Rapport de test portail (v2)" }).eq("id", report.id);
  check("rapport déjà publié : pas de doublon", (await mine()).length === 1);
  await reset();
  // Les partages de fichiers sont regroupés (une notification non lue par quart d'heure) : on met de côté
  // celles qui existent déjà, le temps du test
  const old = must(await admin.from("notifications").select("id").eq("user_id", cid).eq("portal_link", "files").is("read_at", null)).map((x) => x.id);
  if (old.length) await admin.from("notifications").update({ read_at: t0 }).in("id", old);
  await agency.from("attachments").update({ client_visible: true }).eq("id", file.id);
  n = await mine();
  check("fichier partagé : notification", n.length === 1 && n[0].portal_link === "files", n[0]?.body);
  await agency.from("attachments").update({ client_visible: false }).eq("id", file.id);
  await agency.from("attachments").update({ client_visible: true }).eq("id", file.id);
  check("fichiers partagés coup sur coup : une seule notification non lue", (await mine()).length === 1);
  await reset();

  // Fichier déposé par le client : c'est l'agence qui est prévenue
  const dropped = must(await admin.from("attachments").insert({ workspace_id: ws.id, project_id: project.id, name: "logo-client.png", path: `${ws.id}/${project.id}/portal/test-portail-agence-logo.png`, size: 1, mime: "image/png", uploaded_by: cid, client_visible: true }).select("id").single());
  check("fichier déposé par le client : rien pour le client", (await mine()).length === 0);
  n = await mine(me);
  check("fichier déposé par le client : l'agence est prévenue", n.length === 1 && n[0].kind === "file" && n[0].actor_id === cid && n[0].body.endsWith("logo-client.png"), n[0]?.body);
  await admin.from("attachments").delete().eq("id", dropped.id);
  await reset();
  // Projet en mode « Aucune tâche » : rien n'est montré au client, fichiers compris
  await admin.from("projects").update({ portal_mode: "none" }).eq("id", project.id);
  await agency.from("attachments").update({ client_visible: false }).eq("id", file.id);
  await agency.from("attachments").update({ client_visible: true }).eq("id", file.id);
  check("projet non partagé : fichier coché sans notification", (await mine()).length === 0);
  await admin.from("projects").update({ portal_mode: "selected" }).eq("id", project.id);
  if (old.length) await admin.from("notifications").update({ read_at: null }).in("id", old);

  console.log("\nActions du client par les fonctions du portail (migration 0091)");
  await admin.from("tasks").update({ status: "review", client_visible: true, assignee_id: me, created_by: me }).eq("id", task.id);
  await reset();
  const rv = await client.rpc("portal_task_review", { p_company: lumen.id, p_task: task.id, p_approve: false, p_comment: "Merci de revoir le point 2." });
  if (rv.error && /function .* does not exist|Could not find the function/i.test(rv.error.message)) {
    console.log("        (fonctions portal_* absentes : étape ignorée)");
  } else {
    check("le client demande une modification sur la tâche", !rv.error && rv.data?.status === "progress", rv.error?.message ?? "");
    n = await mine(me);
    check("l'agence reçoit le changement de statut", n.some((x) => x.kind === "status" && x.actor_id === cid && x.body === "Validation client → En cours"));
    check("l'agence reçoit le commentaire du client", n.some((x) => x.kind === "commented" && x.actor_id === cid && x.body === "Merci de revoir le point 2."));
    check("aucune notification pour le client lui-même", (await mine()).length === 0);
    await reset();
    await agency.from("creative_concepts").update({ client_review: "pending" }).eq("id", concept.id);
    await reset();
    const cr = await client.rpc("portal_creative_review", { p_company: lumen.id, p_concept: concept.id, p_approve: true, p_feedback: "" });
    check("le client approuve la créa", !cr.error && cr.data?.review === "approved", cr.error?.message ?? "");
    n = await mine(me);
    check("l'agence reçoit l'approbation", n.length === 1 && n[0].kind === "creative" && n[0].actor_id === cid && n[0].body.startsWith("Créa approuvée"), n[0]?.body);
    await reset();
  }

  console.log("\nStatut");
  // (Le changement de statut PAR un client passe par une fonction portal_* : il est couvert par les tests du portail.)
  await agency.from("tasks").update({ status: "done" }).eq("id", task.id);
  check("tâche terminée par l'agence : aucune notification « à valider » pour le client", (await mine()).length === 0);

  console.log("\nCe que le client ne peut pas faire");
  const r1 = await client.rpc("notify_portal_clients", { p_company: lumen.id, p_feature: "tasks", p_body: "x", p_link: "tasks" });
  check("appeler notify_portal_clients", !!r1.error, r1.error?.code ?? "");
  const r2 = await client.from("notifications").insert({ workspace_id: ws.id, user_id: cid, kind: "portal", body: "x" }).select("id");
  check("se créer une notification", !!r2.error);
  const r3 = await client.rpc("load_demo_portal", { ws: ws.id });
  check("charger les données de démo du portail", !!r3.error);
  const r4 = await client.from("notifications").select("user_id");
  check("lire d'autres notifications que les siennes", !r4.error && r4.data.every((x) => x.user_id === cid));
} finally {
  // Remise en l'état
  await admin.from("notifications").delete().gte("created_at", t0).in("user_id", [cid, me]);
  await admin.from("activity").delete().eq("workspace_id", ws.id).eq("meta->>concept_id", concept.id);
  await admin.from("tasks").delete().eq("id", task.id);
  await admin.from("creative_concepts").delete().eq("id", concept.id);
  await admin.from("reports").delete().eq("id", report.id);
  await admin.from("attachments").delete().eq("id", file.id);
  await admin.from("projects").update({ portal_mode: project.portal_mode }).eq("id", project.id);
  await admin.from("client_users").update({ features: before.cu.features }).eq("id", before.cu.id);
  if (before.portal) await admin.from("client_portals").upsert(before.portal);
  else await admin.from("client_portals").delete().eq("company_id", lumen.id);
}

console.log(failed ? `\n${failed} vérification(s) en échec` : "\nToutes les vérifications passent");
process.exit(failed ? 1 : 0);
