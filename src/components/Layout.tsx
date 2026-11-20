import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderKanban, ListChecks, Users, Settings, LogOut, Menu, X, UserCircle, ChevronDown, Tags } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useStore } from "../lib/store";
import { ROLE_LABEL } from "../lib/format";
import { NotificationsBell } from "./Notifications";
import { Avatar, cx } from "./ui";
import { TaskPanelHost } from "./TaskPanel";
import { SearchBox } from "./SearchBox";

export function Layout() {
  const { me, signOut } = useAuth();
  const { settings } = useStore();
  const [navOpen, setNavOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setNavOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!menu) return;
    const f = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [menu]);

  const links = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/my-tasks", label: "My tasks", icon: ListChecks },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    { to: "/workload", label: "Workload", icon: Users },
    ...(me?.role === "admin" ? [{ to: "/admin", label: "Admin panel", icon: Settings }]
      : me?.role === "manager" ? [{ to: "/admin", label: "Categories", icon: Tags }] : []),
  ];

  return (
    <div className="flex h-full">
      {/* sidebar */}
      <aside className={cx(
        "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-950 text-navy-100 transition-transform lg:static lg:translate-x-0",
        navOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <NavLink to="/" className="block rounded-lg bg-white px-3 py-2">
            <img src="/logo.png" alt={settings.company_name || "Idea2Launch"} className="h-9 w-auto" />
          </NavLink>
          <button className="text-navy-200 lg:hidden" aria-label="Close menu" onClick={() => setNavOpen(false)}><X className="size-5" /></button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                isActive ? "bg-white/10 text-white" : "text-navy-200 hover:bg-white/5 hover:text-white")}>
              {({ isActive }) => (<><Icon className={cx("size-[18px]", isActive && "text-brand-400")} />{label}</>)}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 pb-4 text-[11px] tracking-wide text-navy-300">Innovate · Develop · Launch</div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setNavOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-5">
          <button className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Menu className="size-5" />
          </button>
          <img src="/icon.png" alt="" className="size-7 lg:hidden" />
          <div className="flex-1"><SearchBox /></div>
          <NotificationsBell />
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg py-1 pr-1 pl-1 hover:bg-slate-100" aria-label="Account menu">
              <Avatar person={me} size={30} />
              <span className="hidden text-left sm:block">
                <span className="block text-sm leading-tight font-medium text-slate-800">{me?.full_name}</span>
                <span className="block text-[11px] leading-tight text-slate-500">{me ? ROLE_LABEL[me.role] : ""}</span>
              </span>
              <ChevronDown className="hidden size-4 text-slate-400 sm:block" />
            </button>
            {menu && (
              <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200">
                <button className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50" onClick={() => { setMenu(false); nav("/account"); }}>
                  <UserCircle className="size-4" /> My account
                </button>
                <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50" onClick={signOut}>
                  <LogOut className="size-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <TaskPanelHost />
    </div>
  );
}
