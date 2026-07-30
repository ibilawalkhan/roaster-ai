// Shared Sentry configuration (REQUIREMENTS.md §9 — "you cannot run a real
// product blind"). One place so the client, server and edge runtimes cannot
// drift apart in what they capture or, more importantly, what they redact.
//
// Sentry is OPTIONAL by design: with no DSN set, `enabled` is false and every
// SDK call becomes a no-op. Local development and the test suite therefore run
// untouched, and a missing environment variable can never break the app — the
// failure mode of monitoring must always be "no monitoring", never "no app".

/** The DSN, or undefined when monitoring is not configured for this environment. */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

/** True only when a DSN is present. Guard every optional Sentry call with this. */
export const SENTRY_ENABLED = Boolean(SENTRY_DSN);

/**
 * Keys whose values must never leave the browser or server, even in a crash
 * report. This product holds staff phone numbers and pay rates: a Sentry event
 * that carries a wage into a third-party service is a privacy breach, not a
 * debugging aid (M11 §7, REQUIREMENTS.md §0).
 */
const REDACT_KEYS = [
  "pay_rate",
  "payrate",
  "pay_rate_snapshot",
  "phone",
  "email",
  "estimated_cost",
  "authorization",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "service_role",
  "password",
  "token",
];

const REDACTED = "[redacted]";

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_KEYS.some((needle) => k.includes(needle));
}

/**
 * Recursively strip sensitive values from an arbitrary structure, preserving
 * shape so the report stays useful. Depth-limited and cycle-safe: a crash
 * reporter must never itself throw or hang.
 */
export function scrub<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1, seen)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shouldRedact(k) ? REDACTED : scrub(v, depth + 1, seen);
  }
  return out as T;
}

/** Options shared by every runtime. */
export const baseSentryOptions = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,

  // A single restaurant generates very little traffic, so sample everything —
  // the value of Sentry here is catching the ONE Friday-night failure, not
  // statistics. Revisit if volume ever makes this expensive.
  tracesSampleRate: 1.0,

  // Never attach request bodies, cookies or headers: they carry auth tokens
  // and personal data.
  sendDefaultPii: false,

  ignoreErrors: [
    // Browser/extension noise that tells us nothing about our own code.
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
    /^Network request failed$/,
    // A cancelled fetch is normal when a user navigates away mid-request.
    "AbortError",
  ],
};
