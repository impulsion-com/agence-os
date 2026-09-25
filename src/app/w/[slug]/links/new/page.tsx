import type { Metadata } from "next";

import { BulkEditor } from "@/components/links/bulk-editor";
import { LinkEditor } from "@/components/links/link-editor";
import { loadEditor } from "@/lib/links/load";
import { randomCode } from "@/lib/links/utm";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata: Metadata = { title: "Nouveau lien" };

export default async function NewLinkPage({ params, searchParams }: PageProps<"/w/[slug]/links/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await loadWorkspace(slug);
  const from = typeof sp.from === "string" ? sp.from : null;
  const data = await loadEditor(workspace.id, from);
  if (sp.mode === "bulk") return <BulkEditor presets={data.presets} />;
  // Code aléatoire tiré côté serveur : identique au rendu serveur et à l'hydratation
  return <LinkEditor key={from ?? "new"} mode="create" {...data} seedCode={randomCode()} />;
}
