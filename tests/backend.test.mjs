// End-to-end checks of the database rules and the admin-users function
// against a local Supabase stack (`npx supabase start` + `npx supabase functions serve`).
// Run: npm run test:backend
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) throw new Error("Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");

const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const run = Date.now().toString(36);
const email = (u) => `${u}@idea2launch.local`;
const PW = "Passw0rd!";

async function signIn(username, password = PW) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: email(username), password });
  if (error) throw new Error(`${username}: ${error.message}`);
  return c;
}
async function fn(client, body) {
  const { data, error } = await client.functions.invoke("admin-users", { body });
  if (error) {
    const ctx = error.context ? await error.context.json().catch(() => ({})) : {};
    return { error: ctx.error ?? error.message, status: error.context?.status };
  }
  return data;
}
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const u = (n) => `${n}${run}`.slice(0, 32);
const people = {};

test("first user becomes admin", async () => {
  // wipe so "first user" logic is exercised
  const { data: all } = await service.from("profiles").select("id");
  for (const p of all ?? []) await service.auth.admin.deleteUser(p.id);
  const { data, error } = await service.auth.admin.createUser({
    email: email(u("yash")), password: PW, email_confirm: true,
    user_metadata: { username: u("yash"), full_name: "Yash" },
  });
  assert.ifError(error);
  const prof = ok(await service.from("profiles").select("*").eq("id", data.user.id).single());
  assert.equal(prof.role, "admin");
  assert.equal(prof.username, u("yash"));
  people.admin = await signIn(u("yash"));
});

test("admin creates people with usernames; others cannot", async () => {
  for (const [key, role] of [["mia", "manager"], ["cora", "coordinator"], ["mo", "member"], ["max", "member"], ["vic", "viewer"]]) {
    const r = await fn(people.admin, { action: "create", username: u(key), password: PW, full_name: key, role });
    assert.equal(r.ok, true, JSON.stringify(r));
    people[key] = await signIn(u(key));
  }
  const dup = await fn(people.admin, { action: "create", username: u("mo"), password: PW, role: "member" });
  assert.match(dup.error, /taken/);
  const denied = await fn(people.mia, { action: "create", username: u("zed"), password: PW, role: "member" });
  assert.equal(denied.status, 403);
  const roles = ok(await people.vic.from("profiles").select("username, role"));
  assert.equal(roles.length, 6);
});

test("members cannot change their own role", async () => {
  const { data: me } = await people.mo.auth.getUser();
  const { error } = await people.mo.from("profiles").update({ role: "admin" }).eq("id", me.user.id);
  assert.ok(error, "role change should fail");
  const r = ok(await people.mo.from("profiles").update({ full_name: "Mo Renamed" }).eq("id", me.user.id).select());
  assert.equal(r[0].full_name, "Mo Renamed");
});

const ids = {};
test("project permissions", async () => {
  const cat = ok(await people.mia.from("categories").insert({ name: "Prototype " + run }).select().single());
  const { error: catErr } = await people.mo.from("categories").insert({ name: "x" + run });
  assert.ok(catErr, "members cannot add categories");
  ids.cat = cat.id;

  const { error: memberCreate } = await people.mo.from("projects").insert({ code: "M" + run, name: "nope" });
  assert.ok(memberCreate, "members cannot create projects");

  const coraId = (await people.cora.auth.getUser()).data.user.id;
  ids.cora = coraId;
  const p = ok(await people.cora.from("projects").insert({
    code: "P1-" + run, name: "Drone sensor", category_id: cat.id, lead_id: coraId, status: "active",
    start_date: "2026-02-01", end_date: "2027-03-31",
  }).select().single());
  ids.p1 = p.id;
  const members = ok(await people.vic.from("project_members").select("user_id").eq("project_id", p.id));
  assert.deepEqual(members.map((m) => m.user_id), [coraId], "lead is a member");

  const p2 = ok(await people.admin.from("projects").insert({ code: "P2-" + run, name: "Battery pack" }).select().single());
  ids.p2 = p2.id;

  // mo is not on P1 yet -> cannot add a task
  const { error: moTask } = await people.mo.from("tasks").insert({ project_id: p.id, title: "x" });
  assert.ok(moTask, "non-member cannot add tasks");
  // viewer can read but not write
  assert.equal(ok(await people.vic.from("projects").select("id")).length >= 2, true);
  const { error: vicTask } = await people.vic.from("tasks").insert({ project_id: p.id, title: "x" });
  assert.ok(vicTask);
  // members cannot edit project details even if assigned
  const moId = (await people.mo.auth.getUser()).data.user.id;
  ids.mo = moId;
  ok(await people.cora.from("project_members").insert({ project_id: p.id, user_id: moId }));
  const upd = await people.mo.from("projects").update({ name: "hijack" }).eq("id", p.id).select();
  assert.equal(upd.data?.length ?? 0, 0, "members cannot rename a project");
  // manager can edit any project
  const mupd = ok(await people.mia.from("projects").update({ status: "on_hold" }).eq("id", p.id).select());
  assert.equal(mupd[0].status, "on_hold");
});

test("tasks, owners, subtasks, dependencies, notifications", async () => {
  const maxId = (await people.max.auth.getUser()).data.user.id;
  ids.max = maxId;
  const t1 = ok(await people.mo.from("tasks").insert({
    project_id: ids.p1, title: "Design PCB", priority: "high", owner_id: maxId,
    start_date: "2026-11-16", due_date: "2026-11-27",
  }).select().single());
  ids.t1 = t1.id;
  // max became a project member automatically and got notified
  const mem = ok(await people.vic.from("project_members").select("user_id").eq("project_id", ids.p1));
  assert.ok(mem.some((m) => m.user_id === maxId));
  const notes = ok(await people.max.from("notifications").select("*"));
  assert.ok(notes.some((n) => n.kind === "assigned" && n.task_id === t1.id));
  assert.ok(notes.some((n) => n.kind === "project"));
  // max cannot read mo's notifications
  const others = ok(await people.max.from("notifications").select("*").neq("user_id", maxId));
  assert.equal(others.length, 0);

  const sub = ok(await people.max.from("tasks").insert({ project_id: ids.p2, parent_id: t1.id, title: "Pick MCU" }).select().single());
  assert.equal(sub.project_id, ids.p1, "subtask forced into parent's project");

  const t2 = ok(await people.mo.from("tasks").insert({ project_id: ids.p1, title: "Order parts" }).select().single());
  ids.t2 = t2.id;
  ok(await people.mo.from("task_dependencies").insert({ task_id: t2.id, depends_on_id: t1.id }));
  const { error: loop } = await people.mo.from("task_dependencies").insert({ task_id: t1.id, depends_on_id: t2.id });
  assert.match(loop.message, /loop/);

  ok(await people.mo.from("task_collaborators").insert({ task_id: t1.id, user_id: ids.cora }));
  ok(await people.cora.from("comments").insert({ task_id: t1.id, author_id: ids.cora, body: "Use 4 layers" }));
  const { error: vicComment } = await people.vic.from("comments").insert({ task_id: t1.id, author_id: (await people.vic.auth.getUser()).data.user.id, body: "hi" });
  assert.ok(vicComment, "viewers cannot comment");

  // done -> completed_at set, dependents' owners notified
  ok(await people.mo.from("tasks").update({ owner_id: ids.mo }).eq("id", t2.id));
  const done = ok(await people.max.from("tasks").update({ status: "done" }).eq("id", t1.id).select().single());
  assert.ok(done.completed_at);
  const moNotes = ok(await people.mo.from("notifications").select("kind"));
  assert.ok(moNotes.some((n) => n.kind === "unblocked"));
  const back = ok(await people.max.from("tasks").update({ status: "review" }).eq("id", t1.id).select().single());
  assert.equal(back.completed_at, null);
});

test("copy a task with subtasks and comments to another project", async () => {
  // mo is not on P2 -> copy denied
  const { error: denied } = await people.mo.rpc("copy_task", { p_task: ids.t1, p_target_project: ids.p2 });
  assert.ok(denied);
  const newId = ok(await people.mia.rpc("copy_task", { p_task: ids.t1, p_target_project: ids.p2 }));
  const copy = ok(await people.vic.from("tasks").select("*").eq("id", newId).single());
  assert.equal(copy.project_id, ids.p2);
  assert.equal(copy.status, "todo");
  assert.match(copy.title, /\(copy\)$/);
  const subs = ok(await people.vic.from("tasks").select("*").eq("parent_id", newId));
  assert.equal(subs.length, 1);
  const comments = ok(await people.vic.from("comments").select("*").eq("task_id", newId));
  assert.equal(comments.length, 1);
  const collabs = ok(await people.vic.from("task_collaborators").select("*").eq("task_id", newId));
  assert.equal(collabs.length, 1);
  const deps = ok(await people.vic.from("task_dependencies").select("*").eq("task_id", newId));
  assert.equal(deps.length, 0);
  const same = ok(await people.mo.rpc("copy_task", { p_task: ids.t2, p_new_title: "Order parts again" }));
  const s = ok(await people.vic.from("tasks").select("title, project_id").eq("id", same).single());
  assert.equal(s.title, "Order parts again");
  assert.equal(s.project_id, ids.p1);
});

test("attachments: upload limits and permissions", async () => {
  const path = `${ids.p1}/${ids.t1}/${run}-spec.txt`;
  const up = await people.max.storage.from("attachments").upload(path, new Blob(["hello"]), { contentType: "text/plain" });
  assert.ifError(up.error);
  ok(await people.max.from("attachments").insert({ task_id: ids.t1, file_name: "spec.txt", storage_path: path, size_bytes: 5, uploaded_by: ids.max }));
  const dl = await people.vic.storage.from("attachments").download(path);
  assert.equal(await dl.data.text(), "hello");
  const vicUp = await people.vic.storage.from("attachments").upload(`${ids.p1}/${ids.t1}/v.txt`, new Blob(["x"]));
  assert.ok(vicUp.error, "viewer cannot upload");
  const big = await people.max.storage.from("attachments").upload(`${ids.p1}/${ids.t1}/big.bin`, new Blob([new Uint8Array(11 * 1024 * 1024)]));
  assert.ok(big.error, "11 MB file rejected");
});

test("settings: admin only", async () => {
  const r = await people.mia.from("app_settings").update({ value: 5 }).eq("key", "overload_threshold").select();
  assert.equal(r.data?.length ?? 0, 0);
  ok(await people.admin.from("app_settings").update({ value: 30 }).eq("key", "overload_threshold"));
  const { error } = await people.mia.rpc("set_max_upload_mb", { p_mb: 20 });
  assert.ok(error);
  ok(await people.admin.rpc("set_max_upload_mb", { p_mb: 12 }));
  const b = ok(await service.storage.getBucket("attachments"));
  assert.equal(b.file_size_limit, 12 * 1024 * 1024);
  ok(await people.admin.rpc("set_max_upload_mb", { p_mb: 10 }));
});

test("reset password, deactivate, delete", async () => {
  const r = await fn(people.admin, { action: "reset_password", user_id: ids.max, password: "NewPassw0rd" });
  assert.equal(r.ok, true);
  await signIn(u("max"), "NewPassw0rd");
  const off = await fn(people.admin, { action: "update", user_id: ids.mo, is_active: false });
  assert.equal(off.ok, true);
  await assert.rejects(signIn(u("mo")));
  const on = await fn(people.admin, { action: "update", user_id: ids.mo, is_active: true, role: "coordinator" });
  assert.equal(on.ok, true);
  await signIn(u("mo"));
  const adminId = (await people.admin.auth.getUser()).data.user.id;
  const self = await fn(people.admin, { action: "update", user_id: adminId, role: "member" });
  assert.match(self.error, /own admin/);
  const vicId = (await people.vic.auth.getUser()).data.user.id;
  const del = await fn(people.admin, { action: "delete", user_id: vicId });
  assert.equal(del.ok, true);
});

test("project phases", async () => {
  const phases = ok(await people.mia.from("project_sections").select("*").eq("project_id", ids.p1).order("sort_order"));
  assert.deepEqual(phases.map((p) => p.name), ["Planning", "Research", "Development", "Testing", "Launch"]);
  const otherPhase = ok(await people.mia.from("project_sections").select("id").eq("project_id", ids.p2).limit(1).single());
  const t = ok(await people.cora.from("tasks").insert({ project_id: ids.p1, title: "Phase test", section_id: phases[1].id }).select().single());
  assert.equal(t.section_id, phases[1].id);
  const sub = ok(await people.cora.from("tasks").insert({ project_id: ids.p1, parent_id: t.id, title: "child" }).select().single());
  assert.equal(sub.section_id, phases[1].id, "subtask follows parent's phase");
  const moved = ok(await people.cora.from("tasks").update({ section_id: phases[3].id }).eq("id", t.id).select().single());
  assert.equal(moved.section_id, phases[3].id);
  const child = ok(await people.mia.from("tasks").select("section_id").eq("id", sub.id).single());
  assert.equal(child.section_id, phases[3].id);
  const wrong = ok(await people.cora.from("tasks").update({ section_id: otherPhase.id }).eq("id", t.id).select().single());
  assert.equal(wrong.section_id, null, "phase from another project is rejected");
  const { error } = await people.mo.from("project_sections").insert({ project_id: ids.p2, name: "x" });
  assert.ok(error, "people not on a project cannot add phases");
  ok(await people.cora.from("project_sections").insert({ project_id: ids.p1, name: "Extra", sort_order: 9 }));
});
