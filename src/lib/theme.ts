import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "i2l.theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}

/** Puts the .dark class on <html> and the browser bar colour to match. */
export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b1120" : "#072A62");
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    const m = media();
    const on = () => applyTheme("system");
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [pref]);
  const set = (p: ThemePref) => {
    try { if (p === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* ignore */ }
    setPref(p);
  };
  return [pref, set] as const;
}
