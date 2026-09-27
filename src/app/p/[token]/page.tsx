import type { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";

import { PublicProposal, type PublicData } from "@/components/proposals/public-proposal";
import { signatureFont } from "@/components/proposals/signature-font";
import { emailEnabled } from "@/lib/email";
import { clientInfo, logOpened, publicSignature, signatureOf, TOKEN_RE } from "@/lib/signature/server";
import type { SignatureSnapshot } from "@/lib/signature/types";
import { supabaseAdmin, supabaseAnon, supabaseServer } from "@/lib/supabase/server";

// Toujours rendu à la demande : l'ouverture marque la proposition « vue ».
export const dynamic = "force-dynamic";

/** Une proposition signée s'affiche telle qu'elle a été signée (instantané figé), jamais dans sa version modifiable. */
function applySnapshot(d: PublicData, s: SignatureSnapshot): PublicData {
  return {
    ...d,
    expired: false,
    proposal: {
      ...d.proposal,
      number: s.document.number,
      title: s.document.title,
      currency: s.document.currency,
      discount_pct: s.document.discount_pct,
      tax_pct: s.document.tax_pct,
      valid_until: s.document.valid_until,
      sent_at: s.document.date,
      blocks: s.document.blocks,
    },
    items: s.items,
    workspace: { ...d.workspace, name: s.parties.agency || d.workspace.name },
    company: s.parties.client ? { name: s.parties.client } : null,
    contact: s.parties.contact ? { first_name: s.parties.contact, last_name: "" } : null,
  };
}

/**
 * Un membre connecté de l'espace voit un aperçu (même brouillon) sans marquer la
 * proposition comme vue. Tout autre visiteur passe par la RPC publique.
 */
const load = cache(async (token: string): Promise<PublicData | null> => {
  if (!TOKEN_RE.test(token)) return null;
  const admin = supabaseAdmin();
  const otpRequired = emailEnabled();

  const withSignature = async (d: PublicData, proposalId: string) => {
    const sig = await signatureOf(admin, proposalId);
    if (!sig) return d;
    return { ...applySnapshot(d, sig.snapshot as unknown as SignatureSnapshot), signature: await publicSignature(admin, sig) };
  };

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (auth.user) {
    const { data: p } = await sb.from("proposals").select("*").eq("public_token", token).maybeSingle();
    if (p) {
      const [items, ws, company, contact, owner] = await Promise.all([
        sb.from("proposal_items").select("*").eq("proposal_id", p.id).order("position"),
        sb.from("workspaces").select("name, accent").eq("id", p.workspace_id).single(),
        p.company_id ? sb.from("companies").select("name").eq("id", p.company_id).single() : Promise.resolve({ data: null }),
        p.contact_id ? sb.from("contacts").select("first_name, last_name").eq("id", p.contact_id).single() : Promise.resolve({ data: null }),
        p.owner_id ? sb.from("profiles").select("full_name, email, title").eq("id", p.owner_id).single() : Promise.resolve({ data: null }),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const d = {
        preview: true,
        proposal: p,
        items: items.data ?? [],
        expired: (p.status === "sent" || p.status === "viewed") && !!p.valid_until && p.valid_until < today,
        workspace: ws.data ?? { name: "", accent: "indigo" },
        company: company.data,
        contact: contact.data,
        owner: owner.data,
        signature: null,
        otpRequired,
      } as unknown as PublicData;
      return withSignature(d, p.id);
    }
  }

  const { data } = await supabaseAnon().rpc("public_proposal", { p_token: token });
  if (!data) return null;
  const d = { ...(data as object), preview: false, signature: null, otpRequired } as unknown as PublicData;
  const { data: row } = await admin.from("proposals").select("id, workspace_id").eq("public_token", token).maybeSingle();
  if (!row) return d;
  const h = await headers();
  const info = clientInfo(h);
  after(() => logOpened(admin, row, info).catch(() => {}));
  return withSignature(d, row.id);
});

export async function generateMetadata({ params }: PageProps<"/p/[token]">): Promise<Metadata> {
  const { token } = await params;
  const d = await load(token);
  return {
    title: d ? { absolute: `${d.proposal.title} · ${d.workspace.name}` } : "Proposition introuvable",
    robots: { index: false, follow: false },
  };
}

export default async function PublicProposalPage({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
  const d = await load(token);
  if (!d) notFound();
  return <PublicProposal token={token} data={d} signatureFont={signatureFont.style.fontFamily} />;
}
