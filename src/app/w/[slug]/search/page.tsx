import { SearchView, type SearchResults } from "@/components/workspace/search";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Recherche" };

export default async function Search({ params, searchParams }: PageProps<"/w/[slug]/search">) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? "").trim().slice(0, 80);
  const ws = await loadWorkspace(slug);

  let results: SearchResults | null = null;
  // Les caractères réservés de la syntaxe de filtre PostgREST sont retirés
  const term = q.replace(/[%,()*\\]/g, " ").trim();
  if (term.length >= 2) {
    const sb = await supabaseServer();
    const id = ws.workspace.id;
    const like = `%${term}%`;
    const [tasks, projects, companies, contacts, deals, proposals] = await Promise.all([
      sb
        .from("tasks")
        .select("id, title, number, status, priority, project_id, due_date, assignee_id")
        .eq("workspace_id", id)
        .is("archived_at", null)
        .or(`title.ilike.${like},description.ilike.${like}`)
        .order("updated_at", { ascending: false })
        .limit(25),
      sb.from("projects").select("id, key, name, status, icon, color, company_id, archived_at").eq("workspace_id", id).or(`name.ilike.${like},description.ilike.${like},key.ilike.${like}`).limit(10),
      sb.from("companies").select("id, name, status, industry, website, color").eq("workspace_id", id).or(`name.ilike.${like},website.ilike.${like},industry.ilike.${like}`).limit(10),
      sb
        .from("contacts")
        .select("id, first_name, last_name, email, job_title, company_id")
        .eq("workspace_id", id)
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},job_title.ilike.${like}`)
        .limit(10),
      sb.from("deals").select("id, title, value, billing, company_id, stage:pipeline_stages(name, color)").eq("workspace_id", id).ilike("title", like).limit(10),
      sb.from("proposals").select("id, title, number, status, company_id").eq("workspace_id", id).ilike("title", like).limit(10),
    ]);
    results = {
      tasks: (tasks.data ?? []) as SearchResults["tasks"],
      projects: (projects.data ?? []) as SearchResults["projects"],
      companies: (companies.data ?? []) as SearchResults["companies"],
      contacts: (contacts.data ?? []) as SearchResults["contacts"],
      deals: (deals.data ?? []) as unknown as SearchResults["deals"],
      proposals: (proposals.data ?? []) as SearchResults["proposals"],
    };
  }

  return <SearchView q={q} results={results} />;
}
