// Outils de prospection : import des fiches Google Maps (sorties de gosom/google-maps-scraper
// ou d'un autre outil), lecture filtrée et ajout au CRM. Même logique que l'écran /crm/prospects.
import { z } from "zod";

import { addProspectsToCrm, bestEmail, importProspects, normalizeProspect, PROSPECT_STATUS, type Prospect, type ProspectInput } from "@/lib/prospects";
import { isUuid, likeSafe, must, plural, table, truncate, url } from "../helpers";
import { ToolError, defineTool } from "../types";

const fr = (n: number) => String(n).replace(".", ",");

const zProspect = z.object({
  name: z.string().min(1).max(200).describe("Nom de l'entreprise (colonne « title » de gosom)"),
  place_id: z.string().max(200).optional().describe("Identifiant Google (place_id, sinon cid) : évite les doublons d'un import à l'autre"),
  category: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  website: z.string().max(500).optional(),
  emails: z.union([z.array(z.string().max(200)).max(20), z.string().max(2000)]).optional().describe("Emails trouvés sur le site (liste, ou texte séparé par des virgules). Les faux emails (noms d'images) sont retirés."),
  rating: z.number().min(0).max(5).optional().describe("Note Google (review_rating)"),
  reviews: z.number().int().min(0).optional().describe("Nombre d'avis (review_count)"),
  maps_url: z.string().max(500).optional().describe("Lien de la fiche Google Maps (link)"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const importTool = defineTool({
  name: "import_prospects",
  title: "Importer des fiches de prospection",
  description:
    "Ajoute des entreprises à la prospection (onglet CRM > Prospection), sans les mettre encore au CRM. Prévu pour les résultats de google-maps-scraper (gosom) : correspondance des colonnes title → name, review_rating → rating, review_count → reviews, link → maps_url, place_id → place_id, complete_address.city / postal_code → city / postal_code. Écarte toi-même les fiches fermées définitivement. Les fiches déjà présentes (même place_id, ou même nom et code postal) sont ignorées. Jusqu'à 1 000 fiches par appel : découpe au-delà.",
  write: true,
  input: z.object({
    search: z.string().max(200).optional().describe("Recherche qui a produit ces fiches, par exemple « agence immobilière Nantes »"),
    prospects: z.array(zProspect).min(1).max(1000),
  }),
  run: async (a, ctx) => {
    const rows = a.prospects
      .map((p) => normalizeProspect({ ...p, source: "google_maps", external_id: p.place_id, search: a.search }))
      .filter((p): p is ProspectInput => !!p);
    const res = await importProspects(ctx.db, { workspaceId: ctx.workspace.id, userId: ctx.user.id, rows });
    const withEmail = rows.filter((r) => r.emails.length).length;
    return {
      text: `${plural(res.imported, "fiche importée", "fiches importées")}${res.duplicates ? `, ${plural(res.duplicates, "déjà présente", "déjà présentes")}` : ""}. ${withEmail} sur ${rows.length} ont un email. À trier dans ${url.base(ctx)}/crm/prospects, ou avec add_prospects_to_crm.`,
      data: { ...res, with_email: withEmail, url: `${url.base(ctx)}/crm/prospects` },
    };
  },
});

const listTool = defineTool({
  name: "list_prospects",
  title: "Lister les fiches de prospection",
  description: "Liste les fiches de prospection avec filtres (statut, catégorie, ville, email, site, note, avis). Par défaut les fiches à trier, les mieux notées et les plus commentées d'abord.",
  input: z.object({
    status: z.enum(["new", "added", "ignored", "all"]).default("new").describe("new = à trier, added = au CRM, ignored = écartée"),
    query: z.string().max(80).optional().describe("Texte dans le nom, la catégorie ou la recherche d'origine"),
    category: z.string().max(120).optional(),
    city: z.string().max(120).optional(),
    has_email: z.boolean().optional(),
    has_website: z.boolean().optional(),
    min_rating: z.number().min(0).max(5).optional(),
    min_reviews: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(300).default(50),
  }),
  run: async (a, ctx) => {
    let q = ctx.db.from("prospects").select("id, name, category, city, phone, website, emails, rating, reviews, status, search, company_id").eq("workspace_id", ctx.workspace.id);
    if (a.status !== "all") q = q.eq("status", a.status);
    if (a.query) {
      const s = likeSafe(a.query);
      q = q.or(`name.ilike.%${s}%,category.ilike.%${s}%,search.ilike.%${s}%`);
    }
    if (a.category) q = q.ilike("category", likeSafe(a.category));
    if (a.city) q = q.ilike("city", likeSafe(a.city));
    if (a.has_email) q = q.not("emails", "eq", "{}");
    if (a.has_website) q = q.neq("website", "");
    if (a.min_rating !== undefined) q = q.gte("rating", a.min_rating);
    if (a.min_reviews !== undefined) q = q.gte("reviews", a.min_reviews);
    const rows = must(await q.order("rating", { ascending: false, nullsFirst: false }).order("reviews", { ascending: false, nullsFirst: false }).limit(a.limit), "Lecture de la prospection");
    if (!rows.length) return { text: "Aucune fiche ne correspond.", data: { prospects: [] } };
    return {
      text: table(
        ["Entreprise", "Catégorie", "Ville", "Note", "Email", "Téléphone", "Statut", "Id"],
        rows.map((p) => [truncate(p.name, 50), truncate(p.category, 30), p.city, p.rating !== null ? `${fr(Number(p.rating))} (${p.reviews ?? 0})` : "", bestEmail(p.emails), p.phone, PROSPECT_STATUS[p.status as Prospect["status"]]?.name ?? p.status, p.id]),
      ),
      data: { prospects: rows },
    };
  },
});

const addTool = defineTool({
  name: "add_prospects_to_crm",
  title: "Ajouter des fiches au CRM",
  description:
    "Passe des fiches de prospection au CRM : crée l'entreprise en prospect (ou reprend celle du même nom), un contact avec le meilleur email et le téléphone, et par défaut un deal à la première étape du pipeline (source « Prospection »). Confirme la liste avec l'utilisateur avant d'ajouter plus de 20 fiches.",
  write: true,
  input: z.object({
    ids: z.array(z.string()).min(1).max(200).describe("Identifiants des fiches (list_prospects)"),
    with_deal: z.boolean().default(true).describe("Ouvrir un deal pour chaque entreprise"),
  }),
  run: async (a, ctx) => {
    const ids = a.ids.filter(isUuid);
    if (!ids.length) throw new ToolError("Aucun identifiant de fiche valide : utilise les « Id » de list_prospects.");
    let res;
    try {
      res = await addProspectsToCrm(ctx.db, { workspaceId: ctx.workspace.id, ownerId: ctx.user.id, ids, withDeal: a.with_deal });
    } catch (e) {
      throw new ToolError(`Ajout au CRM impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.companies.length) return { text: "Ces fiches sont déjà au CRM, ou n'existent pas dans cet espace.", data: { ...res } };
    for (const d of res.deals) await ctx.log({ verb: "deal.created", deal_id: d.id, meta: { title: d.title, value: 0, via: "prospection" } });
    const created = res.companies.filter((c) => c.created);
    return {
      text: [
        `${plural(created.length, "entreprise créée", "entreprises créées")} en prospect${res.companies.length > created.length ? `, ${plural(res.companies.length - created.length, "déjà présente", "déjà présentes")} au CRM` : ""}, ${plural(res.contacts, "contact")}, ${plural(res.deals.length, "deal")}.`,
        ...res.companies.slice(0, 20).map((c) => `- ${c.name} ${url.company(ctx, c.id)}`),
      ].join("\n"),
      data: { ...res },
    };
  },
});

export const prospectTools = [importTool, listTool, addTool];
