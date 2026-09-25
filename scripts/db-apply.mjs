// Applique un fichier SQL sur un projet Supabase via l'API Management.
// Usage : SUPABASE_ACCESS_TOKEN=... node scripts/db-apply.mjs <project-ref> <fichier.sql>
// (Les élèves peuvent aussi utiliser `npx supabase db push` avec la CLI.)
import { readFileSync } from "node:fs";

const [ref, file] = process.argv.slice(2);
if (!ref || !file || !process.env.SUPABASE_ACCESS_TOKEN) {
  console.error("Usage : SUPABASE_ACCESS_TOKEN=... node scripts/db-apply.mjs <project-ref> <fichier.sql>");
  process.exit(1);
}
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: readFileSync(file, "utf8") }),
});
const text = await res.text();
if (!res.ok) {
  console.error(res.status, text);
  process.exit(1);
}
console.log(text.slice(0, 2000));
