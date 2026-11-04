import type { Metadata } from "next";

import { DocsHome } from "@/components/docs/home";

export const metadata: Metadata = { title: "Docs & process" };

export default function DocsPage() {
  return <DocsHome />;
}
