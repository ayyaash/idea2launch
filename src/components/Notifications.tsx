import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useStore } from "../lib/store";
import { timeAgo } from "../lib/format";
import { Avatar, IconButton, cx } from "./ui";
import { useAuth } from "../lib/auth";

export function NotificationsBell() {
  const { notifications, profileById, refreshNotifications } = useStore();
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markAll() {
    if (!me) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me.id).is("read_at", null);
    refreshNotifications();
  }

  async function openOne(id: string, projectId: string | null, taskId: string | null) {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    refreshNotifications();
    setOpen(false);
    if (projectId) nav(`/projects/${projectId}${taskId ? `?task=${taskId}` : ""}`);
  }

  return (
    <div className="relative" ref={box}>
      <IconButton label={`Notifications${unread ? ` (${unread} unread)` : ""}`} onClick={() => setOpen((o) => !o)} className="relative">
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </IconButton>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-line">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</p>}
            {notifications.map((n) => {
              const actor = n.actor_id ? profileById.get(n.actor_id) : undefined;
              return (
                <button key={n.id} onClick={() => openOne(n.id, n.project_id, n.task_id)}
                  className={cx("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50", !n.read_at && "bg-brand-50/60")}>
                  <Avatar person={actor} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-800">
                      <b className="font-semibold">{actor?.full_name ?? "Someone"}</b> {n.title}
                    </span>
                    <span className="text-xs text-slate-500">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
