import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "./client";
import type { Database } from "./database.types";

export type AppUser = Database["public"]["Tables"]["app_user"]["Row"];

/**
 * Phone-OTP auth. Staff log in with their phone; the OTP
 * is sent by Supabase Auth (Twilio behind the scenes on hosted projects).
 *
 * Phone numbers are E.164 digits WITHOUT the leading "+" (e.g. "61400000001"),
 * matching how Supabase stores auth.users.phone and how app_user.phone is
 * seeded — the user↔staff link (link_current_user RPC) matches on exact phone.
 */

/** Normalise a user-entered AU/intl number to E.164 digits, no leading "+". */
export function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  const noPlus = digits.replace(/^\+/, "");
  // Local AU mobile "04xxxxxxxx" → "614xxxxxxxx".
  if (/^0\d{9}$/.test(noPlus)) return `61${noPlus.slice(1)}`;
  return noPlus;
}

export async function requestOtp(phone: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: normalisePhone(phone) });
  if (error) throw error;
}

export async function verifyOtp(phone: string, token: string): Promise<Session> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: normalisePhone(phone),
    token,
    type: "sms",
  });
  if (error) throw error;
  if (!data.session) throw new Error("Verification returned no session.");
  return data.session;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthStateChange(cb: (session: Session | null) => void): () => void {
  const supabase = getSupabaseClient();
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/**
 * The staff record linked to the current auth user, or null if not yet linked.
 * RLS returns only the caller's own row, so this is safe for staff and managers.
 */
export async function getCurrentAppUser(): Promise<AppUser | null> {
  const supabase = getSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from("app_user")
    .select("*")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
