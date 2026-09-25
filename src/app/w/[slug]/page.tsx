import { HomeView, type HomeData } from "@/components/workspace/home";
import { ACTIVITY_SELECT, LITE_TASK_SELECT, type ActivityRow, type LiteTask } from "@/components/workspace/lite";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace/load";

export const metadata = { title: "Accueil" };

export default async function Home({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const ws = await loadWorkspace(slug);
  const sb = await supabaseServer();
  const id = ws.workspace.id;

  const [tasks, activity, deals, stages, companies, followups, spend] = await Promise.all([
    sb.from("tasks").select(LITE_TASK_SELECT).eq("workspace_id", id).is("archived_at", null),
    sb.from("activity").select(ACTIVITY_SELECT).eq("workspace_id", id).order("created_at", { ascending: false }).limit(8),
    sb.from("deals").select("id, value, billing, stage_id, company_id").eq("workspace_id", id),
    sb.from("pipeline_stages").select("id, probability, kind").eq("workspace_id", id),
    sb.from("companies").select("id, status, monthly_retainer").eq("workspace_id", id),
    sb
      .from("crm_activities")
      .select("id, body, due_at, deal_id, company_id, deal:deals(title), company:companies(name)")
      .eq("workspace_id", id)
      .eq("kind", "task")
      .eq("done", false)
      .not("due_at", "is", null)
      .order("due_at")
      .limit(50),
    sb.rpc("spend_summary", { ws: id, days: 7 }),
  ]);

  // Pipeline ouvert pondéré par la probabilité de l'étape
  const stageOf = new Map((stages.data ?? []).map((s) => [s.id, s]));
  let weighted = 0;
  let openValue = 0;
  let openCount = 0;
  let wonMonthlyNoRetainer = 0;
  const retainerOf = new Map((companies.data ?? []).filter((c) => c.status === "client").map((c) => [c.id, Number(c.monthly_retainer ?? 0)]));
  for (const d of deals.data ?? []) {
    const st = d.stage_id ? stageOf.get(d.stage_id) : undefined;
    const kind = st?.kind ?? "open";
    if (kind === "open") {
      openCount++;
      openValue += Number(d.value);
      weighted += (Number(d.value) * (st?.probability ?? 0)) / 100;
    } else if (kind === "won" && d.billing === "monthly") {
      // Un deal mensuel gagné compte dans le MRR sauf si le client a déjà un retainer renseigné
      if (!d.company_id || !retainerOf.get(d.company_id)) wonMonthlyNoRetainer += Number(d.value);
    }
  }
  const retainers = [...retainerOf.values()].reduce((a, b) => a + b, 0);

  const data: HomeData = {
    tasks: (tasks.data ?? []) as LiteTask[],
    activity: (activity.data ?? []) as unknown as ActivityRow[],
    commercial: {
      weighted,
      openValue,
      openCount,
      mrr: retainers + wonMonthlyNoRetainer,
      retainers,
      clients: [...retainerOf.keys()].length,
      followups: ((followups.data ?? []) as unknown as HomeData["commercial"]["followups"]),
    },
    spend: (spend.data as HomeData["spend"]) ?? null,
  };
  return <HomeView data={data} />;
}
