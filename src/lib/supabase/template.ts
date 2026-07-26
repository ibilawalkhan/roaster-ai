// Data access for Module 4 (Week Template). Thin typed queries; the feasibility
// and cost logic live in src/lib/domain/{template-feasibility,cost}.ts. RLS
// (migration 0005) makes every one of these manager-only and business-scoped.
//
// Trading hours are read via fetchTradingHours from ./availability (not
// duplicated here). A business has exactly one default template in MVP
// (M4 §4.5); ensureTemplate creates it on first use.

import { getSupabaseClient } from "./client";
import type { Tables, TablesInsert } from "./database.types";
import type { Level } from "../types";

export type WeekTemplateRow = Tables<"week_template">;
export type TemplateSlotRow = Tables<"template_slot">;
export type SchedulingRuleRow = Tables<"scheduling_rule">;

/** The business's default template, or null if none exists yet. */
export async function fetchDefaultTemplate(): Promise<WeekTemplateRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("week_template")
    .select("*")
    .eq("is_default", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Return the default template, creating the single MVP default if none exists. */
export async function ensureTemplate(businessId: string): Promise<WeekTemplateRow> {
  const existing = await fetchDefaultTemplate();
  if (existing) return existing;
  const supabase = getSupabaseClient();
  const insert: TablesInsert<"week_template"> = {
    business_id: businessId,
    name: "Normal week",
    is_default: true,
    active: true,
  };
  const { data, error } = await supabase
    .from("week_template")
    .insert(insert)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** All active slots for a template (both locations; the page filters). */
export async function fetchSlots(templateId: string): Promise<TemplateSlotRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("template_slot")
    .select("*")
    .eq("template_id", templateId)
    .eq("active", true)
    .order("day_of_week")
    .order("start_time");
  if (error) throw error;
  return data ?? [];
}

export async function fetchSchedulingRule(): Promise<SchedulingRuleRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("scheduling_rule")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export interface SlotInput {
  id?: string; // present ⇒ update
  businessId: string;
  templateId: string;
  locationId: string;
  dayOfWeek: number;
  roleId: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  count: number;
  requiredLevel: Level | null;
  label: string | null;
}

const crossesMidnight = (start: string, end: string): boolean =>
  end.slice(0, 5) <= start.slice(0, 5);

/** Insert or update a slot. `crosses_midnight` is derived here (M4 §6). */
export async function upsertSlot(input: SlotInput): Promise<TemplateSlotRow> {
  const supabase = getSupabaseClient();
  const row = {
    business_id: input.businessId,
    template_id: input.templateId,
    location_id: input.locationId,
    day_of_week: input.dayOfWeek,
    role_id: input.roleId,
    start_time: input.start,
    end_time: input.end,
    crosses_midnight: crossesMidnight(input.start, input.end),
    count: input.count,
    required_level: input.requiredLevel,
    label: input.label,
    active: true,
  };
  if (input.id) {
    const { data, error } = await supabase
      .from("template_slot")
      .update(row)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("template_slot")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSlot(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("template_slot").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Copy one day's slots onto other days for a location (M4 §4.3). Target days are
 * cleared first so the copy replaces, not appends. No cross-tenant risk — RLS
 * scopes every statement to the caller's business.
 */
export async function copyDay(
  templateId: string,
  businessId: string,
  locationId: string,
  fromDow: number,
  toDows: number[],
): Promise<void> {
  const supabase = getSupabaseClient();
  const slots = await fetchSlots(templateId);
  const source = slots.filter((s) => s.day_of_week === fromDow && s.location_id === locationId);
  const targets = toDows.filter((d) => d !== fromDow);
  if (targets.length === 0) return;

  // Clear existing slots on the target days for this location.
  const { error: delErr } = await supabase
    .from("template_slot")
    .delete()
    .eq("template_id", templateId)
    .eq("location_id", locationId)
    .in("day_of_week", targets);
  if (delErr) throw delErr;

  if (source.length === 0) return; // copying an empty day just clears the targets

  const rows: TablesInsert<"template_slot">[] = [];
  for (const dow of targets) {
    for (const s of source) {
      rows.push({
        business_id: businessId,
        template_id: templateId,
        location_id: s.location_id,
        day_of_week: dow,
        role_id: s.role_id,
        start_time: s.start_time,
        end_time: s.end_time,
        crosses_midnight: s.crosses_midnight,
        count: s.count,
        required_level: s.required_level,
        label: s.label,
        active: true,
      });
    }
  }
  const { error: insErr } = await supabase.from("template_slot").insert(rows);
  if (insErr) throw insErr;
}
