import type { Employee, Shift } from "./types";

// ---------- dates ----------

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Monday of the week containing `d` (weeks start Monday). */
export function mondayOf(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay(); // 0 Sun .. 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + diff);
  return toISODate(copy);
}

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MON_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function dayName(iso: string, long = false): string {
  const d = parseISO(iso);
  return (long ? DOW_LONG : DOW_SHORT)[d.getDay()];
}

export function dayNum(iso: string): number {
  return parseISO(iso).getDate();
}

export function monthShort(iso: string): string {
  return MON_SHORT[parseISO(iso).getMonth()];
}

/** "Mon 25 May" */
export function formatDayLabel(iso: string): string {
  const d = parseISO(iso);
  return `${DOW_SHORT[d.getDay()]} ${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
}

/** "Mon 25 May 2026" */
export function formatDayLong(iso: string): string {
  const d = parseISO(iso);
  return `${DOW_LONG[d.getDay()]}, ${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** "25 May – 7 Jun" */
export function formatRange(startIso: string, endIso: string): string {
  const a = parseISO(startIso);
  const b = parseISO(endIso);
  const left = `${a.getDate()} ${MON_SHORT[a.getMonth()]}`;
  const right = `${b.getDate()} ${MON_SHORT[b.getMonth()]}`;
  return `${left} – ${right}`;
}

export function isToday(iso: string): boolean {
  return iso === toISODate(new Date());
}

export function isPast(iso: string): boolean {
  return parseISO(iso).getTime() < parseISO(toISODate(new Date())).getTime();
}

export function todayISO(): string {
  return toISODate(new Date());
}

// ---------- time ----------

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** "16:00" -> "4:00 PM" */
export function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "16:00" -> "4PM", "16:30" -> "4:30PM" (compact, for grid cells) */
export function formatTimeShort(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "p" : "a";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

// ---------- hours + money ----------

/** Paid hours for a shift (gross span minus unpaid break). */
export function shiftHours(shift: Pick<Shift, "startTime" | "endTime" | "breakMinutes">): number {
  let mins = timeToMinutes(shift.endTime) - timeToMinutes(shift.startTime);
  if (mins < 0) mins += 24 * 60; // overnight safety
  mins -= shift.breakMinutes || 0;
  return Math.max(0, mins) / 60;
}

export function shiftCost(shift: Shift, employee: Employee | undefined): number {
  if (!employee) return 0;
  return shiftHours(shift) * employee.hourlyRate;
}

export function formatHours(h: number): string {
  return `${h.toFixed(h % 1 === 0 ? 0 : 1)}h`;
}

export function formatMoney(n: number, withCents = false): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  }).format(n);
}

// ---------- misc ----------

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** Accent palette keyed by token stored on the employee. */
export const ACCENTS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  ember: { bg: "#fbe6d8", text: "#9c3b12", dot: "#d75321", border: "#f0c4a8" },
  herb: { bg: "#e6ebd2", text: "#4a571f", dot: "#6c7d3e", border: "#cdd7a8" },
  saffron: { bg: "#f7e9c6", text: "#8a6212", dot: "#d99a1e", border: "#ecd49a" },
  clay: { bg: "#f3dcd3", text: "#8a3418", dot: "#a8492c", border: "#e6c0b1" },
  teal: { bg: "#d6e8e3", text: "#1f5249", dot: "#2f7a6b", border: "#aed3c9" },
  plum: { bg: "#ecdce4", text: "#73304c", dot: "#9c4670", border: "#dcc0cd" },
  slate: { bg: "#dde2e6", text: "#3a4651", dot: "#5a6b7a", border: "#c2cbd2" },
  gold: { bg: "#f1e7cf", text: "#7a5a16", dot: "#b08a2e", border: "#e2d2a8" },
};

export const ACCENT_KEYS = Object.keys(ACCENTS);

export function accentOf(token: string) {
  return ACCENTS[token] ?? ACCENTS.ember;
}
