// Module 9 §3 — the TRUSTED server side of the transactional outbox.
//
// Why this exists. Migration 0008 gives `notification` no client INSERT policy,
// on purpose: if a browser could insert, any staff member could fabricate "your
// shift was cancelled" for a colleague. Rows are written by trusted server code
// running as service_role. This route handler IS that trusted code.
//
// Because it holds the service-role key, it bypasses RLS — so it re-imposes the
// boundary itself, in this order, and refuses rather than trims when anything
// looks wrong:
//
//   1. the caller's JWT is verified against Supabase Auth (never trusted from
//      the body — the body says nothing about who is calling);
//   2. the caller is resolved to an `app_user` row; a deactivated or unlinked
//      user is refused;
//   3. TENANT ISOLATION (CLAUDE.md rule 1): every draft's `business_id` must
//      equal the CALLER'S business_id, taken from the database, never from the
//      request;
//   4. every recipient is re-read from `app_user` and must belong to that same
//      business. Unknown or foreign ids are dropped, and if that leaves nothing
//      the request is a no-op rather than a partial success;
//   5. the event code must be in the M9 §2 catalogue, and events whose SOURCE is
//      necessarily a manager (publish, open-to-team, approve) are refused for a
//      non-manager caller.
//
// WHAT THIS IS NOT. It is not the same transaction as the triggering action. The
// atomic version of M9 §3 belongs inside the SECURITY DEFINER RPCs
// (supabase/migrations, owned by the database engineer): `approve_claim` writing
// its own outbox rows is the end state, and this endpoint then becomes the path
// only for events that have no RPC. The failure mode of the current split is a
// LOST NOTIFICATION, never a lost or falsified action — and `roster_change_log
// .notified` plus `shift_swap_event` remain the durable seams a sweeper can
// replay from.

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicEnv, serverEnv } from "@/lib/env";
import type { Database, TablesInsert } from "@/lib/supabase/database.types";
import { EVENT_CODES, MANAGER_ONLY_SOURCE, type EventCode } from "@/lib/notify/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One request cannot enqueue more than a published fortnight's worth of rows. */
const MAX_DRAFTS = 400;

const draftSchema = z.object({
  businessId: z.string().uuid(),
  /** Null when `recipientRule` asks the server to resolve the audience. */
  userId: z.string().uuid().nullable(),
  recipientRule: z.literal("manager").nullable(),
  eventType: z.enum(EVENT_CODES),
  channel: z.enum(["inapp", "sms"]),
  status: z.enum(["pending", "suppressed"]),
  suppressedReason: z.string().max(64).nullable(),
  scheduledFor: z.string().datetime({ offset: true }).nullable(),
  payload: z.record(z.unknown()),
});

const bodySchema = z.object({
  drafts: z.array(draftSchema).min(1).max(MAX_DRAFTS),
});

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(request: Request): Promise<Response> {
  // ---- (1) who is calling? ----
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return json({ error: "Not signed in." }, 401);

  let env: ReturnType<typeof publicEnv>;
  let secret: ReturnType<typeof serverEnv>;
  try {
    env = publicEnv();
    secret = serverEnv();
  } catch {
    // Misconfiguration must not leak which variable is missing.
    return json({ error: "Notifications are not configured." }, 503);
  }

  // The anon client verifies the JWT; it grants nothing RLS would not.
  const anon = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await anon.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Not signed in." }, 401);

  // The service client bypasses RLS — everything below re-imposes the boundary.
  const service = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, secret.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- (2) resolve the caller ----
  const { data: caller, error: callerError } = await service
    .from("app_user")
    .select("id, business_id, is_manager, active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (callerError) return json({ error: "Couldn't verify your account." }, 500);
  if (!caller || !caller.active) return json({ error: "Your account can't send notifications." }, 403);

  // ---- parse ----
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Malformed notification batch." }, 400);
  const drafts = parsed.data.drafts;

  // ---- (3) tenant isolation: the caller's business, from the database ----
  if (drafts.some((d) => d.businessId !== caller.business_id)) {
    return json({ error: "Notifications must stay inside your own business." }, 403);
  }

  // ---- (5) catalogue + manager-source gate ----
  const offending = drafts.find(
    (d) => MANAGER_ONLY_SOURCE.has(d.eventType as EventCode) && !caller.is_manager,
  );
  if (offending) {
    return json({ error: `Only a manager can raise ${offending.eventType}.` }, 403);
  }

  // ---- (4a) the ONE server-side expansion: "the managers of my business" ----
  //
  // Staff cannot read the team list (migration 0002 — a non-manager selects only
  // their own row), so a staff member triggering E6 "I can't make this shift" or
  // E9 "I can cover this" has no way to address the manager. Resolving it here
  // keeps the manager's identity out of the browser entirely, and can only ever
  // resolve to managers of the CALLER'S business.
  const needsManagers = drafts.some((d) => d.recipientRule === "manager");
  let managerIds: string[] = [];
  if (needsManagers) {
    const { data: managers, error: managerError } = await service
      .from("app_user")
      .select("id")
      .eq("business_id", caller.business_id)
      .eq("is_manager", true)
      .eq("active", true);
    if (managerError) return json({ error: "Couldn't find who to notify." }, 500);
    managerIds = (managers ?? []).map((m) => m.id);
  }

  // ---- (4b) explicit recipients must be real members of that same business ----
  const recipientIds = [
    ...new Set(drafts.flatMap((d) => (d.userId ? [d.userId] : []))),
  ];
  let known = new Set<string>();
  if (recipientIds.length > 0) {
    const { data: members, error: memberError } = await service
      .from("app_user")
      .select("id")
      .eq("business_id", caller.business_id)
      .in("id", recipientIds);
    if (memberError) return json({ error: "Couldn't check the recipients." }, 500);
    known = new Set((members ?? []).map((m) => m.id));
  }

  const rows: TablesInsert<"notification">[] = drafts.flatMap((d) => {
    // M9 §8: the same person may be both manager and rostered staff. They get the
    // manager-role notification and nothing else, so a fan-out never duplicates.
    const userIds =
      d.recipientRule === "manager" ? managerIds : d.userId && known.has(d.userId) ? [d.userId] : [];
    return userIds.map((userId) => ({
      business_id: caller.business_id,
      user_id: userId,
      event_type: d.eventType,
      channel: d.channel,
      status: d.status,
      suppressed_reason: d.suppressedReason,
      scheduled_for: d.scheduledFor,
      // Cast to the column's Json type: the payload is a validated plain object,
      // and Zod has already refused anything that is not.
      payload_json: d.payload as TablesInsert<"notification">["payload_json"],
    }));
  });

  if (rows.length === 0) return json({ enqueued: 0 }, 200);

  const { error: insertError } = await service.from("notification").insert(rows);
  if (insertError) {
    // The caller's ACTION already succeeded; only the message failed. Report it
    // honestly so `notify()` can log it, and let the caller carry on regardless.
    return json({ error: "Couldn't queue those notifications." }, 500);
  }
  return json({ enqueued: rows.length }, 200);
}
