"use client";

// Segment-level error boundary (REQUIREMENTS.md §9: "Graceful failure, no dead
// ends" — every screen has an error state, never a blank or frozen page).
//
// This catches a render/data crash anywhere under the root layout and offers a
// real way out: retry the segment, or go somewhere useful. The root layout and
// its providers survive, so the user keeps their session and navigation.

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { Button, Card } from "@/components/ui";
import { SENTRY_ENABLED } from "@/lib/observability/sentry-options";

export default function SegmentError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    if (SENTRY_ENABLED) Sentry.captureException(error);
    else console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-10">
      <Card className="w-full max-w-md p-7 text-center">
        <h1 className="font-display text-xl font-semibold text-ink">
          Something went wrong
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          That screen didn&rsquo;t load. Nothing you&rsquo;ve saved has been lost — try again,
          and if it keeps happening let us know.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button size="lg" onClick={() => unstable_retry()}>
            Try again
          </Button>
          <Link href="/">
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              Go to the start
            </Button>
          </Link>
        </div>

        {/* The digest is the only handle that ties this screen to the server log. */}
        {error.digest && (
          <p className="mt-5 text-[12px] text-ink-faint">
            Reference: <span className="nums">{error.digest}</span>
          </p>
        )}
      </Card>
    </div>
  );
}
