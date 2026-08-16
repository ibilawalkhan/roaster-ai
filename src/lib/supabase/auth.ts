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

/**
 * Manager email + password sign-in (M11 §3.1).
 *
 * The deliberate, spec'd fallback for owners who prefer email, whose phone
 * changes often, or who are somewhere with no signal. Staff remain phone-OTP
 * only: passwords get lost, reused and shared, and a kitchen team should not be
 * asked to manage one.
 *
 * There is NO sign-up here, by design (M11 §3.2). An email account is attached
 * to an `app_user` the manager already created, so an unknown address gains
 * nothing — which removes an entire class of account-takeover and spam problem.
 */
export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  if (!data.session) throw new Error("Sign-in returned no session.");
  return data.session;
}

/**
 * Send a password-reset link.
 *
 * Deliberately reports success even for an unknown address: saying "no such
 * account" would turn this into a way to discover who your customers are.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo,
  });
  if (error) throw error;
}

/** Set a new password for the signed-in user (used after a reset link). */
export async function updatePassword(password: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
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
