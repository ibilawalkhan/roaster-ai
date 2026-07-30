// Server-side proxy to the scheduler service (M5 §3).
//
// WHY THIS EXISTS: the browser must never hold the solver's address or its
// credential. A CP-SAT solve is expensive, so a public unauthenticated endpoint
// is a cost-amplification attack waiting to happen — anyone could read the URL
// out of devtools and hammer it. Routing through here means:
//
//   · SOLVER_URL and SOLVER_SHARED_SECRET stay server-only (no NEXT_PUBLIC_)
//   · the caller must present a valid session, and be a MANAGER of some business
//   · the solver itself can refuse anything without the shared secret
//
// The app degrades gracefully if this route or the solver is unavailable — the
// seeded roster is untouched and can be filled in by hand (M5 §10).

import { createClient } from "@supabase/supabase-js";

/** Hard ceiling; the solver's own limit should be lower (contract: 15s default). */
const UPSTREAM_TIMEOUT_MS = 35_000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const solverUrl = process.env.SOLVER_URL?.trim();
  const sharedSecret = process.env.SOLVER_SHARED_SECRET?.trim();

  if (!solverUrl) {
    // Not configured is a normal state, not an error: the product is usable
    // without the auto-scheduler.
    return json({ error: "solver_not_configured" }, 503);
  }

  // --- authenticate the caller -------------------------------------------
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "not_authenticated" }, 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return json({ error: "server_misconfigured" }, 500);

  // Act AS the caller (anon key + their JWT), so RLS still applies to the
  // is_manager lookup. Deliberately not the service-role key: this route has no
  // reason to hold privileges the user doesn't have.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: "not_authenticated" }, 401);

  // Generating a roster is a manager action (M11 §4.1).
  const { data: isManager, error: roleError } = await supabase.rpc("is_manager");
  if (roleError) return json({ error: "authorisation_failed" }, 403);
  if (isManager !== true) return json({ error: "not_a_manager" }, 403);

  // --- forward to the solver ---------------------------------------------
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "malformed_request" }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${solverUrl.replace(/\/+$/, "")}/solve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(sharedSecret ? { "x-solver-key": sharedSecret } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return json({ error: aborted ? "solver_timeout" : "solver_unreachable" }, 504);
  } finally {
    clearTimeout(timer);
  }
}
