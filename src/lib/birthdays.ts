import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import type { Profile } from "./types";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const daysInMonth = (m: number) => (m === 2 ? 29 : [4, 6, 9, 11].includes(m) ? 30 : 31);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The person's birthday in a given year (29 Feb falls on 28 Feb in other years). */
export function birthdayIn(p: Pick<Profile, "birth_month" | "birth_day">, year: number): Date | null {
  if (!p.birth_month || !p.birth_day) return null;
  const d = p.birth_month === 2 && p.birth_day === 29 && !isLeap(year) ? 28 : p.birth_day;
  return new Date(year, p.birth_month - 1, d);
}

/** Days since this person's most recent birthday (0 = today), or null. */
export function daysSinceBirthday(p: Pick<Profile, "birth_month" | "birth_day">, today = new Date()): number | null {
  const t = startOfDay(today);
  for (const y of [t.getFullYear(), t.getFullYear() - 1]) {
    const b = birthdayIn(p, y);
    if (b && b <= t) return differenceInCalendarDays(t, b);
  }
  return null;
}

/** Birthday week: the birthday itself and the six days after it. */
export const inBirthdayWeek = (p: Pick<Profile, "birth_month" | "birth_day">, today = new Date()) => {
  const d = daysSinceBirthday(p, today);
  return d !== null && d <= 6;
};

/** Next birthday on or after today. */
export function nextBirthday(p: Pick<Profile, "birth_month" | "birth_day">, today = new Date()): Date | null {
  const t = startOfDay(today);
  const b = birthdayIn(p, t.getFullYear());
  if (!b) return null;
  return b >= t ? b : birthdayIn(p, t.getFullYear() + 1);
}

export const fmtBirthday = (p: Pick<Profile, "birth_month" | "birth_day">) =>
  p.birth_month && p.birth_day ? `${p.birth_day} ${MONTHS[p.birth_month - 1]}` : "";

export const withinDays = (d: Date, n: number, today = new Date()) => d <= addDays(startOfDay(today), n);
