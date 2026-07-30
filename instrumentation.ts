// Server + edge runtime instrumentation (Next.js `instrumentation.ts`).
//
// Initialises Sentry for the Node and Edge runtimes and forwards server-side
// request errors via `onRequestError`. With no DSN configured every call here
// is a no-op, so local development and CI are unaffected.

import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, SENTRY_ENABLED, scrub } from "@/lib/observability/sentry-options";

export async function register(): Promise<void> {
  if (!SENTRY_ENABLED) return;

  // The runtime is chosen per-request by Next; both need their own init.
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      ...baseSentryOptions,
      beforeSend(event) {
        return scrub(event);
      },
    });
  }
}

/**
 * Server-side request errors (Next.js `onRequestError`).
 *
 * Awaited, per the Next docs, so the report is actually flushed before the
 * serverless invocation is frozen.
 */
export const onRequestError: typeof Sentry.captureRequestError = SENTRY_ENABLED
  ? Sentry.captureRequestError
  : async () => {};
