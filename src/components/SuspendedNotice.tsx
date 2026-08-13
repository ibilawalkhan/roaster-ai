"use client";

// The account-status screen for a suspended business (REQUIREMENTS §1.1, M11 §9).
//
// The database refuses writes for a suspended account (migration 0013). Without
// this, a manager would just meet an unexplained error on every save — so the
// UI has to say plainly what has happened and how to fix it.
//
// Tone matters here: this person is a customer with an admin problem, not a
// wrongdoer. No alarm colours, no blame, and an explicit reassurance that their
// roster is safe — because their first fear will be that they have lost it.

import { Button, Card } from "@/components/ui";
import { IconFlame } from "@/components/icons";

export function SuspendedNotice({ businessName }: { businessName?: string | null }) {
  return (
    <div className="grid min-h-screen place-items-center bg-paper px-4 py-10">
      <Card className="w-full max-w-md p-7 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-ember text-white">
          <IconFlame width={24} height={24} />
        </span>

        <h1 className="mt-4 font-display text-xl font-semibold text-ink">
          Your account is on hold
        </h1>

        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
          {businessName ? `${businessName}'s ` : "Your "}
          Rosterly account has been paused, so changes can&rsquo;t be saved at the moment.
        </p>

        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
          <span className="font-medium text-ink">Nothing has been lost.</span> Your roster,
          your team and your history are all exactly as you left them, and everything
          comes straight back when the account is reactivated.
        </p>

        <div className="mt-6">
          <a href="mailto:hello@rosterly.com.au?subject=Account%20reactivation">
            <Button size="lg" className="w-full justify-center">
              Get in touch to reactivate
            </Button>
          </a>
        </div>

        <p className="mt-5 text-[12px] text-ink-faint">
          Already sorted it out? Refresh this page.
        </p>
      </Card>
    </div>
  );
}

/**
 * The staff-facing version — a quiet banner, not a wall.
 *
 * Staff keep read access on purpose: a kitchen hand must not lose sight of
 * tomorrow's shift because the owner's invoice is late. They also shouldn't be
 * handed the owner's billing problem, so this says only what affects them.
 */
export function SuspendedBanner() {
  return (
    <div className="border-b border-saffron/40 bg-saffron-soft px-4 py-2.5">
      <p className="text-[13px] leading-snug text-[#8a6212]">
        Your shifts are shown as last published. Changes are paused while your manager
        sorts out the account.
      </p>
    </div>
  );
}
