import { MONTHS, daysInMonth } from "../lib/birthdays";
import { Select, cx } from "./ui";

/** Day + month picker (no year). */
export function BirthdayField({ month, day, onChange, className, plain }: {
  month: number | null; day: number | null; onChange: (month: number | null, day: number | null) => void; className?: string;
  /** use plain inputs styled by the caller (sign-in screens) */
  plain?: string;
}) {
  const max = month ? daysInMonth(month) : 31;
  const days = Array.from({ length: max }, (_, i) => i + 1);
  const setMonth = (m: number | null) => onChange(m, m && day ? Math.min(day, daysInMonth(m)) : m ? day : null);
  const daySel = (
    <option value="">Day</option>
  );
  if (plain) {
    return (
      <div className={cx("grid grid-cols-[5.5rem_1fr] gap-2", className)}>
        <select aria-label="Birthday day" className={plain} value={day ?? ""} onChange={(e) => onChange(month, e.target.value ? +e.target.value : null)}>
          {daySel}{days.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select aria-label="Birthday month" className={plain} value={month ?? ""} onChange={(e) => setMonth(e.target.value ? +e.target.value : null)}>
          <option value="">Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className={cx("grid grid-cols-[6rem_1fr] gap-2", className)}>
      <Select aria-label="Birthday day" value={day ?? ""} onChange={(e) => onChange(month, e.target.value ? +e.target.value : null)}>
        {daySel}{days.map((d) => <option key={d} value={d}>{d}</option>)}
      </Select>
      <Select aria-label="Birthday month" value={month ?? ""} onChange={(e) => setMonth(e.target.value ? +e.target.value : null)}>
        <option value="">Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </Select>
    </div>
  );
}

/** Both or neither must be set. */
export const birthdayError = (month: number | null, day: number | null) =>
  (month === null) !== (day === null) ? "Pick both the day and the month of the birthday, or leave both empty." : "";
