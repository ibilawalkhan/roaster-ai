// Reading and writing per-business notification settings (M9 §4/§5).
//
// The policy module has always accepted these as parameters with documented
// defaults; this is where the configured values come from. Manager-only by RLS
// (migration 0014).

import { getSupabaseClient } from "./client";
import type { Tables, TablesUpdate } from "./database.types";
import type { BusinessSmsBudget, NotifySettings } from "@/lib/notify/policy";

export type NotificationSettingRow = Tables<"notification_setting">;

const hhmm = (t: string): string => t.slice(0, 5);

/** Adapt a row into the shape the policy expects. */
export function toNotifySettings(row: NotificationSettingRow): NotifySettings {
  return {
    quietHours: {
      startTime: hhmm(row.quiet_hours_start),
      endTime: hhmm(row.quiet_hours_end),
    },
    dailySmsCap: row.daily_sms_cap,
    smsEnabled: row.sms_enabled,
    // Not business-configurable: these protect against double-clicks and
    // duplicate messages rather than expressing a preference.
    dedupeWindowSeconds: 60,
    claimBatchWindowMinutes: 10,
  };
}

export async function fetchNotificationSettings(): Promise<NotificationSettingRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notification_setting")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateNotificationSettings(
  businessId: string,
  patch: TablesUpdate<"notification_setting">,
): Promise<NotificationSettingRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notification_setting")
    .update(patch)
    .eq("business_id", businessId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * This month's SMS usage against the configured cap (M9 §5).
 *
 * Counted from the notification table by the database rather than kept as a
 * running total — a counter that drifts from reality is worse than none.
 */
export async function fetchSmsBudget(
  businessId: string,
  limit: number | null,
): Promise<BusinessSmsBudget> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("sms_used_this_month", {
    p_business_id: businessId,
  });
  if (error) throw error;
  return { used: typeof data === "number" ? data : 0, limit };
}

/** 0–1, or null when uncapped. Drives the 80% warning in the UI (M9 §5). */
export function budgetFraction(budget: BusinessSmsBudget): number | null {
  if (budget.limit === null || budget.limit === 0) return null;
  return budget.used / budget.limit;
}
