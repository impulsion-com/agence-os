import { TRACKING_SCRIPT } from "@/lib/tracking/script";

// Script de tracking public : <script async src="https://<app>/t.js" data-key="pk_…"></script>
export const dynamic = "force-static";

export function GET() {
  return new Response(TRACKING_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
