// Maps Supabase DB rows ↔ the UI-facing domain types (M1/M2), so the data
// layer can change without the UI caring. One direction only (row → domain);
// writes are built explicitly in the store from the typed Insert/Update shapes.

import type { Business, Location, Role, TeamMember } from "./types";
import type { Database } from "./supabase/database.types";

export type BusinessRow = Database["public"]["Tables"]["business"]["Row"];
export type LocationRow = Database["public"]["Tables"]["location"]["Row"];
export type RoleRow = Database["public"]["Tables"]["role"]["Row"];
export type AppUserRow = Database["public"]["Tables"]["app_user"]["Row"];

export function mapBusiness(r: BusinessRow): Business {
  return {
    id: r.id,
    name: r.name,
    timezone: r.timezone,
    weekStartDay: r.week_start_day,
    rosterPeriod: r.roster_period,
    currency: r.currency,
    subscriptionStatus: r.subscription_status,
    logoInitial: r.logo_initial,
  };
}

export function mapLocation(r: LocationRow): Location {
  return { id: r.id, name: r.name, address: r.address, active: r.active };
}

export function mapRole(r: RoleRow): Role {
  return {
    id: r.id,
    name: r.name,
    shortCode: r.short_code,
    colour: r.colour,
    active: r.active,
  };
}

export function mapTeamMember(r: AppUserRow, roleIds: string[]): TeamMember {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? "",
    email: r.email ?? "",
    colour: r.colour ?? "ember",
    level: r.level,
    employmentType: r.employment_type,
    primaryRoleId: r.primary_role_id,
    roleIds,
    homeLocationId: r.home_location_id,
    canWorkOtherLocations: r.can_work_other_locations,
    payRate: Number(r.pay_rate),
    maxHoursWeek: r.max_hours_week,
    minHoursWeek: r.min_hours_week,
    maxShiftsWeek: r.max_shifts_week,
    preferredDays: r.preferred_days ?? [],
    preferredTimeOfDay: r.preferred_time_of_day,
    notes: r.notes ?? "",
    isManager: r.is_manager,
    inviteStatus: r.invite_status,
    active: r.active,
    createdAt: r.created_at,
  };
}
