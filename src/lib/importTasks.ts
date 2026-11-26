/**
 * Read tasks from an Excel/CSV sheet or a Microsoft Project XML file and turn them into
 * a plan of main tasks, subtasks and predecessors for one project.
 */
import { addDays, format, isValid, parse, parseISO } from "date-fns";
import type { Priority, Profile, Task, TaskStatus } from "./types";

type Raw = string | number | boolean | Date | null | undefined;

/** One row as read from the file, before it is fitted to the app. */
export interface SourceRow {
  key: string;            // the row's ID in the file (MS Project ID/UID, or row number)
  title: string;
  level: number | null;   // outline level, if the file has one
  parentName: string;     // "Main task" column
  owner: string;          // a name or username; several are split by commas
  collaborators: string;
  start: string | null;
  due: string | null;
  priority: Priority | null;
  status: TaskStatus | null;
  predecessors: string[]; // keys or task names
  description: string;
  projectCode: string;
}

export interface PlannedTask {
  ref: string;            // unique within the plan
  title: string;
  parentRef: string | null;
  ownerId: string | null;
  collaboratorIds: string[];
  start: string | null;
  due: string | null;
  priority: Priority;
  status: TaskStatus;
  description: string;
  predecessorRefs: string[];          // refs of planned tasks
  existingPredecessorIds: string[];   // tasks already in the project
}

export interface Plan {
  tasks: PlannedTask[];
  warnings: string[];
  skipped: number;
  source: string;
}

/* ------------------------------ values ------------------------------ */

const str = (v: Raw) => (v === null || v === undefined ? "" : v instanceof Date ? format(v, "yyyy-MM-dd") : String(v)).trim();

let dayFirst = true;
function dateOf(v: Raw): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isValid(v) ? format(v, "yyyy-MM-dd") : null;
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null; // not an Excel date serial
    return format(addDays(new Date(1899, 11, 30), Math.floor(v)), "yyyy-MM-dd");
  }
  let s = String(v).trim();
  if (!s || /^(na|n\/a|-)$/i.test(s)) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) { const d = parseISO(`${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`); return isValid(d) ? format(d, "yyyy-MM-dd") : null; }
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, "").replace(/\s+\d{1,2}:\d{2}.*$/, "");
  const formats = [
    ...(dayFirst ? ["d/M/yyyy", "d/M/yy", "M/d/yyyy", "M/d/yy"] : ["M/d/yyyy", "M/d/yy", "d/M/yyyy", "d/M/yy"]),
    "d-M-yyyy", "d.M.yyyy", "d MMM yyyy", "d MMMM yyyy", "MMM d, yyyy", "MMMM d, yyyy", "d MMM yy", "d-MMM-yy", "d-MMM-yyyy",
  ];
  for (const f of formats) {
    const d = parse(s, f, new Date(2000, 0, 1));
    if (isValid(d) && d.getFullYear() > 1990 && d.getFullYear() < 2100) return format(d, "yyyy-MM-dd");
  }
  return null;
}

/** Decide whether 3/4/2026 means 3 April (day first) or 4 March, from the dates in the file. */
function guessDayFirst(values: Raw[]) {
  let a = 0, b = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = v.match(/(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) a++;
    if (+m[2] > 12) b++;
  }
  return b > a ? false : true;
}

function priorityOf(v: Raw): Priority | null {
  const s = str(v).toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) { const n = +s; return n >= 700 ? "high" : n <= 300 ? "low" : "medium"; } // MS Project 0-1000
  if (/high|urgent|critical|^h$|^1$/.test(s)) return "high";
  if (/low|^l$/.test(s)) return "low";
  if (/med|normal|^m$/.test(s)) return "medium";
  return null;
}

function statusOf(v: Raw, pct: Raw): TaskStatus | null {
  const s = str(v).toLowerCase();
  if (s) {
    if (/done|complete|finished|closed/.test(s)) return "done";
    if (/review/.test(s)) return "review";
    if (/progress|started|doing|active|ongoing/.test(s)) return "in_progress";
    if (/to ?do|not started|open|new|planned/.test(s)) return "todo";
  }
  const p = parseFloat(str(pct).replace("%", ""));
  if (!isNaN(p)) {
    const n = p <= 1 && str(pct).indexOf("%") < 0 && str(pct).includes(".") ? p * 100 : p;
    return n >= 100 ? "done" : n > 0 ? "in_progress" : "todo";
  }
  return null;
}

/** "3FS+2 days, 5" -> ["3", "5"]; "Market study; Schematic" -> names */
function splitPredecessors(v: Raw): string[] {
  const s = str(v);
  if (!s) return [];
  return s.split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*([+-].*)?$/i);
    return m ? m[1] : x;
  });
}

/* ------------------------------ sheets ------------------------------ */

const COLS: { key: keyof typeof headerIndex; re: RegExp }[] = [];
const headerIndex = {
  id: -1, title: -1, parent: -1, level: -1, wbs: -1, owner: -1, collaborators: -1, start: -1, due: -1,
  priority: -1, status: -1, pct: -1, predecessors: -1, description: -1, project: -1,
};
COLS.push(
  { key: "title", re: /^(task|tasks|task name|name|title|activity|activity name|task title|summary)$/ },
  { key: "id", re: /^(id|#|no\.?|task id|unique id|uid|s\/?n)$/ },
  { key: "parent", re: /main task|parent/ },
  { key: "level", re: /outline level|^level$/ },
  { key: "wbs", re: /^wbs|outline number/ },
  { key: "collaborators", re: /collaborator|helpers?|team members?/ },
  { key: "owner", re: /owner|resource names?|resources|assign|responsible|person|lead/ },
  { key: "start", re: /^(start|start date|begin|planned start|baseline start)/ },
  { key: "due", re: /^(due|due date|finish|finish date|end|end date|deadline|planned finish)/ },
  { key: "priority", re: /priority/ },
  { key: "pct", re: /% ?complete|percent|progress/ },
  { key: "status", re: /^status|state/ },
  { key: "predecessors", re: /predecessor|waits on|depends|dependenc/ },
  { key: "description", re: /description|notes?|details|comments?/ },
  { key: "project", re: /project code|^project$/ },
);

function readHeader(row: Raw[]) {
  const idx = { ...headerIndex };
  row.forEach((cell, i) => {
    const h = str(cell).toLowerCase().replace(/\s*\(.*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    if (!h) return;
    for (const c of COLS) {
      if (idx[c.key] === -1 && c.re.test(h)) { idx[c.key] = i; break; }
    }
  });
  return idx;
}

/** Rows of a sheet (first row with a task-name heading is the header). */
export function rowsFromSheet(rows: Raw[][]): SourceRow[] {
  let h = -1;
  let idx = headerIndex;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const t = readHeader(rows[i]);
    if (t.title >= 0) { h = i; idx = t; break; }
  }
  if (h < 0) throw new Error("Couldn't find a column for task names. Name it \"Task\" or \"Task Name\".");
  const body = rows.slice(h + 1);
  dayFirst = guessDayFirst(body.flatMap((r) => [r[idx.start], r[idx.due]]));
  const get = (r: Raw[], k: keyof typeof headerIndex) => (idx[k] >= 0 ? r[idx[k]] : null);
  const out: SourceRow[] = [];
  body.forEach((r, i) => {
    const rawTitle = get(r, "title");
    const title = str(rawTitle);
    if (!title) return;
    const wbs = str(get(r, "wbs"));
    const lvl = idx.level >= 0 ? parseInt(str(get(r, "level")), 10) : wbs ? wbs.split(".").filter(Boolean).length : NaN;
    // leading spaces in the name also show the level (some exports indent names)
    const indent = typeof rawTitle === "string" ? (rawTitle.match(/^\s*/)?.[0].length ?? 0) : 0;
    out.push({
      key: str(get(r, "id")) || String(i + 1),
      title,
      level: !isNaN(lvl) ? lvl : idx.parent < 0 && indent > 0 ? 1 + Math.round(indent / 2) : null,
      parentName: str(get(r, "parent")),
      owner: str(get(r, "owner")),
      collaborators: str(get(r, "collaborators")),
      start: dateOf(get(r, "start")),
      due: dateOf(get(r, "due")),
      priority: priorityOf(get(r, "priority")),
      status: statusOf(get(r, "status"), get(r, "pct")),
      predecessors: splitPredecessors(get(r, "predecessors")),
      description: str(get(r, "description")),
      projectCode: str(get(r, "project")),
    });
  });
  return out;
}

export function parseCsv(text: string): string[][] {
  const delim = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ------------------------------ Microsoft Project XML ------------------------------ */

export function rowsFromProjectXml(xml: string): SourceRow[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("This XML file couldn't be read.");
  const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
  const val = (el: Element, name: string) => kids(el, name)[0]?.textContent?.trim() ?? "";
  const all = (name: string) => Array.from(doc.getElementsByTagNameNS("*", name));
  const tasksEl = all("Tasks")[0];
  if (!tasksEl) throw new Error("This doesn't look like a Microsoft Project XML file (no tasks found).");

  const resources = new Map<string, string>();
  for (const r of all("Resource")) { const n = val(r, "Name"); if (n) resources.set(val(r, "UID"), n); }
  const assigned = new Map<string, string[]>();
  for (const a of all("Assignment")) {
    const name = resources.get(val(a, "ResourceUID"));
    if (!name) continue;
    const t = val(a, "TaskUID");
    assigned.set(t, [...(assigned.get(t) ?? []), name]);
  }

  const out: SourceRow[] = [];
  for (const t of kids(tasksEl, "Task")) {
    const uid = val(t, "UID");
    const name = val(t, "Name");
    const level = parseInt(val(t, "OutlineLevel") || "1", 10);
    if (!name || val(t, "IsNull") === "1" || level === 0 || uid === "0") continue;
    const people = assigned.get(uid) ?? [];
    out.push({
      key: uid,
      title: name,
      level,
      parentName: "",
      owner: people[0] ?? "",
      collaborators: people.slice(1).join(", "),
      start: dateOf(val(t, "Start").slice(0, 10)),
      due: dateOf(val(t, "Finish").slice(0, 10)),
      priority: priorityOf(val(t, "Priority")),
      status: statusOf("", val(t, "PercentComplete")),
      predecessors: kids(t, "PredecessorLink").map((p) => val(p, "PredecessorUID")).filter(Boolean),
      description: val(t, "Notes"),
      projectCode: "",
    });
  }
  return out;
}

/* ------------------------------ fitting to the app ------------------------------ */

interface Ctx {
  projectCode: string;
  profiles: Profile[];
  existing: Task[];            // tasks already in the project
  skipExisting: boolean;
}

export function buildPlan(rows: SourceRow[], source: string, ctx: Ctx): Plan {
  const warnings: string[] = [];
  const note = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };

  // Template files can list tasks for several projects: keep this project's rows.
  if (rows.some((r) => r.projectCode)) {
    const mine = rows.filter((r) => r.projectCode.toLowerCase() === ctx.projectCode.toLowerCase());
    if (mine.length) {
      if (mine.length < rows.length) note(`${rows.length - mine.length} row(s) for other project codes were left out.`);
      rows = mine;
    }
  }

  // people
  const byName = new Map<string, string>();
  for (const p of ctx.profiles) {
    if (!p.is_active || p.role === "viewer") continue;
    byName.set(p.full_name.toLowerCase(), p.id);
    if (p.username) byName.set(p.username.toLowerCase(), p.id);
    const first = p.full_name.split(" ")[0]?.toLowerCase();
    if (first && !byName.has(first)) byName.set(first, p.id);
  }
  const unknown = new Set<string>();
  const person = (raw: string) => {
    const n = raw.replace(/\[.*?\]/g, "").trim();
    if (!n) return null;
    const id = byName.get(n.toLowerCase());
    if (!id) unknown.add(n);
    return id ?? null;
  };
  const people = (raw: string) => raw.split(/[,;]/).map(person).filter(Boolean) as string[];

  // hierarchy: the app has main tasks and one level of subtasks
  const levels = rows.map((r) => r.level).filter((l): l is number => l !== null);
  const top = levels.length ? Math.min(...levels) : 1;
  let deep = 0;
  const titleCount = new Map<string, number>();
  const planned: (PlannedTask & { key: string; preds: string[] })[] = [];
  let lastMain: string | null = null;
  rows.forEach((r, i) => {
    const ref = `r${i}`;
    let parentRef: string | null = null;
    if (r.parentName) {
      const p = [...planned].reverse().find((x) => !x.parentRef && x.title.toLowerCase() === r.parentName.toLowerCase());
      if (p) parentRef = p.ref;
      else note(`Main task "${r.parentName}" wasn't found, so "${r.title}" is added as a main task.`);
    } else if (r.level !== null && r.level > top && lastMain) {
      parentRef = lastMain;
      if (r.level > top + 1) deep++;
    }
    if (!parentRef) lastMain = ref;
    const ids = r.owner.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const ownerId = ids.length ? person(ids[0]) : null;
    const collab = [...ids.slice(1).map(person).filter(Boolean) as string[], ...people(r.collaborators)].filter((id) => id !== ownerId);
    titleCount.set(r.title.toLowerCase(), (titleCount.get(r.title.toLowerCase()) ?? 0) + 1);
    let start = r.start, due = r.due;
    if (start && due && due < start) { note(`"${r.title}" ends before it starts, so its dates were swapped.`); [start, due] = [due, start]; }
    planned.push({
      ref, key: r.key, preds: r.predecessors, title: r.title.slice(0, 300), parentRef, ownerId,
      collaboratorIds: [...new Set(collab)], start, due, priority: r.priority ?? "medium", status: r.status ?? "todo",
      description: r.description, predecessorRefs: [], existingPredecessorIds: [],
    });
  });
  if (deep) note(`${deep} task(s) were more than two levels deep. The app has main tasks and subtasks only, so they were added as subtasks of their top-level task.`);
  if (unknown.size) note(`No one in the app matches ${[...unknown].slice(0, 8).map((n) => `"${n}"`).join(", ")}${unknown.size > 8 ? ` and ${unknown.size - 8} more` : ""}. Those tasks are added without that person.`);

  // subtask dates must sit inside their main task's dates
  let clamped = 0;
  for (const t of planned) {
    if (!t.parentRef) continue;
    const p = planned.find((x) => x.ref === t.parentRef)!;
    const fit = (d: string | null) => (!d ? d : p.start && d < p.start ? p.start : p.due && d > p.due ? p.due : d);
    const s = fit(t.start), d = fit(t.due);
    if (s !== t.start || d !== t.due) { clamped++; t.start = s; t.due = d; }
  }
  if (clamped) note(`${clamped} subtask(s) had dates outside their main task's dates, so they were moved inside.`);

  // skip tasks that are already in the project
  let skipped = 0;
  let kept = planned;
  if (ctx.skipExisting) {
    const have = new Set(ctx.existing.map((t) => t.title.toLowerCase()));
    const drop = new Set(planned.filter((t) => have.has(t.title.toLowerCase())).map((t) => t.ref));
    // dropping a main task keeps its subtasks only if they're new; they move under the existing main task
    kept = planned.filter((t) => !drop.has(t.ref));
    skipped = drop.size;
    for (const t of kept) {
      if (t.parentRef && drop.has(t.parentRef)) {
        const title = planned.find((x) => x.ref === t.parentRef)!.title.toLowerCase();
        const ex = ctx.existing.find((e) => !e.parent_id && e.title.toLowerCase() === title);
        t.parentRef = ex ? `existing:${ex.id}` : null;
      }
    }
  }

  // predecessors: by ID/row number in the file, or by name (also tasks already in the project)
  const byKey = new Map(planned.map((t) => [t.key, t]));
  const byTitle = new Map(planned.map((t) => [t.title.toLowerCase(), t]));
  const keptRefs = new Set(kept.map((t) => t.ref));
  const existingByTitle = new Map(ctx.existing.map((t) => [t.title.toLowerCase(), t]));
  let missingPred = 0;
  for (const t of kept) {
    for (const p of t.preds) {
      const hit = byKey.get(p) ?? byTitle.get(p.toLowerCase());
      if (hit && hit.ref !== t.ref) {
        if (keptRefs.has(hit.ref)) t.predecessorRefs.push(hit.ref);
        else { const ex = existingByTitle.get(hit.title.toLowerCase()); if (ex) t.existingPredecessorIds.push(ex.id); }
        continue;
      }
      const ex = existingByTitle.get(p.toLowerCase());
      if (ex) { t.existingPredecessorIds.push(ex.id); continue; }
      missingPred++;
    }
    t.predecessorRefs = [...new Set(t.predecessorRefs)];
    t.existingPredecessorIds = [...new Set(t.existingPredecessorIds)];
  }
  if (missingPred) note(`${missingPred} predecessor(s) didn't match a task in the file or the project and were left out.`);
  const dupes = [...titleCount].filter(([, n]) => n > 1).length;
  if (dupes) note(`${dupes} task name(s) appear more than once. Predecessors written as names point to the last one.`);

  return { tasks: kept.map(({ key: _k, preds: _p, ...t }) => t), warnings, skipped, source };
}

/** Read any supported file into source rows. */
export async function readTaskFile(file: File): Promise<{ rows: SourceRow[]; source: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".mpp") || name.endsWith(".mpt")) {
    throw new Error("A .mpp file can't be read in the browser. In Microsoft Project, choose File > Save As and pick \"XML Format (*.xml)\" or \"Excel Workbook\", then upload that file.");
  }
  if (name.endsWith(".xml")) return { rows: rowsFromProjectXml(await file.text()), source: "Microsoft Project XML" };
  if (name.endsWith(".csv") || name.endsWith(".txt")) return { rows: rowsFromSheet(parseCsv(await file.text())), source: "CSV" };
  if (name.endsWith(".xls")) throw new Error("Old .xls files aren't supported. Open it in Excel and save it as .xlsx first.");
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const { default: readXlsxFile, readSheetNames } = await import("read-excel-file");
    const names = await readSheetNames(file);
    const pick = names.find((n) => /^tasks?$/i.test(n.trim())) ?? names.find((n) => !/how to|instructions|projects?$/i.test(n)) ?? names[0];
    const rows = await readXlsxFile(file, { sheet: pick });
    return { rows: rowsFromSheet(rows as Raw[][]), source: `Excel (sheet "${pick}")` };
  }
  throw new Error("Choose an Excel (.xlsx), CSV or Microsoft Project XML (.xml) file.");
}
