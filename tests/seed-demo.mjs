// Fills a LOCAL Supabase with demo people, projects and tasks for trying the app.
// Never run against production. Run: npm run seed:demo
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
if (!/127\.0\.0\.1|localhost/.test(URL)) throw new Error("seed-demo only runs against a local Supabase");
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

const { data: existing } = await db.from("profiles").select("id");
for (const p of existing ?? []) await db.auth.admin.deleteUser(p.id);
await db.from("projects").delete().neq("id", "00000000-0000-0000-0000-000000000000");
await db.from("categories").delete().neq("id", "00000000-0000-0000-0000-000000000000");

const people = [
  ["yash", "Yash Perera", "R&D Head", "admin", "#072A62"],
  ["mia", "Mia Fernando", "Engineering Manager", "manager", "#8B5CF6"],
  ["cora", "Cora Silva", "Project Coordinator", "coordinator", "#F26A10"],
  ["nimal", "Nimal Jayasuriya", "Electronics Engineer", "member", "#0EA5E9"],
  ["dilan", "Dilan Rajapaksa", "Firmware Engineer", "member", "#10B981"],
  ["sara", "Sara Wickrama", "Mechanical Designer", "member", "#EC4899"],
  ["ravi", "Ravi Kumar", "Test Engineer", "member", "#14B8A6"],
  ["vic", "Vic De Mel", "Finance (view only)", "viewer", "#64748B"],
];
const id = {};
for (const [u, name, title, role, color] of people) {
  const { data, error } = await db.auth.admin.createUser({ email: `${u}@idea2launch.local`, password: "Passw0rd!", email_confirm: true,
    user_metadata: { username: u, full_name: name, job_title: title } });
  if (error) throw error;
  id[u] = data.user.id;
  ok(await db.from("profiles").update({ role, color }).eq("id", data.user.id));
}

const cats = ok(await db.from("categories").insert([
  { name: "Product development", color: "#F26A10", sort_order: 0 },
  { name: "Research", color: "#1D4ED8", sort_order: 1 },
  { name: "Testing & certification", color: "#10B981", sort_order: 2 },
]).select());
const cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));

const projects = ok(await db.from("projects").insert([
  { code: "RD-2026-001", name: "Smart irrigation sensor", category_id: cat["Product development"], status: "active", lead_id: id.cora, start_date: "2026-02-02", end_date: "2026-12-18", description: "Low-power soil moisture sensor with LoRa uplink for paddy fields.", created_by: id.mia },
  { code: "RD-2026-002", name: "Battery pack thermal study", category_id: cat["Research"], status: "active", lead_id: id.nimal, start_date: "2026-05-04", end_date: "2027-03-31", description: "Characterise heat build-up in 48V packs under tropical conditions.", created_by: id.mia },
  { code: "RD-2026-003", name: "Drone frame v2", category_id: cat["Product development"], status: "on_hold", lead_id: id.sara, start_date: "2026-03-16", end_date: "2026-09-30", description: "Lighter carbon frame. Paused until supplier quotes return.", created_by: id.mia },
  { code: "RD-2026-004", name: "EMC pre-compliance", category_id: cat["Testing & certification"], status: "planning", lead_id: id.ravi, start_date: "2026-11-23", end_date: "2027-02-26", description: "", created_by: id.mia },
  { code: "RD-2025-014", name: "Solar charge controller", category_id: cat["Product development"], status: "completed", lead_id: id.cora, start_date: "2025-08-04", end_date: "2026-04-30", description: "MPPT controller, now in production.", created_by: id.mia },
  { code: "RD-2026-005", name: "Material sourcing survey", category_id: null, status: "cancelled", lead_id: id.mia, start_date: "2026-01-12", end_date: "2026-03-20", description: "", created_by: id.mia },
]).select());
const pid = Object.fromEntries(projects.map((p) => [p.code, p.id]));

const d = (offset) => { const x = new Date(); x.setDate(x.getDate() + offset); return x.toISOString().slice(0, 10); };
const T = (code, title, owner, status, priority, s, e, extra = {}) => ({ project_id: pid[code], title, owner_id: owner ? id[owner] : null, status, priority, start_date: s === null ? null : d(s), due_date: e === null ? null : d(e), created_by: id.cora, ...extra });

const tasks = ok(await db.from("tasks").insert([
  T("RD-2026-001", "Choose moisture sensing method", "nimal", "done", "high", -60, -40),
  T("RD-2026-001", "Design sensor PCB", "nimal", "in_progress", "high", -10, 4),
  T("RD-2026-001", "Write LoRa firmware", "dilan", "in_progress", "high", -7, 10),
  T("RD-2026-001", "Enclosure design (IP67)", "sara", "review", "medium", -14, 1),
  T("RD-2026-001", "Field trial in Anuradhapura", "ravi", "todo", "medium", 20, 45),
  T("RD-2026-001", "Order 50 prototype boards", "cora", "todo", "high", 5, 8),
  T("RD-2026-001", "Battery life calculation", "dilan", "todo", "low", null, -3),
  T("RD-2026-002", "Literature review", "nimal", "done", "medium", -150, -120),
  T("RD-2026-002", "Build thermal test rig", "ravi", "in_progress", "high", -20, 2),
  T("RD-2026-002", "Run 40°C ambient tests", "ravi", "todo", "high", 3, 24),
  T("RD-2026-002", "Data analysis report", "nimal", "todo", "medium", 25, 50),
  T("RD-2026-003", "Get supplier quotes", "sara", "in_progress", "medium", -30, -5),
  T("RD-2026-003", "FEA on arm joints", "sara", "todo", "medium", null, null),
  T("RD-2026-004", "Book test lab", "ravi", "todo", "high", 2, 6),
  T("RD-2026-004", "Prepare test plan", "ravi", "todo", "medium", 0, 12),
  T("RD-2025-014", "Production handover", "cora", "done", "high", -220, -205),
]).select());
const tid = Object.fromEntries(tasks.map((t) => [t.title, t.id]));
const secs = ok(await db.from("project_sections").select("*"));
const sec = (code, name) => secs.find((s) => s.project_id === pid[code] && s.name === name)?.id;
const phaseOf = {
  "Choose moisture sensing method": "Research", "Design sensor PCB": "Development", "Write LoRa firmware": "Development",
  "Enclosure design (IP67)": "Development", "Field trial in Anuradhapura": "Testing", "Order 50 prototype boards": "Development",
  "Battery life calculation": "Research", "Literature review": "Planning", "Build thermal test rig": "Development",
  "Run 40°C ambient tests": "Testing", "Data analysis report": "Launch", "Get supplier quotes": "Planning", "Book test lab": "Planning",
};
for (const t of tasks) {
  const name = phaseOf[t.title];
  const projectCode = Object.keys(pid).find((c) => pid[c] === t.project_id);
  if (name && sec(projectCode, name)) ok(await db.from("tasks").update({ section_id: sec(projectCode, name) }).eq("id", t.id));
}

ok(await db.from("tasks").insert([
  { project_id: pid["RD-2026-001"], parent_id: tid["Design sensor PCB"], title: "Schematic", owner_id: id.nimal, status: "done", priority: "high" },
  { project_id: pid["RD-2026-001"], parent_id: tid["Design sensor PCB"], title: "Layout (4 layers)", owner_id: id.nimal, status: "in_progress", priority: "high", due_date: d(2) },
  { project_id: pid["RD-2026-001"], parent_id: tid["Design sensor PCB"], title: "Design review with Mia", owner_id: id.mia, status: "todo", priority: "medium", due_date: d(4) },
]));
// pile some extra work on Ravi to show workload colours
const extra = Array.from({ length: 24 }, (_, i) => T("RD-2026-002", `Log sensor channel ${i + 1}`, "ravi", "todo", "low", 0, 5));
ok(await db.from("tasks").insert(extra));

ok(await db.from("task_dependencies").insert([
  { task_id: tid["Order 50 prototype boards"], depends_on_id: tid["Design sensor PCB"] },
  { task_id: tid["Field trial in Anuradhapura"], depends_on_id: tid["Order 50 prototype boards"] },
  { task_id: tid["Run 40°C ambient tests"], depends_on_id: tid["Build thermal test rig"] },
]));
ok(await db.from("task_collaborators").insert([
  { task_id: tid["Design sensor PCB"], user_id: id.dilan },
  { task_id: tid["Field trial in Anuradhapura"], user_id: id.cora },
]));
ok(await db.from("comments").insert([
  { task_id: tid["Design sensor PCB"], author_id: id.cora, body: "Can we keep it to 4 layers to hold the unit cost?" },
  { task_id: tid["Design sensor PCB"], author_id: id.nimal, body: "Yes. Routing is tight around the RF section but doable." },
]));
await db.from("app_settings").upsert([{ key: "overload_threshold", value: 25 }, { key: "max_upload_mb", value: 10 }]);
await db.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
console.log("Demo data ready. Sign in as yash / Passw0rd! (admin), or mia, cora, nimal, dilan, sara, ravi, vic.");
