// Data access for Module 3 (Availability). Thin typed queries; the resolution
// logic lives in src/lib/domain/availability.ts (the single shared function).

import { getSupabaseClient } from "./client";
import type { Tables } from "./database.types";

export type PatternRow = Tables<"availability_pattern">;
export type ExceptionRow = Tables<"availability_exception">;
export type TradingHoursRow = Tables<"trading_hours">;

export async function fetchPatterns(userId: string): Promise<PatternRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("availability_pattern")
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

/** Upcoming (today onward) exceptions for a user, soonest first. */
export async function fetchExceptions(userId: string, fromISO: string): Promise<ExceptionRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("availability_exception")
    .select("*")
    .eq("user_id", userId)
    .gte("date", fromISO)
    .order("date");
  if (error) throw error;
  return data ?? [];
}

/** All patterns in the business (managers only, by RLS) for the team grid. */
export async function fetchBusinessPatterns(): Promise<PatternRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("availability_pattern").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function fetchTradingHours(): Promise<TradingHoursRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("trading_hours").select("*");
  if (error) throw error;
  return data ?? [];
}

export interface UpsertPatternInput {
  businessId: string;
  userId: string;
  dayOfWeek: number;
  isAvailable: boolean;
  from: string | null;
  to: string | null;
  updatedBy: string;
}

export async function upsertPattern(input: UpsertPatternInput): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("availability_pattern").upsert(
    {
      business_id: input.businessId,
      user_id: input.userId,
      day_of_week: input.dayOfWeek,
      is_available: input.isAvailable,
      from_time: input.from,
      to_time: input.to,
      updated_by_user_id: input.updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,day_of_week" },
  );
  if (error) throw error;
}

export interface UpsertExceptionInput {
  businessId: string;
  userId: string;
  date: string;
  isAvailable: boolean;
  from: string | null;
  to: string | null;
  reason: string | null;
  source: "staff" | "manager";
  createdBy: string;
}

export async function upsertException(input: UpsertExceptionInput): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("availability_exception").upsert(
    {
      business_id: input.businessId,
      user_id: input.userId,
      date: input.date,
      is_available: input.isAvailable,
      from_time: input.from,
      to_time: input.to,
      reason: input.reason,
      source: input.source,
      created_by_user_id: input.createdBy,
    },
    { onConflict: "user_id,date" },
  );
  if (error) throw error;
}

export async function deleteException(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("availability_exception").delete().eq("id", id);
  if (error) throw error;
}
