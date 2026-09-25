// Redirection des liens courts : /l/<code> (ou <domaine court>/<code> via next.config.ts).
// Une seule requête avant la redirection ; l'enregistrement du clic passe dans after().
import { after, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { CODE_RE, appendParam } from "@/lib/links/utm";
import { parseUa } from "@/lib/links/ua";

export const dynamic = "force-dynamic";

function token() {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function inactive(status = 404) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Lien inactif</title>
<style>:root{color-scheme:light dark;--bg:#fbfaf8;--fg:#1d1c1a;--mu:#6b6760;--bd:#e9e7e2}@media(prefers-color-scheme:dark){:root{--bg:#1a1a19;--fg:#eceae5;--mu:#9a968f;--bd:#2c2b29}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
main{max-width:380px;text-align:center}.ic{width:44px;height:44px;border-radius:10px;border:1px solid var(--bd);display:grid;place-items:center;margin:0 auto 16px;color:var(--mu)}
h1{font-size:19px;margin:0 0 8px;font-weight:600}p{margin:0;color:var(--mu);font-size:14px}</style></head>
<body><main><div class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 4 8"/><line x1="8" x2="12" y1="12" y2="12"/><line x1="2" x2="22" y1="2" y2="22"/></svg></div>
<h1>Ce lien n'est plus actif</h1><p>Il a été désactivé, a expiré ou n'a jamais existé. Vérifie l'adresse ou contacte la personne qui te l'a transmis.</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

async function handle(req: NextRequest, code: string, record: boolean) {
  if (!CODE_RE.test(code)) return inactive();
  const sb = supabaseAdmin();
  const { data: link } = await sb.from("links").select("id, workspace_id, final_url, active, expires_at").eq("code", code).maybeSingle();
  if (!link || !link.active || (link.expires_at && new Date(link.expires_at).getTime() < Date.now())) return inactive();

  const tk = token();
  const location = appendParam(link.final_url, "aos_lid", tk);

  if (record) {
    const h = req.headers;
    const ua = parseUa(h.get("user-agent") ?? "");
    const country = (h.get("x-vercel-ip-country") || h.get("cf-ipcountry") || "").toUpperCase().slice(0, 2) || null;
    const referrer = (h.get("referer") ?? "").slice(0, 500);
    after(async () => {
      const { error } = await sb.from("link_clicks").insert({
        link_id: link.id,
        workspace_id: link.workspace_id,
        token: tk,
        referrer,
        device: ua.device,
        browser: ua.browser,
        os: ua.os || null,
        country: country && country !== "XX" ? country : null,
        is_bot: ua.isBot,
      });
      if (error) console.error("link_clicks", error.message);
      if (!ua.isBot) await sb.rpc("bump_link", { p_link: link.id });
    });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer-when-downgrade" },
  });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/l/[code]">) {
  const { code } = await ctx.params;
  return handle(req, code, true);
}

// HEAD (vérificateurs de liens, robots) : redirection sans compter de clic
export async function HEAD(req: NextRequest, ctx: RouteContext<"/l/[code]">) {
  const { code } = await ctx.params;
  return handle(req, code, false);
}
