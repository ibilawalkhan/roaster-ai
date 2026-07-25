"use client";

import { useStore } from "@/lib/store";
import { AvailabilityEditor } from "@/components/AvailabilityEditor";

export default function MyAvailability() {
  const { session } = useStore();

  if (!session.appUserId || !session.businessId) return null;

  return (
    <div className="px-4 py-5">
      <h1 className="mb-1 font-display text-xl font-semibold text-ink">My availability</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Keep this up to date so you&rsquo;re only rostered when you can work.
      </p>
      <AvailabilityEditor
        userId={session.appUserId}
        businessId={session.businessId}
        editorId={session.appUserId}
      />
    </div>
  );
}
