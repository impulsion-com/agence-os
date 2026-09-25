import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";

import { PublicProposal, type PublicData } from "@/components/proposals/public-proposal";
import { supabaseAnon, supabaseServer } from "@/lib/supabase/server";

// Toujours rendu à la demande : l'ouverture marque la proposition « vue ».
export const dynamic = "force-dynamic";

/**
 * Un membre connecté de l'espace voit un aperçu (même brouillon) sans marquer la
 * proposition comme vue. Tout autre visiteur passe par la RPC publique.
 */
const load = cache(async (token: string): Promise<PublicData | null> => {
  if (!/^[0-9a-f]{16,64}$/i.test(token)) return null;

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
      return {
        preview: true,
        proposal: p,
        items: items.data ?? [],
        expired: (p.status === "sent" || p.status === "viewed") && !!p.valid_until && p.valid_until < today,
        workspace: ws.data ?? { name: "", accent: "indigo" },
        company: company.data,
        contact: contact.data,
        owner: owner.data,
      } as unknown as PublicData;
    }
  }

  const { data } = await supabaseAnon().rpc("public_proposal", { p_token: token });
  if (!data) return null;
  return { ...(data as object), preview: false } as unknown as PublicData;
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
  return <PublicProposal token={token} data={d} />;
}
