// Joins every migration into supabase/setup.sql so a new Supabase project can be set up
// with a single paste into the SQL Editor. Run: npm run build:sql
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const parts = files.map((f) => `-- ===== ${f} =====\n${readFileSync(new URL(f, dir), "utf8").trim()}\n`);
const header = `-- Idea2Launch database setup (generated from supabase/migrations by scripts/build-setup-sql.mjs).
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run. Run it once on a new project.
`;
writeFileSync(new URL("../supabase/setup.sql", import.meta.url), `${header}\n${parts.join("\n")}`);
console.log(`supabase/setup.sql written from ${files.length} migration(s)`);
