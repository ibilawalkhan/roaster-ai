// Browser instrumentation (Next.js `instrumentation-client.ts`) — runs before
// the app becomes interactive.
//
// This is where a manager's Friday-night white screen becomes a report you can
// actually read on Saturday morning (REQUIREMENTS.md §9). No DSN ⇒ no-op.

import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, SENTRY_ENABLED, scrub } from "@/lib/observability/sentry-options";

if (SENTRY_ENABLED) {
  Sentry.init({
    ...baseSentryOptions,
    // Session Replay is deliberately NOT enabled: this app displays staff
    // phone numbers and pay rates, and recording a manager's screen would ship
    // both to a third party (M11 §7).
    integrations: [],
    beforeSend(event) {
      return scrub(event);
    },
    beforeBreadcrumb(crumb) {
      // Breadcrumbs capture URLs and console output; scrub the data payload
      // and drop console breadcrumbs entirely, which are the likeliest place
      // for a stray record to be logged during development.
      if (crumb.category === "console") return null;
      return crumb.data ? { ...crumb, data: scrub(crumb.data) } : crumb;
    },
  });
}

/** Reports client-side navigation timing to Sentry when enabled. */
export const onRouterTransitionStart = SENTRY_ENABLED
  ? Sentry.captureRouterTransitionStart
  : undefined;
