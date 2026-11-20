import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UserPlus, KeyRound, Trash2, Tags, SlidersHorizontal, Users, ShieldCheck, ArrowUp, ArrowDown, Copy, RefreshCw, Search, Pencil } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { supabase, errorText } from "../lib/supabase";
import { ROLES, ROLE_HELP, ROLE_LABEL, SWATCHES, fmtDate } from "../lib/format";
import type { Category, Profile, Role } from "../lib/types";
import { Avatar, Button, Card, ColorPicker, Field, IconButton, Input, Modal, PageHeader, Pill, Select, Spinner, Tabs, Textarea, cx, useConfirm } from "../components/ui";
import { useToast } from "../components/Toast";

type Tab = "people" | "categories" | "settings" | "roles";

async function callAdmin(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; id?: string }> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let msg = error.message;
    try { const ctx = await (error as { context?: Response }).context?.json(); if (ctx?.error) msg = ctx.error; } catch { /* ignore */ }
    if (/Failed to send a request|FunctionsFetchError/i.test(msg)) msg = "The admin-users function isn't reachable. Check it is deployed in Supabase (see SETUP.md).";
    return { error: msg };
  }
  return data;
}

function makePassword() {
  const words = ["Rocket", "Launch", "Spark", "Orbit", "Bright", "Nova", "Pilot", "Comet", "Ignite", "Vector"];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const n = 100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900);
  return `${pick()}-${pick()}-${n}`;
}

export default function Admin() {
  const store = useStore();
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const admin = me?.role === "admin";
  const tab: Tab = admin ? ((params.get("tab") as Tab) || "people") : "categories";
  if (!store.ready) return <Spinner />;
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = admin ? [
    { id: "people", label: "People", icon: <Users className="size-4" /> },
    { id: "categories", label: "Categories", icon: <Tags className="size-4" /> },
    { id: "settings", label: "Settings", icon: <SlidersHorizontal className="size-4" /> },
    { id: "roles", label: "Roles & access", icon: <ShieldCheck className="size-4" /> },
  ] : [{ id: "categories", label: "Categories", icon: <Tags className="size-4" /> }];
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title={admin ? "Admin panel" : "Categories"} subtitle={admin ? "Manage people, categories and app settings." : "Managers can add and edit project categories."} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} tabs={tabs} />
      <div className="mt-5">
        {tab === "people" && <PeopleAdmin />}
        {tab === "categories" && <CategoriesAdmin />}
        {tab === "settings" && <SettingsAdmin />}
        {tab === "roles" && <RolesHelp />}
      </div>
    </div>
  );
}

/* ---------------------------- People ---------------------------- */
function PeopleAdmin() {
  const store = useStore();
  const { me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [resetFor, setResetFor] = useState<Profile | null>(null);
  const [editFor, setEditFor] = useState<Profile | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string; name: string } | null>(null);

  const list = useMemo(() => store.profiles.filter((p) => (p.full_name + p.username + p.job_title).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.full_name.localeCompare(b.full_name)), [store.profiles, q]);

  async function update(p: Profile, patch: Record<string, unknown>, success: string) {
    const r = await callAdmin({ action: "update", user_id: p.id, ...patch });
    if (r.error) toast.error(r.error); else { toast.success(success); store.refresh(); }
  }

  async function remove(p: Profile) {
    const owned = store.tasks.filter((t) => t.owner_id === p.id && t.status !== "done").length;
    const ok = await confirm({
      title: `Delete ${p.full_name}?`, danger: true, confirm: "Delete permanently",
      text: `${owned ? `Their ${owned} open task(s) will become unassigned. ` : ""}Their comments stay but show as "Former member". Usually it's better to turn the account off instead, which keeps everything and blocks sign-in.`,
    });
    if (!ok) return;
    const r = await callAdmin({ action: "delete", user_id: p.id });
    if (r.error) toast.error(r.error); else { toast.success(`${p.full_name} deleted`); store.refresh(); }
  }

  const activeCount = store.profiles.filter((p) => p.is_active).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
        </div>
        <span className="text-sm text-slate-500">{activeCount} active</span>
        <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAddOpen(true)}>Add person</Button>
      </div>
      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1fr)_150px_190px_110px_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium tracking-wide text-slate-500 uppercase md:grid">
          <span>Person</span><span>Username</span><span>Role</span><span>Status</span><span className="text-right">Actions</span>
        </div>
        {list.map((p) => {
          const self = p.id === me?.id;
          return (
            <div key={p.id} className={cx("grid items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3 md:grid-cols-[minmax(0,1fr)_150px_190px_110px_110px]", !p.is_active && "bg-slate-50 opacity-70")}>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar person={p} size={34} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.full_name} {self && <span className="text-xs font-normal text-slate-400">(you)</span>}</p>
                  <p className="truncate text-xs text-slate-500">{p.job_title || "No job title"} · added {fmtDate(p.created_at)}</p>
                </div>
              </div>
              <span className="font-mono text-sm text-slate-600">{p.username}</span>
              <Select aria-label={`Role for ${p.full_name}`} value={p.role} disabled={self}
                onChange={(e) => update(p, { role: e.target.value }, `${p.full_name} is now ${ROLE_LABEL[e.target.value as Role]}`)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
              <label className={cx("flex items-center gap-2 text-sm", self && "opacity-50")}>
                <input type="checkbox" role="switch" aria-label={`Account active for ${p.full_name}`} checked={p.is_active} disabled={self} className="size-4 accent-emerald-600"
                  onChange={(e) => update(p, { is_active: e.target.checked }, e.target.checked ? `${p.full_name} can sign in again` : `${p.full_name} can no longer sign in`)} />
                {p.is_active ? "Active" : "Turned off"}
              </label>
              <div className="flex justify-end gap-1">
                <IconButton label={`Edit ${p.full_name}`} onClick={() => setEditFor(p)}><Pencil className="size-4" /></IconButton>
                <IconButton label={`Reset password for ${p.full_name}`} onClick={() => setResetFor(p)}><KeyRound className="size-4" /></IconButton>
                {!self && <IconButton label={`Delete ${p.full_name}`} onClick={() => remove(p)}><Trash2 className="size-4" /></IconButton>}
              </div>
            </div>
          );
        })}
      </Card>

      <AddPersonModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={(c) => { setAddOpen(false); setCreated(c); store.refresh(); }} />
      <ResetPasswordModal person={resetFor} onClose={() => setResetFor(null)} onDone={(c) => { setResetFor(null); setCreated(c); }} />
      <EditPersonModal person={editFor} onClose={() => setEditFor(null)} />
      <CredentialsModal creds={created} onClose={() => setCreated(null)} />
    </div>
  );
}

function AddPersonModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: { username: string; password: string; name: string }) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [touchedUser, setTouchedUser] = useState(false);
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [password, setPassword] = useState(makePassword());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) { setName(""); setUsername(""); setTouchedUser(false); setTitle(""); setRole("member"); setPassword(makePassword()); setErr(""); }
  }, [open]);
  useEffect(() => {
    if (!touchedUser) setUsername(name.trim().toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "").slice(0, 32));
  }, [name, touchedUser]);

  async function save() {
    setErr("");
    if (!name.trim()) return setErr("Enter the person's name.");
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return setErr("Username must be 3 to 32 characters: lowercase letters, numbers, dot, dash or underscore.");
    if (password.length < 8) return setErr("Password must be at least 8 characters.");
    setBusy(true);
    const r = await callAdmin({ action: "create", username, password, full_name: name.trim(), job_title: title.trim(), role });
    setBusy(false);
    if (r.error) return setErr(r.error);
    onCreated({ username, password, name: name.trim() });
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a person"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Create account</Button></>}>
      <div className="space-y-4">
        <Field label="Full name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nimal Perera" /></Field>
        <Field label="Username" hint="They'll sign in with this. Lowercase, no spaces.">
          <Input value={username} onChange={(e) => { setTouchedUser(true); setUsername(e.target.value.toLowerCase()); }} autoComplete="off" />
        </Field>
        <Field label="Job title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Electronics engineer" /></Field>
        <Field label="Role" hint={ROLE_HELP[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Field label="Password" hint="At least 8 characters. They can change it later from My account.">
          <div className="flex gap-2">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="font-mono" />
            <IconButton label="Generate a new password" onClick={() => setPassword(makePassword())} className="ring-1 ring-slate-300"><RefreshCw className="size-4" /></IconButton>
          </div>
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ person, onClose, onDone }: { person: Profile | null; onClose: () => void; onDone: (c: { username: string; password: string; name: string }) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (person) { setPassword(makePassword()); setErr(""); } }, [person]);
  if (!person) return null;
  async function save() {
    if (password.length < 8) return setErr("Password must be at least 8 characters.");
    setBusy(true);
    const r = await callAdmin({ action: "reset_password", user_id: person!.id, password });
    setBusy(false);
    if (r.error) return setErr(r.error);
    onDone({ username: person!.username, password, name: person!.full_name });
  }
  return (
    <Modal open onClose={onClose} title={`Reset password for ${person.full_name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Set new password</Button></>}>
      <Field label="New password">
        <div className="flex gap-2">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" autoComplete="new-password" />
          <IconButton label="Generate a new password" onClick={() => setPassword(makePassword())} className="ring-1 ring-slate-300"><RefreshCw className="size-4" /></IconButton>
        </div>
      </Field>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Modal>
  );
}

function EditPersonModal({ person, onClose }: { person: Profile | null; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (person) { setName(person.full_name); setTitle(person.job_title); setColor(person.color); } }, [person]);
  if (!person) return null;
  async function save() {
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim(), job_title: title.trim(), color }).eq("id", person!.id);
    setBusy(false);
    if (error) return toast.error(errorText(error));
    toast.success("Saved");
    store.refresh();
    onClose();
  }
  return (
    <Modal open onClose={onClose} title={`Edit ${person.full_name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!name.trim()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Job title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Avatar colour"><ColorPicker value={color} onChange={setColor} colors={SWATCHES} /></Field>
      </div>
    </Modal>
  );
}

function CredentialsModal({ creds, onClose }: { creds: { username: string; password: string; name: string } | null; onClose: () => void }) {
  const toast = useToast();
  if (!creds) return null;
  const text = `Idea2Launch sign-in for ${creds.name}\nLink: ${window.location.origin}\nUsername: ${creds.username}\nPassword: ${creds.password}`;
  return (
    <Modal open onClose={onClose} title="Share these sign-in details"
      footer={<>
        <Button icon={<Copy className="size-4" />} onClick={async () => { await navigator.clipboard.writeText(text); toast.success("Copied"); }}>Copy</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </>}>
      <p className="mb-3 text-sm text-slate-600">Send these to {creds.name} privately. You won't be able to see this password again, but you can always reset it.</p>
      <pre className="rounded-lg bg-slate-50 p-3 font-mono text-sm whitespace-pre-wrap ring-1 ring-slate-200">{text}</pre>
    </Modal>
  );
}

/* ---------------------------- Categories ---------------------------- */
function CategoriesAdmin() {
  const store = useStore();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[7]);
  const [editing, setEditing] = useState<Category | null>(null);
  const cats = store.categories;
  const count = (id: string) => store.projects.filter((p) => p.category_id === id).length;

  async function add() {
    if (!name.trim()) return;
    const sort = cats.length ? Math.max(...cats.map((c) => c.sort_order)) + 1 : 0;
    const r = await store.mutate(() => supabase.from("categories").insert({ name: name.trim(), color, sort_order: sort }), { success: "Category added" });
    if (r) setName("");
  }
  async function move(i: number, dir: -1 | 1) {
    const a = cats[i], b = cats[i + dir];
    if (!a || !b) return;
    await Promise.all([
      supabase.from("categories").update({ sort_order: b.sort_order === a.sort_order ? i + dir : b.sort_order }).eq("id", a.id),
      supabase.from("categories").update({ sort_order: b.sort_order === a.sort_order ? i : a.sort_order }).eq("id", b.id),
    ]);
    store.refresh();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Card className="overflow-hidden">
        {cats.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">No categories yet. Add your first one.</p>}
        {cats.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
            <span className="size-4 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="flex-1 text-sm font-medium">{c.name}</span>
            <span className="text-xs text-slate-500">{count(c.id)} project{count(c.id) === 1 ? "" : "s"}</span>
            <IconButton label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></IconButton>
            <IconButton label={`Move ${c.name} down`} disabled={i === cats.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></IconButton>
            <IconButton label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil className="size-4" /></IconButton>
            <IconButton label={`Delete ${c.name}`} onClick={async () => {
              const n = count(c.id);
              if (!(await confirm({ title: `Delete "${c.name}"?`, danger: true, confirm: "Delete", text: n ? `${n} project(s) will become "No category". The projects themselves are kept.` : undefined }))) return;
              store.mutate(() => supabase.from("categories").delete().eq("id", c.id), { success: "Category deleted" });
            }}><Trash2 className="size-4" /></IconButton>
          </div>
        ))}
      </Card>
      <Card className="h-fit p-4">
        <h3 className="mb-3 text-sm font-semibold">Add a category</h3>
        <div className="space-y-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Product development" onKeyDown={(e) => e.key === "Enter" && add()} /></Field>
          <Field label="Colour"><ColorPicker value={color} onChange={setColor} colors={SWATCHES} /></Field>
          <Button variant="primary" onClick={add} disabled={!name.trim()} className="w-full">Add category</Button>
        </div>
      </Card>
      <CategoryEdit cat={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CategoryEdit({ cat, onClose }: { cat: Category | null; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  useEffect(() => { if (cat) { setName(cat.name); setColor(cat.color); } }, [cat]);
  if (!cat) return null;
  return (
    <Modal open onClose={onClose} title="Edit category"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={async () => {
        const r = await store.mutate(() => supabase.from("categories").update({ name: name.trim(), color }).eq("id", cat.id), { success: "Saved" });
        if (r) onClose();
      }}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Colour"><ColorPicker value={color} onChange={setColor} colors={SWATCHES} /></Field>
      </div>
    </Modal>
  );
}

/* ---------------------------- Settings ---------------------------- */
function SettingsAdmin() {
  const store = useStore();
  const toast = useToast();
  const [threshold, setThreshold] = useState(String(store.settings.overload_threshold));
  const [maxMb, setMaxMb] = useState(String(store.settings.max_upload_mb));
  const [company, setCompany] = useState(store.settings.company_name);
  const [weekStart, setWeekStart] = useState(String(store.settings.week_starts_on));
  const [phases, setPhases] = useState((Array.isArray(store.settings.default_phases) ? store.settings.default_phases : []).join("\n"));
  const [busy, setBusy] = useState(false);

  async function save() {
    const t = Number(threshold), mb = Number(maxMb);
    if (!Number.isInteger(t) || t < 1 || t > 500) return toast.error("Overload limit must be a whole number from 1 to 500.");
    if (!Number.isInteger(mb) || mb < 1 || mb > 50) return toast.error("File size limit must be a whole number from 1 to 50 MB.");
    setBusy(true);
    const rows = [
      { key: "overload_threshold", value: t },
      { key: "company_name", value: company.trim() || "Idea2Launch" },
      { key: "week_starts_on", value: Number(weekStart) },
      { key: "default_phases", value: phases.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 20) },
    ];
    const { error } = await supabase.from("app_settings").upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
    const { error: e2 } = mb !== Number(store.settings.max_upload_mb) ? await supabase.rpc("set_max_upload_mb", { p_mb: mb }) : { error: null };
    setBusy(false);
    if (error || e2) return toast.error(errorText(error || e2));
    toast.success("Settings saved");
    store.refresh();
  }

  return (
    <Card className="max-w-2xl p-5">
      <div className="space-y-5">
        <Field label="Overload limit (open tasks per person per week)" hint="People above this number are flagged red on the Workload page.">
          <Input type="number" min={1} max={500} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="max-w-32" />
        </Field>
        <Field label="Largest file people can attach (MB)" hint="Between 1 and 50 MB. Supabase's free plan includes 1 GB of file storage in total.">
          <Input type="number" min={1} max={50} value={maxMb} onChange={(e) => setMaxMb(e.target.value)} className="max-w-32" />
        </Field>
        <Field label="Week starts on">
          <Select value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="max-w-48">
            <option value="1">Monday</option>
            <option value="0">Sunday</option>
          </Select>
        </Field>
        <Field label="Default phases for new projects" hint="One per line. Each new project starts with these; teams can rename or add phases inside a project.">
          <Textarea value={phases} onChange={(e) => setPhases(e.target.value)} className="max-w-sm" rows={6} />
        </Field>
        <Field label="Company name" hint="Used as the logo's alt text and in exports.">
          <Input value={company} onChange={(e) => setCompany(e.target.value)} className="max-w-sm" />
        </Field>
        <Button variant="primary" loading={busy} onClick={save}>Save settings</Button>
      </div>
    </Card>
  );
}

/* ---------------------------- Roles ---------------------------- */
function RolesHelp() {
  const rows: [string, boolean[]][] = [
    ["See all projects and tasks", [true, true, true, true, true]],
    ["Comment on tasks", [true, true, true, true, false]],
    ["Add and edit tasks in projects they're on", [true, true, true, true, false]],
    ["Create projects", [true, true, true, false, false]],
    ["Edit details and people of projects they lead", [true, true, true, false, false]],
    ["Edit and delete any project", [true, true, false, false, false]],
    ["Manage categories", [true, true, false, false, false]],
    ["Add people, reset passwords, change settings", [true, false, false, false, false]],
  ];
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <th className="px-4 py-2 text-left font-medium">What they can do</th>
            {ROLES.map((r) => <th key={r} className="px-2 py-2 font-medium">{ROLE_LABEL[r]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, allowed]) => (
            <tr key={label} className="border-b border-slate-100">
              <td className="px-4 py-2">{label}</td>
              {allowed.map((a, i) => <td key={i} className="text-center">{a ? <Pill className="bg-emerald-50 text-emerald-700 ring-emerald-200">Yes</Pill> : <span className="text-slate-300">–</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-slate-500">
        "Projects they're on" means they lead it, were added on its People tab, or own or collaborate on one of its tasks. Change someone's role on the People tab.
      </p>
    </Card>
  );
}
