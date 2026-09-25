#!/bin/sh
# Régénère src/lib/database.types.ts après une migration.
# Usage : SUPABASE_ACCESS_TOKEN=... ./scripts/gen-types.sh <project-ref>
# (équivalent CLI : npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts)
set -e
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$1/types/typescript?included_schemas=public" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).types))" > src/lib/database.types.ts
echo "Types régénérés."
