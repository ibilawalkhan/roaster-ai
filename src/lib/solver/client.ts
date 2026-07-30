// HTTP client for the Python/OR-Tools scheduler service (M5 §3).
//
// The service is stateless: POST /solve, JSON in, JSON out, contract frozen in
// docs/SOLVER_CONTRACT.md. This module owns exactly two responsibilities —
// making that call, and turning every possible failure into ONE typed error the
// UI can render.
//
// Graceful degradation is a product requirement, not politeness (M5 §10): if the
// solver is down, slow, misconfigured or talking nonsense, the manager keeps the
// seeded roster and is told they can try again or build it by hand. The product
// is fully usable without the solver, so nothing here may throw an untyped error
// or hang the UI.

import { z } from "zod";
import type { SolveRequest } from "../domain/solver-request";

// ---------------------------------------------------------------------------
// Response contract (docs/SOLVER_CONTRACT.md § Response)
// ---------------------------------------------------------------------------

/** Closed vocabulary of blocking reasons (contract § Invariants). */
export const BLOCK_REASONS = [
  "role",
  "availability",
  "overlap",
  "max_hours_week",
  "max_shifts_week",
  "max_consecutive_days",
  "min_rest_hours",
  "one_shift_per_day",
  "location",
  "required_level",
  "excluded",
  "no_eligible_person",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

const blockReasonSchema = z.enum(BLOCK_REASONS);

const assignmentSchema = z.object({
  position_id: z.string(),
  user_id: z.string(),
});

const candidateSchema = z.object({
  user_id: z.string(),
  blocked_by: blockReasonSchema,
});

const unfilledSchema = z.object({
  position_id: z.string(),
  date: z.string(),
  role_id: z.string(),
  start: z.string(),
  end: z.string(),
  reason: blockReasonSchema,
  detail: z.string(),
  closest_candidates: z.array(candidateSchema).default([]),
});

const coverageGapSchema = z.object({
  date: z.string(),
  from: z.string(),
  to: z.string(),
  rule: z.string(),
  detail: z.string(),
});

const statsSchema = z.object({
  positions: z.number(),
  filled: z.number(),
  hours: z.number(),
  estimated_cost: z.number(),
  solve_seconds: z.number(),
  hours_by_person: z.record(z.string(), z.number()).default({}),
});

const diagnosticsSchema = z.object({
  objective_value: z.number().nullish(),
  seed: z.number().nullish(),
  time_limit_hit: z.boolean().nullish(),
});

export const solveResponseSchema = z.object({
  status: z.enum(["ok", "partial", "failed"]),
  assignments: z.array(assignmentSchema).default([]),
  unfilled: z.array(unfilledSchema).default([]),
  coverage_gaps: z.array(coverageGapSchema).default([]),
  // Defaulted so a `failed` body (which carries no roster) still parses and is
  // reported as a solver failure rather than as malformed JSON.
  stats: statsSchema.default({
    positions: 0,
    filled: 0,
    hours: 0,
    estimated_cost: 0,
    solve_seconds: 0,
    hours_by_person: {},
  }),
  diagnostics: diagnosticsSchema.default({}),
});

export type SolveResponse = z.infer<typeof solveResponseSchema>;
export type SolveAssignment = z.infer<typeof assignmentSchema>;
export type SolveUnfilled = z.infer<typeof unfilledSchema>;
export type SolveCoverageGap = z.infer<typeof coverageGapSchema>;
export type SolveStats = z.infer<typeof statsSchema>;

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

export type SolverFailureKind =
  | "not_configured"
  | "timeout"
  | "network"
  | "http"
  | "malformed"
  | "solver_failed"
  | "cancelled";

/** What the manager sees when generation can't happen (M5 §10, contract § App-side degradation). */
export const SOLVER_UNAVAILABLE_MESSAGE =
  "Couldn't generate the roster right now — try again, or build it manually. Nothing you've done has been lost.";

const MESSAGES: Record<SolverFailureKind, string> = {
  not_configured:
    "The roster generator isn't connected yet. Your roster is saved — you can build it manually in the meantime.",
  timeout:
    "The roster generator took too long to answer. Your roster is saved — try again, or build it manually.",
  network: SOLVER_UNAVAILABLE_MESSAGE,
  http: SOLVER_UNAVAILABLE_MESSAGE,
  malformed:
    "The roster generator sent back something we couldn't read. Your roster is saved — try again, or build it manually.",
  solver_failed:
    "The roster generator couldn't process this roster. Your roster is saved — try again, or build it manually.",
  cancelled: "Roster generation was cancelled. Your roster is saved.",
};

/**
 * The one error `requestSolve` throws. Every caller can render `.message`
 * verbatim; `.kind` is for logging and for deciding whether a retry is sensible.
 */
export class SolverUnavailableError extends Error {
  readonly kind: SolverFailureKind;
  readonly status?: number;

  constructor(kind: SolverFailureKind, options: { status?: number; cause?: unknown } = {}) {
    super(MESSAGES[kind], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SolverUnavailableError";
    this.kind = kind;
    this.status = options.status;
  }
}

/** True when trying again might reasonably work. */
export function isRetryable(error: SolverUnavailableError): boolean {
  return error.kind !== "not_configured" && error.kind !== "cancelled";
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** Hard ceiling on waiting (M5 §8: solve limit is 30s; allow for transport). */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestSolveOptions {
  /** Caller's cancellation (e.g. the manager navigated away). */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Overrides the proxy endpoint — used by tests. */
  url?: string;
  /** Caller's access token; sent as a Bearer so the proxy can authorise. */
  accessToken?: string | null;
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : "";
}

/**
 * POST the request to the solver and return the parsed response.
 *
 * Throws only `SolverUnavailableError`. A `failed` status is thrown too: the
 * contract reserves it for malformed input / internal error, so there is no
 * roster to show and the handling is identical to the service being down.
 */
export async function requestSolve(
  request: SolveRequest,
  options: RequestSolveOptions = {},
): Promise<SolveResponse> {
  // Always our OWN origin, never the solver directly: the solver's address and
  // credential are server-only so it can't be hammered by anyone who opens
  // devtools. The proxy (src/app/api/solve/route.ts) authenticates the caller,
  // checks they're a manager, and forwards with the shared secret. A 503 from
  // it means the solver isn't configured — the same graceful path as it being
  // switched off entirely (M5 §10).
  const endpoint = options.url ?? "/api/solve";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 503 is "no solver configured" — a normal state, not a fault.
      if (response.status === 503) throw new SolverUnavailableError("not_configured");
      throw new SolverUnavailableError("http", { status: response.status });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (e) {
      throw new SolverUnavailableError("malformed", { cause: e });
    }

    const parsed = solveResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new SolverUnavailableError("malformed", { cause: parsed.error });
    }
    if (parsed.data.status === "failed") {
      throw new SolverUnavailableError("solver_failed", { cause: parsed.data });
    }
    return parsed.data;
  } catch (e) {
    if (e instanceof SolverUnavailableError) throw e;
    if (errorName(e) === "AbortError" || errorName(e) === "TimeoutError") {
      throw new SolverUnavailableError(timedOut ? "timeout" : "cancelled", { cause: e });
    }
    throw new SolverUnavailableError("network", { cause: e });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
