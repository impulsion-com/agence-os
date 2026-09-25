// Concatène les migrations dans supabase/setup.sql, à coller en une fois dans le SQL Editor.
// Usage : node scripts/build-setup-sql.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const out = [
  "-- Agence OS : installation complète (généré par scripts/build-setup-sql.mjs, ne pas modifier à la main)",
  `-- Migrations incluses : ${files.join(", ")}`,
  "",
  ...files.map((f) => `-- =====================================================================\n-- ${f}\n-- =====================================================================\n${readFileSync(`${dir}/${f}`, "utf8")}`),
].join("\n");
writeFileSync("supabase/setup.sql", out);
console.log(`supabase/setup.sql : ${files.length} migrations`);
