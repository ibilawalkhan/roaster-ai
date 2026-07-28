// Data access for Module 1 (Business Setup & Configuration).
//
// Thin, typed queries only — every rule/validation decision lives in
// src/lib/domain/settings-validation.ts so it is testable without a database.
// RLS is the real boundary: these tables are manager-only and business-scoped
// by policy (supabase/migrations/0002_rls.sql), so no query here builds a
// business_id filter by hand except where a row is being inserted.

import { getSupabaseClient } from "./client";
import type { Enums, Tables, TablesInsert, TablesUpdate } from "./database.types";
// Trading hours are read by both M3 (availability) and M1 (settings) — one
// fetch function, re-exported rather than duplicated.
import { fetchTradingHours, type TradingHoursRow } from "./availability";

export { fetchTradingHours };
export type { TradingHoursRow };

export type BusinessRow = Tables<"business">;
export type LocationRow = Tables<"location">;
export type RoleRow = Tables<"role">;
export type SchedulingRuleRow = Tables<"scheduling_rule">;
export type BreakRuleRow = Tables<"break_rule">;

// ---------------------------------------------------------------------------
// Business profile (M1 §3.1)
// ---------------------------------------------------------------------------

export interface BusinessProfilePatch {
  name?: string;
  timezone?: string;
  weekStartDay?: number;
  rosterPeriod?: Enums<"roster_period">;
  currency?: string;
}

export async function fetchBusiness(): Promise<BusinessRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("business").select("*").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateBusinessProfile(
  businessId: string,
  patch: BusinessProfilePatch,
): Promise<void> {
  const update: TablesUpdate<"business"> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.timezone !== undefined) update.timezone = patch.timezone;
  if (patch.weekStartDay !== undefined) update.week_start_day = patch.weekStartDay;
  if (patch.rosterPeriod !== undefined) update.roster_period = patch.rosterPeriod;
  if (patch.currency !== undefined) update.currency = patch.currency;
  if (Object.keys(update).length === 0) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("business").update(update).eq("id", businessId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Locations (M1 §3.2)
// ---------------------------------------------------------------------------

export async function fetchLocations(): Promise<LocationRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("location").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export interface LocationInput {
  name: string;
  address: string | null;
}

export async function createLocation(
  businessId: string,
  input: LocationInput,
): Promise<LocationRow> {
  const insert: TablesInsert<"location"> = {
    business_id: businessId,
    name: input.name.trim(),
    address: input.address?.trim() || null,
    active: true,
  };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("location").insert(insert).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateLocation(id: string, input: Partial<LocationInput>): Promise<void> {
  const update: TablesUpdate<"location"> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.address !== undefined) update.address = input.address?.trim() || null;
  if (Object.keys(update).length === 0) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("location").update(update).eq("id", id);
  if (error) throw error;
}

/** Deactivate/reactivate. History is never deleted (M1 §6). */
export async function setLocationActive(id: string, active: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("location").update({ active }).eq("id", id);
  if (error) throw error;
}

/**
 * How many shifts this location still has on or after `fromISODate`. Drives the
 * "warn and require confirmation" branch of the deactivation check (M1 §6).
 */
export async function countFutureShiftsForLocation(
  locationId: string,
  fromISODate: string,
): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("shift")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId)
    .gte("date", fromISODate);
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Roles (M1 §3.4)
// ---------------------------------------------------------------------------

export async function fetchRoles(): Promise<RoleRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("role").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export interface RoleInput {
  name: string;
  shortCode: string | null;
  colour: string | null;
}

export async function createRole(businessId: string, input: RoleInput): Promise<RoleRow> {
  const insert: TablesInsert<"role"> = {
    business_id: businessId,
    name: input.name.trim(),
    short_code: input.shortCode?.trim().toUpperCase() || null,
    colour: input.colour,
    active: true,
  };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("role").insert(insert).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateRole(id: string, input: Partial<RoleInput>): Promise<void> {
  const update: TablesUpdate<"role"> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.shortCode !== undefined) update.short_code = input.shortCode?.trim().toUpperCase() || null;
  if (input.colour !== undefined) update.colour = input.colour;
  if (Object.keys(update).length === 0) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("role").update(update).eq("id", id);
  if (error) throw error;
}

export async function setRoleActive(id: string, active: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("role").update({ active }).eq("id", id);
  if (error) throw error;
}

/** Only ever call after `countRoleReferences` returns zero (M1 §6). */
export async function deleteRole(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("role").delete().eq("id", id);
  if (error) throw error;
}

export interface RoleReferenceCounts {
  staffCount: number;
  templateSlotCount: number;
  rosterCount: number;
}

async function countRows(
  table: "app_user" | "user_role" | "template_slot" | "shift" | "roster_position",
  column: string,
  value: string,
): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Everything that would break if this role vanished: staff who hold it, week
 * template slots asking for it, and positions/shifts on real rosters.
 */
export async function countRoleReferences(roleId: string): Promise<RoleReferenceCounts> {
  const [primary, qualified, slots, positions, shifts] = await Promise.all([
    countRows("app_user", "primary_role_id", roleId),
    countRows("user_role", "role_id", roleId),
    countRows("template_slot", "role_id", roleId),
    countRows("roster_position", "role_id", roleId),
    countRows("shift", "role_id", roleId),
  ]);
  return {
    // A person counts once whether they hold it as primary, as a capability, or both.
    staffCount: Math.max(primary, qualified),
    templateSlotCount: slots,
    rosterCount: positions + shifts,
  };
}

// ---------------------------------------------------------------------------
// Trading hours (M1 §3.3) — one row per location per weekday
// ---------------------------------------------------------------------------

export interface TradingHoursUpsert {
  businessId: string;
  locationId: string;
  dayOfWeek: number;
  isOpen: boolean;
  is24h: boolean;
  opensAt: string | null; // "HH:MM"
  closesAt: string | null;
}

/**
 * Upsert a whole week for one location in one round trip. A closed or 24-hour
 * day stores null times, which keeps the DB check constraints satisfied and
 * means the scheduler never sees stale hours on a closed day.
 */
export async function upsertTradingHours(days: TradingHoursUpsert[]): Promise<void> {
  if (days.length === 0) return;
  const rows: TablesInsert<"trading_hours">[] = days.map((d) => ({
    business_id: d.businessId,
    location_id: d.locationId,
    day_of_week: d.dayOfWeek,
    is_open: d.isOpen,
    is_24h: d.isOpen && d.is24h,
    opens_at: d.isOpen && !d.is24h ? d.opensAt : null,
    closes_at: d.isOpen && !d.is24h ? d.closesAt : null,
  }));

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("trading_hours")
    .upsert(rows, { onConflict: "location_id,day_of_week" });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Scheduling rules (M1 §3.6) — exactly one row per business
// ---------------------------------------------------------------------------

export async function fetchSchedulingRule(): Promise<SchedulingRuleRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("scheduling_rule")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface SchedulingRulePatch {
  seniorCoverageEnabled: boolean;
  seniorMinCount: number;
  seniorQualifyingLevels: Enums<"user_level">[];
  maxHoursCasual: number;
  maxHoursPartTime: number;
  maxHoursFullTime: number;
  maxConsecutiveDays: number;
  minRestHours: number;
  maxShiftHours: number;
  minShiftHours: number;
  oneShiftPerDay: boolean;
  allowOvernight: boolean;
  softPriorityOrder: string[];
}

/**
 * Upsert on business_id: a business that has never opened Settings has no row
 * yet (the wizard would normally seed it), so saving must create it.
 */
export async function saveSchedulingRule(
  businessId: string,
  patch: SchedulingRulePatch,
): Promise<void> {
  const row: TablesInsert<"scheduling_rule"> = {
    business_id: businessId,
    senior_coverage_enabled: patch.seniorCoverageEnabled,
    senior_min_count: patch.seniorMinCount,
    senior_qualifying_levels: patch.seniorQualifyingLevels,
    max_hours_casual: patch.maxHoursCasual,
    max_hours_part_time: patch.maxHoursPartTime,
    max_hours_full_time: patch.maxHoursFullTime,
    max_consecutive_days: patch.maxConsecutiveDays,
    min_rest_hours: patch.minRestHours,
    max_shift_hours: patch.maxShiftHours,
    min_shift_hours: patch.minShiftHours,
    one_shift_per_day: patch.oneShiftPerDay,
    allow_overnight: patch.allowOvernight,
    soft_priority_order: patch.softPriorityOrder,
  };

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("scheduling_rule")
    .upsert(row, { onConflict: "business_id" });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Break rules (M1 §3.7) — cost ESTIMATES only, never payroll
// ---------------------------------------------------------------------------

export async function fetchBreakRules(): Promise<BreakRuleRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("break_rule").select("*").order("min_hours");
  if (error) throw error;
  return data ?? [];
}

export interface BreakRuleInput {
  minHours: number;
  maxHours: number | null;
  breakMinutes: number;
}

export async function createBreakRule(
  businessId: string,
  input: BreakRuleInput,
): Promise<BreakRuleRow> {
  const insert: TablesInsert<"break_rule"> = {
    business_id: businessId,
    min_hours: input.minHours,
    max_hours: input.maxHours,
    break_minutes: input.breakMinutes,
  };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("break_rule").insert(insert).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateBreakRule(id: string, input: BreakRuleInput): Promise<void> {
  const update: TablesUpdate<"break_rule"> = {
    min_hours: input.minHours,
    max_hours: input.maxHours,
    break_minutes: input.breakMinutes,
  };
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("break_rule").update(update).eq("id", id);
  if (error) throw error;
}

export async function deleteBreakRule(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("break_rule").delete().eq("id", id);
  if (error) throw error;
}
