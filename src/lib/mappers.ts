// Maps Supabase DB rows ↔ the UI-facing domain types, so the store can be
// swapped to Supabase without changing the UI or selectors

import { ROLES, type Employee, type EmploymentType, type Role, type Schedule, type Shift } from "./types";
import type { Database } from "./supabase/database.types";
import { addDays } from "./utils";

export type AppUserRow = Database["public"]["Tables"]["app_user"]["Row"];
export type ShiftRow = Database["public"]["Tables"]["shift"]["Row"];
export type RosterRow = Database["public"]["Tables"]["roster"]["Row"];
export type LocationRow = Database["public"]["Tables"]["location"]["Row"];

/** DB `time` values come back as "HH:MM:SS"; the UI works in "HH:MM". */
const hhmm = (t: string): string => t.slice(0, 5);

/** Coerce free-text job role to the UI's Role union, defaulting safely. */
export function toRole(value: string | null | undefined): Role {
  return (ROLES as readonly string[]).includes(value ?? "") ? (value as Role) : "Front of House";
}

export type LocationNamer = (id: string | null) => string;

export function mapEmployee(row: AppUserRow, locationName: LocationNamer): Employee {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? "",
    phone: row.phone ?? "",
    role: toRole(row.position),
    employmentType: row.employment_type as EmploymentType,
    hourlyRate: Number(row.pay_rate),
    location: locationName(row.home_location_id),
    isActive: row.active,
    accent: row.colour ?? "ember",
    createdAt: row.created_at,
  };
}

export function mapShift(row: ShiftRow, locationName: LocationNamer): Shift {
  return {
    id: row.id,
    employeeId: row.assigned_user_id ?? "",
    date: row.date,
    startTime: hhmm(row.start_time),
    endTime: hhmm(row.end_time),
    role: toRole(row.role),
    location: locationName(row.location_id),
    breakMinutes: row.break_minutes,
    notes: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapSchedule(row: RosterRow): Schedule {
  return {
    id: row.id,
    name: "Current fortnight",
    startDate: row.fortnight_start,
    endDate: addDays(row.fortnight_start, 13),
    status: row.status,
    createdAt: row.created_at,
  };
}
