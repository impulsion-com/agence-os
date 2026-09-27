// Outils Propositions commerciales : lister, lire (lignes et totaux), créer depuis le catalogue.
import { z } from "zod";

import { PROPOSAL_STATUS, PROPOSAL_TEMPLATES, computeTotals, effectiveStatus, lineTotal } from "@/components/proposals/lib";
import type { Json } from "@/lib/database.types";
import { dayOffset } from "@/lib/format";
import type { Billing, Proposal, ProposalBlock, ProposalStatus } from "@/lib/types";
import {
  companiesLite, day, isUuid, likeSafe, memberName, money, must, norm, parseDateInput, plural, resolveCompany, resolveContact, resolveDeal,
  resolveProposal, table, truncate, url, zDate,
} from "../helpers";
import { ToolError, defineTool, type McpContext } from "../types";

const STATUSES = ["draft", "sent", "viewed", "accepted", "declined", "expired"] as const;
const statusName = (s: string) => PROPOSAL_STATUS[s as ProposalStatus]?.name ?? s;

interface Item {
  proposal_id: string;
  name: string;
  description: string;
  quantity: number;
  unit_price: number;
  billing: "monthly" | "one_off";
  optional: boolean;
  selected: boolean;
  position: number;
  id: string;
}

async function itemsOf(ctx: McpContext, ids: string[]) {
  if (!ids.length) return [] as Item[];
  const { data } = await ctx.db.from("proposal_items").select("id, proposal_id, name, description, quantity, unit_price, billing, optional, selected, position").in("proposal_id", ids).order("position");
  return (data ?? []).map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })) as Item[];
}

interface Signature {
  proposal_id: string;
  signed_at: string;
  signer_first_name: string;
  signer_last_name: string;
  signer_email: string;
  signer_company: string;
  countersign_required: boolean;
  countersigned_at: string | null;
  countersigner_name: string | null;
  document_hash: string;
}

/** Signatures électroniques (module signature) : lecture seule, aucune signature possible via MCP. */
async function signaturesOf(ctx: McpContext, ids: string[]) {
  if (!ids.length) return new Map<string, Signature>();
  const { data } = await ctx.db
    .from("proposal_signatures")
    .select("proposal_id, signed_at, signer_first_name, signer_last_name, signer_email, signer_company, countersign_required, countersigned_at, countersigner_name, document_hash")
    .eq("workspace_id", ctx.workspace.id)
    .in("proposal_id", ids);
  return new Map(((data ?? []) as Signature[]).map((x) => [x.proposal_id, x]));
}

const signatureState = (sg: Signature | undefined) =>
  !sg ? null : sg.countersigned_at ? "both" : sg.countersign_required ? "countersign_pending" : "signed";
const SIGNATURE_NAME: Record<string, string> = { both: "signée par les deux parties", countersign_pending: "à contre-signer", signed: "signée" };

function totalsText(t: ReturnType<typeof computeTotals>, cur: string) {
  const parts: string[] = [];
  if (t.monthly.count) parts.push(`${money(t.monthly.total, cur)} TTC/mois (${money(t.monthly.net, cur)} HT)`);
  if (t.one_off.count) parts.push(`${money(t.one_off.total, cur)} TTC ponctuel (${money(t.one_off.net, cur)} HT)`);
  return parts.join(" + ") || "aucune ligne";
}

const listProposals = defineTool({
  name: "list_proposals",
  title: "Lister les propositions",
  description: "Liste les propositions commerciales avec numéro, client, statut (draft brouillon, sent envoyée, viewed vue, accepted signée par le client, declined refusée, expired expirée), état de la signature électronique (à contre-signer, signée par les deux parties), montants mensuel et ponctuel, dates d'envoi et de validité.",
  input: z.object({
    status: z.array(z.enum(STATUSES)).optional().describe("accepted = signée"),
    company: z.string().optional(),
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  run: async (a, ctx) => {
    let q = ctx.db.from("proposals").select("id, number, title, company_id, deal_id, status, discount_pct, tax_pct, valid_until, sent_at, accepted_at, owner_id, created_at").eq("workspace_id", ctx.workspace.id);
    if (a.company) q = q.eq("company_id", (await resolveCompany(ctx, a.company)).id);
    if (a.query) q = q.ilike("title", `%${likeSafe(a.query)}%`);
    const rows = must(await q.order("number", { ascending: false }).limit(500), "Lecture des propositions");
    const filtered = rows.filter((p) => !a.status?.length || a.status.includes(effectiveStatus(p as Pick<Proposal, "status" | "valid_until">))).slice(0, a.limit);
    const [items, sigs] = await Promise.all([itemsOf(ctx, filtered.map((p) => p.id)), signaturesOf(ctx, filtered.map((p) => p.id))]);
    const cos = new Map((await companiesLite(ctx)).map((c) => [c.id, c.name]));
    const cur = ctx.workspace.currency;
    const out = filtered.map((p) => {
      const t = computeTotals(items.filter((i) => i.proposal_id === p.id), Number(p.discount_pct), Number(p.tax_pct));
      const sg = sigs.get(p.id);
      return {
        id: p.id, number: p.number, title: p.title, company: cos.get(p.company_id ?? "") ?? null, status: effectiveStatus(p as Pick<Proposal, "status" | "valid_until">),
        signature: signatureState(sg), signed_at: sg?.signed_at ?? null, monthly_ht: t.monthly.net, one_off_ht: t.one_off.net, sent_at: p.sent_at, valid_until: p.valid_until,
      };
    });
    if (!out.length) return { text: "Aucune proposition ne correspond.", data: { proposals: [] } };
    return {
      text: table(
        ["N°", "Titre", "Client", "Statut", "Signature", "Mensuel HT", "Ponctuel HT", "Envoyée", "Valable jusqu'au"],
        out.map((p) => [`#${p.number}`, truncate(p.title, 60), p.company, statusName(p.status), p.signature ? `${SIGNATURE_NAME[p.signature]} (${p.signed_at?.slice(0, 10)})` : "", p.monthly_ht ? money(p.monthly_ht, cur) : "", p.one_off_ht ? money(p.one_off_ht, cur) : "", p.sent_at?.slice(0, 10), p.valid_until]),
      ),
      data: { proposals: out },
    };
  },
});

function blocksText(blocks: ProposalBlock[]) {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "heading" && b.text) out.push(`### ${b.text}`);
    else if (b.type === "text" && b.text) out.push(truncate(b.text, 1200));
    else if (b.type === "kpis") out.push(b.items.filter((i) => i.label).map((i) => `- ${i.label} : ${i.value}`).join("\n"));
    else if (b.type === "timeline") out.push(b.steps.filter((s) => s.title).map((s) => `- ${s.title}${s.duration ? ` (${s.duration})` : ""}${s.detail ? ` : ${s.detail}` : ""}`).join("\n"));
    else if (b.type === "pricing") out.push("[tableau de prix]");
  }
  return out.filter(Boolean).join("\n\n");
}

const getProposal = defineTool({
  name: "get_proposal",
  title: "Détail d'une proposition",
  description: "Détail d'une proposition (numéro, titre ou identifiant) : client, statut, signature électronique (signataire, date, contre-signature, empreinte du document), lignes de prix, remise, TVA, totaux mensuels et ponctuels, contenu rédigé et lien public si elle a été envoyée. La signature se fait uniquement par le client sur la page publique : aucun outil ne peut signer ou accepter une proposition.",
  input: z.object({ proposal: z.string().describe("Numéro (ex. 12), titre ou identifiant"), include_content: z.boolean().default(true).describe("Inclure le texte rédigé") }),
  run: async ({ proposal, include_content }, ctx) => {
    const p = await resolveProposal(ctx, proposal);
    const [items, sigs] = await Promise.all([itemsOf(ctx, [p.id]), signaturesOf(ctx, [p.id])]);
    const sg = sigs.get(p.id);
    const sgState = signatureState(sg);
    const cur = p.currency || ctx.workspace.currency;
    const t = computeTotals(items, Number(p.discount_pct), Number(p.tax_pct));
    const company = (await companiesLite(ctx)).find((c) => c.id === p.company_id)?.name ?? null;
    const contact = p.contact_id ? await resolveContact(ctx, p.contact_id).catch(() => null) : null;
    const status = effectiveStatus(p as unknown as Proposal);
    const publicUrl = p.status !== "draft" ? `${ctx.appUrl}/p/${p.public_token}` : null;
    const text = [
      `# Proposition #${p.number} · ${p.title}`,
      `Statut : ${statusName(status)} · Client : ${company ?? "aucun"}${contact ? ` · Contact : ${`${contact.first_name} ${contact.last_name}`.trim()}` : ""} · Responsable : ${(await memberName(ctx, p.owner_id)) ?? "-"}`,
      `Créée le ${p.created_at.slice(0, 10)}${p.sent_at ? ` · envoyée le ${p.sent_at.slice(0, 10)}` : ""}${p.viewed_at ? ` · vue le ${p.viewed_at.slice(0, 10)}` : ""}${sg ? ` · signée le ${sg.signed_at.slice(0, 10)} par ${`${sg.signer_first_name} ${sg.signer_last_name}`.trim()} <${sg.signer_email}>${sg.signer_company ? ` (${sg.signer_company})` : ""}` : p.accepted_at ? ` · signée le ${p.accepted_at.slice(0, 10)}${p.accepted_name ? ` par ${p.accepted_name}` : ""}` : ""}${p.declined_reason ? ` · refusée : ${p.declined_reason}` : ""} · valable jusqu'au ${day(p.valid_until)}`,
      "",
      table(
        ["Ligne", "Qté", "Prix unitaire", "Total HT", "Facturation", "Option"],
        items.map((i) => [i.name, i.quantity, money(i.unit_price, cur), money(lineTotal(i), cur), i.billing === "monthly" ? "mensuel" : "ponctuel", i.optional ? (i.selected ? "option retenue" : "option") : ""]),
      ) || "Aucune ligne de prix.",
      "",
      sg ? `Signature électronique : ${SIGNATURE_NAME[sgState!]}${sg.countersigned_at ? ` (contre-signée le ${sg.countersigned_at.slice(0, 10)}${sg.countersigner_name ? ` par ${sg.countersigner_name}` : ""})` : ""} · empreinte du document ${sg.document_hash.slice(0, 16)}…` : "",
      `Remise ${Number(p.discount_pct)} % · TVA ${Number(p.tax_pct)} % · Total : ${totalsText(t, cur)}${t.optionsLeft ? ` · options non retenues : ${money(t.optionsLeft, cur)} HT` : ""}`,
      include_content ? `\n## Contenu\n${blocksText((p.blocks as unknown as ProposalBlock[]) ?? []) || "(vide)"}` : "",
      publicUrl ? `\nLien client : ${publicUrl}` : "",
      `Éditeur : ${url.proposal(ctx, p.id)}`,
    ]
      .filter((x) => x !== "")
      .join("\n");
    return {
      text,
      data: {
        id: p.id, number: p.number, title: p.title, status, company, currency: cur,
        signature: sg
          ? { state: sgState, signed_at: sg.signed_at, signer: `${sg.signer_first_name} ${sg.signer_last_name}`.trim(), signer_email: sg.signer_email, countersign_required: sg.countersign_required, countersigned_at: sg.countersigned_at, countersigner: sg.countersigner_name, document_hash: sg.document_hash }
          : null, discount_pct: Number(p.discount_pct), tax_pct: Number(p.tax_pct), valid_until: p.valid_until,
        items: items.map((i) => ({ name: i.name, description: i.description, quantity: i.quantity, unit_price: i.unit_price, billing: i.billing, optional: i.optional, selected: i.selected, total: lineTotal(i) })),
        totals: t,
        public_url: publicUrl,
        url: url.proposal(ctx, p.id),
      },
    };
  },
});

const createProposal = defineTool({
  name: "create_proposal",
  title: "Créer une proposition",
  description: `Crée une proposition commerciale en brouillon, à partir d'un modèle rédigé et/ou de services du catalogue (voir whoami). Modèles : ${PROPOSAL_TEMPLATES.map((t) => `${t.id} (${t.name})`).join(", ")}. Si items est fourni, il remplace les lignes du modèle. Le client et le contact sont repris du deal s'il est indiqué. L'envoi au client se fait ensuite depuis l'application.`,
  write: true,
  input: z.object({
    title: z.string().max(200).optional().describe("Titre (déduit du modèle et du client sinon)"),
    template: z.enum(PROPOSAL_TEMPLATES.map((t) => t.id) as [string, ...string[]]).optional().describe("Modèle de contenu"),
    company: z.string().optional(),
    contact: z.string().optional(),
    deal: z.string().optional(),
    items: z
      .array(
        z.object({
          service: z.string().describe("Nom ou identifiant d'un service du catalogue"),
          quantity: z.number().positive().max(10000).default(1),
          unit_price: z.number().min(0).optional().describe("Prix unitaire (celui du catalogue par défaut)"),
          optional: z.boolean().default(false).describe("Ligne proposée en option"),
          description: z.string().max(1000).optional(),
        }),
      )
      .max(40)
      .optional(),
    discount_pct: z.number().min(0).max(100).default(0),
    tax_pct: z.number().min(0).max(100).default(20),
    valid_until: zDate("Fin de validité (30 jours par défaut)").optional(),
  }),
  run: async (a, ctx) => {
    const tpl = a.template ? PROPOSAL_TEMPLATES.find((t) => t.id === a.template)! : null;
    if (!tpl && !a.items?.length) throw new ToolError("Indique un modèle (template) ou des lignes (items) issues du catalogue.");
    const deal = a.deal ? await resolveDeal(ctx, a.deal) : null;
    const company = a.company ? await resolveCompany(ctx, a.company) : deal?.company_id ? (await companiesLite(ctx)).find((c) => c.id === deal.company_id) ?? null : null;
    const contact = a.contact ? await resolveContact(ctx, a.contact) : null;
    const { data: services } = await ctx.db.from("services").select("id, name, description, unit_price, billing, archived").eq("workspace_id", ctx.workspace.id);
    const catalog = services ?? [];
    const findService = (ref: string) => {
      const s = isUuid(ref) ? catalog.find((x) => x.id === ref.trim()) : catalog.find((x) => norm(x.name) === norm(ref)) ?? (() => {
        const m = catalog.filter((x) => !x.archived && norm(x.name).includes(norm(ref)));
        return m.length === 1 ? m[0] : undefined;
      })();
      if (!s) throw new ToolError(`Service introuvable : « ${ref} ». Catalogue : ${catalog.filter((x) => !x.archived).map((x) => x.name).join(", ") || "vide"}.`);
      return s;
    };
    const lines = a.items?.length
      ? a.items.map((i) => {
          const s = findService(i.service);
          return { service_id: s.id, name: s.name, description: i.description ?? s.description, quantity: i.quantity, unit_price: i.unit_price ?? Number(s.unit_price), billing: s.billing, optional: i.optional, selected: !i.optional };
        })
      : tpl!.lines.map((l) => {
          const s = catalog.find((x) => norm(x.name) === norm(l.service));
          return { service_id: s?.id ?? null, name: s?.name ?? l.service, description: s?.description ?? l.fallback.description, quantity: 1, unit_price: s ? Number(s.unit_price) : l.fallback.unit_price, billing: s?.billing ?? l.fallback.billing, optional: !!l.optional, selected: !l.optional };
        });
    const blocks: ProposalBlock[] = tpl ? tpl.blocks() : [{ id: "h1", type: "heading", text: "Investissement" }, { id: "p1", type: "pricing" }];
    const title = (a.title?.trim() || [tpl?.title || "Proposition", company?.name].filter(Boolean).join(" · ")).slice(0, 200);
    const p = must(
      await ctx.db
        .from("proposals")
        .insert({
          workspace_id: ctx.workspace.id,
          title,
          company_id: company?.id ?? null,
          contact_id: contact?.id ?? deal?.contact_id ?? null,
          deal_id: deal?.id ?? null,
          currency: ctx.workspace.currency,
          valid_until: parseDateInput(a.valid_until, "valid_until") ?? dayOffset(30),
          discount_pct: a.discount_pct,
          tax_pct: a.tax_pct,
          blocks: blocks as unknown as Json,
          owner_id: ctx.user.id,
          number: undefined as unknown as number, // attribué par le déclencheur
        })
        .select("id, number")
        .single(),
      "Création de la proposition",
    );
    if (lines.length) {
      const r = await ctx.db.from("proposal_items").insert(lines.map((l, i) => ({ ...l, proposal_id: p.id, position: i })));
      if (r.error) {
        await ctx.db.from("proposals").delete().eq("id", p.id);
        throw new ToolError(`Création des lignes impossible : ${r.error.message}`);
      }
    }
    const t = computeTotals(lines.map((l, i) => ({ ...l, billing: l.billing as Billing, id: String(i) })), a.discount_pct, a.tax_pct);
    return {
      text: `Proposition **#${p.number} ${title}** créée en brouillon avec ${plural(lines.length, "ligne")} : ${totalsText(t, ctx.workspace.currency)}. Relis-la et envoie-la depuis l'application.\n${url.proposal(ctx, p.id)}`,
      data: { id: p.id, number: p.number, totals: t, url: url.proposal(ctx, p.id) },
    };
  },
});

export const proposalTools = [listProposals, getProposal, createProposal];
