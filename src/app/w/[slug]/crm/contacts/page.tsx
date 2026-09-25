import { ContactsView, type ContactRow } from "@/components/crm/contacts-view";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";
import type { Contact } from "@/lib/types";

export default async function ContactsPage({ params }: PageProps<"/w/[slug]/crm/contacts">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const id = ws.workspace.id;
  const [contacts, acts] = await Promise.all([
    sb.from("contacts").select("*").eq("workspace_id", id).order("first_name"),
    sb.from("crm_activities").select("contact_id, created_at").eq("workspace_id", id).not("contact_id", "is", null).order("created_at", { ascending: false }).limit(2000),
  ]);
  const last = new Map<string, string>();
  for (const a of acts.data ?? []) if (a.contact_id && !last.has(a.contact_id)) last.set(a.contact_id, a.created_at);
  const rows: ContactRow[] = ((contacts.data ?? []) as Contact[]).map((c) => ({ ...c, last_activity: last.get(c.id) ?? null }));
  return <ContactsView contacts={rows} />;
}
