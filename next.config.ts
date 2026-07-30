import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Sentry's build-time wrapper (source-map upload + tunnelling).
//
// Everything here is inert without credentials: with no SENTRY_AUTH_TOKEN the
// upload step is skipped and the build succeeds normally, so local builds and
// CI need no Sentry account. `silent` keeps the noise out of local output.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: !process.env.CI,

  // Upload source maps so a production stack trace names real files and lines,
  // then delete them so we don't publish our source to the browser.
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Route Sentry's own requests through this app's origin, so ad-blockers and
  // restaurant wifi filters don't quietly swallow every error report.
  tunnelRoute: "/monitoring",
});
