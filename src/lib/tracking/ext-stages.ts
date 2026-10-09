import "server-only";

import type { ExtContext } from "./ext";
import type { Stage } from "./funnel";

/** Entonnoir d'un site, lu en service role (l'appelant est un jeton, pas une session). */
export async function loadStagesAdmin(ctx: ExtContext, siteId: string): Promise<Stage[]> {
  const { data } = await ctx.db.from("tracking_stages").select("id, key, label, position, kind, has_value, aliases").eq("site_id", siteId).order("position");
  return (data ?? []) as Stage[];
}
