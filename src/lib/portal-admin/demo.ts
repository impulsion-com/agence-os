import "server-only";

import type { supabaseAdmin } from "@/lib/supabase/server";

// Fichiers d'exemple partagés sur le portail client (données de démo).
// La fonction SQL _demo_portal ne peut pas écrire dans le Storage : ces deux petits fichiers sont
// générés ici, déposés dans le bucket « attachments » et marqués « partagés avec le client ».
// Leur chemin contient « demo-portail- » : _clear_demo_portal supprime les lignes correspondantes.

type Admin = ReturnType<typeof supabaseAdmin>;
const BUCKET = "attachments";
const MARK = "demo-portail-";

/** PDF d'une page, texte simple (Helvetica, accents en WinAnsi). */
function tinyPdf(title: string, lines: string[]) {
  const esc = (s: string) =>
    [...s].map((ch) => {
      const c = ch.charCodeAt(0);
      if (ch === "(" || ch === ")" || ch === "\\") return "\\" + ch;
      if (c < 128) return ch;
      return c < 256 ? "\\" + c.toString(8).padStart(3, "0") : "?";
    }).join("");
  const text =
    `BT /F1 18 Tf 56 770 Td (${esc(title)}) Tj ET\n` +
    lines.map((l, i) => `BT /F1 11 Tf 56 ${735 - i * 18} Td (${esc(l)}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const FILES: { project: string; name: string; slug: string; mime: string; body: () => Buffer }[] = [
  {
    project: "LUM",
    name: "Compte rendu du point mensuel.pdf",
    slug: "compte-rendu-point-mensuel.pdf",
    mime: "application/pdf",
    body: () =>
      tinyPdf("Compte rendu du point mensuel", [
        "Maison Lumen, campagnes Meta Ads du trimestre",
        "",
        "1. Résultats : le ROAS progresse, porté par les suspensions et les lampadaires.",
        "2. Créas : six concepts statiques et trois vidéos UGC sont en cours de validation.",
        "3. Black Friday : structure prête, mise en ligne prévue une semaine avant l'opération.",
        "",
        "Prochaines étapes",
        "- Valider les concepts envoyés sur le portail.",
        "- Nous transmettre le catalogue produits à jour.",
        "- Confirmer le budget média de la période.",
      ]),
  },
  {
    project: "LUM",
    name: "Planning des campagnes.csv",
    slug: "planning-des-campagnes.csv",
    mime: "text/csv",
    body: () =>
      Buffer.from(
        "﻿Semaine;Campagne;Objectif;Budget hebdomadaire\n" +
          "S-3;Teasing collection hiver;Notoriété;600 €\n" +
          "S-2;Liste d'attente Black Friday;Leads;900 €\n" +
          "S-1;Advantage+ Shopping;Ventes;1 500 €\n" +
          "Black Friday;Offre -20 % suspensions;Ventes;2 400 €\n" +
          "S+1;Reciblage paniers abandonnés;Ventes;700 €\n",
        "utf8",
      ),
  },
  {
    project: "KAL",
    name: "Scripts UGC octobre.pdf",
    slug: "scripts-ugc-octobre.pdf",
    mime: "application/pdf",
    body: () =>
      tinyPdf("Scripts UGC, sprint d'octobre", [
        "Kalia Cosmetics",
        "",
        "Script 1 : « Ma peau tiraille après la douche »",
        "Accroche face caméra, démonstration du sérum, résultat après 14 jours.",
        "",
        "Script 2 : « 5 ingrédients, rien d'autre »",
        "Lecture de l'étiquette, comparaison avec une crème classique, appel à l'action.",
        "",
        "Script 3 : « Une dermato répond aux commentaires »",
        "Trois questions fréquentes, réponses courtes, renvoi vers la routine complète.",
      ]),
  },
];

/** Dépose les fichiers d'exemple dans les projets de démo et les partage avec le client. */
export async function seedDemoPortalFiles(admin: Admin, ws: string, uid: string): Promise<{ error: { message: string } | null }> {
  const { data: projects, error } = await admin.from("projects").select("id, key").eq("workspace_id", ws).in("key", ["LUM", "KAL"]);
  if (error) return { error };
  for (const f of FILES) {
    const p = projects?.find((x) => x.key === f.project);
    if (!p) continue;
    const path = `${ws}/${p.id}/${MARK}${f.slug}`;
    const body = f.body();
    const up = await admin.storage.from(BUCKET).upload(path, body, { contentType: f.mime, upsert: true });
    if (up.error) return { error: { message: `Fichier de démo : ${up.error.message}` } };
    await admin.from("attachments").delete().eq("workspace_id", ws).eq("path", path);
    const ins = await admin
      .from("attachments")
      .insert({ workspace_id: ws, project_id: p.id, name: f.name, path, size: body.length, mime: f.mime, uploaded_by: uid, client_visible: true });
    if (ins.error) return { error: ins.error };
  }
  return { error: null };
}

/** Retire du Storage les fichiers d'exemple (à appeler avant clear_demo_portal, qui supprime les lignes). */
export async function removeDemoPortalFiles(admin: Admin, ws: string): Promise<{ error: { message: string } | null }> {
  const { data } = await admin.from("attachments").select("path").eq("workspace_id", ws).like("path", `%/${MARK}%`);
  if (data?.length) await admin.storage.from(BUCKET).remove(data.map((a) => a.path));
  return { error: null };
}
