import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderKanban, ListChecks, Users, Settings, LogOut, Menu, X, UserCircle, ChevronDown, Tags, Sun, Moon, Monitor, FlaskConical, Cake } from "lucide-react";
import { useTheme, type ThemePref } from "../lib/theme";
import { useAuth } from "../lib/auth";
import { useStore } from "../lib/store";
import { ROLE_LABEL } from "../lib/format";
import { NotificationsBell } from "./Notifications";
import { Avatar, cx } from "./ui";
import { TaskPanelHost } from "./TaskPanel";
import { SearchBox } from "./SearchBox";
import { InstallApp } from "./InstallApp";
import { BirthdayOverlay, BirthdayPrompt } from "./Birthday";

export function Layout() {
  const { me, signOut } = useAuth();
  const { settings } = useStore();
  const [navOpen, setNavOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useTheme();
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
    { to: "/trials", label: "R&D Trials", icon: FlaskConical },
    { to: "/birthdays", label: "Birthdays", icon: Cake },
    ...(me?.role === "admin" ? [{ to: "/admin", label: "Admin panel", icon: Settings }]
      : me?.role === "manager" ? [{ to: "/admin", label: "Categories", icon: Tags }] : []),
  ];

  return (
    <div className="flex h-full">
      {/* sidebar */}
      <aside className={cx(
        "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-white transition-transform lg:static lg:translate-x-0",
        navOpen ? "translate-x-0 shadow-pop" : "-translate-x-full")}>
        <div className="flex items-center gap-2 px-4 pt-4 pb-4">
          <NavLink to="/" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg" aria-label={settings.company_name || "Idea2Launch"}>
            <img src="/icon.png" alt="" className="size-9 shrink-0 dark:rounded-lg dark:bg-[#fff] dark:p-0.5" />
            <span className="min-w-0 leading-tight">
              <span className="block text-[15px] font-extrabold tracking-tight text-navy-900">IDEA<span className="text-brand-500">2</span>LAUNCH</span>
              <span className="block truncate text-[10.5px] font-medium text-slate-400">Innovate · Develop · Launch</span>
            </span>
          </NavLink>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Close menu" onClick={() => setNavOpen(false)}><X className="size-5" /></button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-1">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cx(
                "flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13.5px]",
                isActive ? "bg-navy-50 font-semibold text-navy-900" : "font-medium text-slate-600 hover:bg-slate-100 hover:text-ink")}>
              {({ isActive }) => (<><Icon className={cx("size-[18px]", isActive ? "text-brand-500" : "text-slate-400")} />{label}</>)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line-soft px-3 pt-2 pb-3"><InstallApp /></div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-scrim/40 lg:hidden" onClick={() => setNavOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-white/85 px-3 backdrop-blur sm:px-6 lg:px-8">
          <NavLink to="/" className="flex shrink-0 items-center gap-1.5 lg:hidden" aria-label="Dashboard">
            <img src="/icon.png" alt="" className="size-7 dark:rounded-md dark:bg-[#fff] dark:p-0.5" />
            <span className="hidden text-sm font-extrabold tracking-tight text-navy-900 min-[400px]:block">IDEA<span className="text-brand-500">2</span>LAUNCH</span>
          </NavLink>
          <div className="min-w-0 flex-1 lg:max-w-md"><SearchBox /></div>
          <div className="hidden flex-1 lg:block" />
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
              <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl bg-white py-1 shadow-pop ring-1 ring-line">
                <button className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50" onClick={() => { setMenu(false); nav("/account"); }}>
                  <UserCircle className="size-4" /> My account
                </button>
                <div className="border-y border-line-soft px-4 py-2.5">
                  <p className="mb-1.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">Appearance</p>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Appearance">
                    {([["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Auto", Monitor]] as [ThemePref, string, typeof Sun][]).map(([v, l, Icon]) => (
                      <button key={v} role="radio" aria-checked={theme === v} title={v === "system" ? "Match this device" : `${l} mode`} onClick={() => setTheme(v)}
                        className={cx("flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[11px] font-semibold", theme === v ? "bg-white text-ink shadow-card" : "text-slate-500 hover:text-ink")}>
                        <Icon className="size-4" />{l}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50" onClick={signOut}>
                  <LogOut className="size-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 pt-5 pb-24 sm:px-6 lg:px-8 lg:pt-6 lg:pb-8">
          <Outlet />
        </main>
        <BirthdayPrompt />
        <BirthdayOverlay />
      </div>
      {/* phone bottom bar */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
        {links.slice(0, 4).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cx("flex h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold", isActive ? "text-navy-900" : "text-slate-500")}>
            {({ isActive }) => (<><Icon className={cx("size-5", isActive && "text-brand-500")} />{label === "Dashboard" ? "Home" : label}</>)}
          </NavLink>
        ))}
        <button onClick={() => setNavOpen(true)} className="flex h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold text-slate-500" aria-label="Open menu">
          <Menu className="size-5" />More
        </button>
      </nav>
      <TaskPanelHost />
    </div>
  );
}
