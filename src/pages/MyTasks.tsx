import { useMemo, useState } from "react";
import { addDays } from "date-fns";
import { ListChecks } from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { isoDay } from "../lib/format";
import { isoToday, today } from "../lib/metrics";
import { canEditProject } from "../lib/perms";
import type { Task } from "../lib/types";
import { Card, EmptyState, PageHeader, Spinner, Tabs } from "../components/ui";
import { TaskRow, TaskTableHeader } from "../components/TaskRow";

export default function MyTasks() {
  const store = useStore();
  const { me } = useAuth();
  const [scope, setScope] = useState<"owner" | "collab">("owner");

  const groups = useMemo(() => {
    if (!me) return [];
    const collabIds = new Set(store.collaborators.filter((c) => c.user_id === me.id).map((c) => c.task_id));
    const mine = store.tasks.filter((t) => (scope === "owner" ? t.owner_id === me.id : collabIds.has(t.id)));
    const t0 = isoToday();
    const week = isoDay(addDays(today(), 7));
    const recent = isoDay(addDays(today(), -14));
    const open = mine.filter((t) => t.status !== "done");
    const by = (a: Task, b: Task) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
    return [
      { id: "late", title: "Overdue", tasks: open.filter((t) => t.due_date && t.due_date < t0).sort(by) },
      { id: "week", title: "Next 7 days", tasks: open.filter((t) => t.due_date && t.due_date >= t0 && t.due_date <= week).sort(by) },
      { id: "later", title: "Later", tasks: open.filter((t) => t.due_date && t.due_date > week).sort(by) },
      { id: "nodate", title: "No due date", tasks: open.filter((t) => !t.due_date) },
      { id: "done", title: "Done in the last 2 weeks", tasks: mine.filter((t) => t.status === "done" && (t.completed_at ?? "") >= recent) },
    ];
  }, [store.tasks, store.collaborators, me, scope]);

  if (!store.ready) return <Spinner />;
  const total = groups.slice(0, 4).reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="My tasks" subtitle={`${total} open`} />
      <Tabs value={scope} onChange={setScope} tabs={[{ id: "owner", label: "I own" }, { id: "collab", label: "I'm collaborating on" }]} />
      <div className="mt-4 space-y-5">
        {total === 0 && groups[4].tasks.length === 0 ? (
          <EmptyState icon={<ListChecks className="size-8" />} title="Nothing here" text="Tasks assigned to you will show up here." />
        ) : groups.filter((g) => g.tasks.length).map((g) => (
          <section key={g.id}>
            <h2 className={`mb-2 text-sm font-semibold ${g.id === "late" ? "text-red-600" : "text-slate-700"}`}>{g.title} <span className="font-normal text-slate-400">{g.tasks.length}</span></h2>
            <Card className="overflow-hidden">
              <TaskTableHeader />
              {g.tasks.map((t) => {
                const p = store.projectById.get(t.project_id);
                return <TaskRow key={t.id} task={t} showProject canEdit={canEditProject(me, p, store.membersOf(t.project_id))} />;
              })}
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
