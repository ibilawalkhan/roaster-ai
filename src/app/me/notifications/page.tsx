"use client";

// M9 §3 / M7 §3.5 — the in-app notifications list.
//
// The `notification` row IS the in-app notification (M9 §3): there is no second
// delivery step, which is why this screen reads the outbox directly and why an
// SMS outage never empties it. Realtime keeps it current while the app is open,
// scoped to this user (never a global firehose — REQUIREMENTS.md §8).
//
// Deliberately minimal (M9 §6): recent events, read/unread, tap to go straight
// to the thing it is about. No settings, no categories, no per-event matrix — a
// settings screen full of toggles is a settings screen nobody uses.
//
// SMS rows are not listed. They are DELIVERY RECORDS for the same event, and
// showing both would double every item; suppressed and failed rows are excluded
// for the same reason. What was and wasn't sent is answerable from the database
// (see supabase/functions/notify-worker/README.md), which is where that question
// actually gets asked.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { IconBell } from "@/components/icons";
import { useStore } from "@/lib/store";
import {
  fetchMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToMyNotifications,
  type MyNotification,
} from "@/lib/supabase/notifications";

type LoadStatus = "loading" | "ready" | "error";

const errorText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

/** "just now" / "2 hours ago" / "Mon 16 Mar" — never a bare timestamp. */
function ago(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(then).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function NotificationsPage() {
  const { session } = useStore();
  const userId = session.appUserId;
  const router = useRouter();

  const [items, setItems] = useState<MyNotification[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await fetchMyNotifications());
      setNow(new Date());
      setStatus("ready");
    } catch (e) {
      setError(errorText(e, "Couldn't load your notifications. Check your signal."));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // setState only ever runs after an await — no render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Live updates while the screen is open (M9 §3). A realtime failure is not
  // fatal: the list already loaded, and "Check again" always works.
  useEffect(() => {
    if (!userId) return;
    return subscribeToMyNotifications(userId, () => {
      void load();
    });
  }, [userId, load]);

  /**
   * Tap to open the thing it is about. The read stamp is best-effort — failing
   * to mark something read must never stop the person getting to their shift, so
   * navigation happens regardless.
   */
  const open = (item: MyNotification) => {
    setItems((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)),
    );
    void markNotificationRead(item.id).catch(() => {
      // Rolled back on the next load; the deep link matters more than the dot.
    });
    if (item.link) router.push(item.link);
  };

  const markAll = async () => {
    setMarkingAll(true);
    setActionError(null);
    const snapshot = items;
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? stamp })));
    try {
      await markAllNotificationsRead();
    } catch (e) {
      // Visible roll-back (CLAUDE.md rule 6) — never a silent optimistic lie.
      setItems(snapshot);
      setActionError(errorText(e, "Couldn't mark those as read. Nothing was changed."));
    } finally {
      setMarkingAll(false);
    }
  };

  const unread = items.filter((n) => n.readAt === null).length;

  // ---- loading ----
  if (status === "loading") {
    return (
      <div className="space-y-3 px-4 py-6" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading your notifications…</span>
        <div className="h-8 w-44 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-20 animate-pulse rounded-card bg-surface-2" />
        <div className="h-20 animate-pulse rounded-card bg-surface-2" />
      </div>
    );
  }

  // ---- error ----
  if (status === "error") {
    return (
      <div className="px-4 py-6">
        <Card className="p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-ink">
            Can&rsquo;t load your notifications
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
            {error ?? "Something went wrong."}
          </p>
          <Button size="lg" className="mt-5 w-full" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Notifications
          </h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            {unread > 0 ? `${unread} unread` : "You're up to date"}
          </p>
        </div>
        {unread > 0 && (
          <button
            onClick={() => void markAll()}
            disabled={markingAll}
            className="min-h-11 shrink-0 px-2 text-[13px] font-semibold text-ember underline disabled:opacity-40"
          >
            {markingAll ? "Marking…" : "Mark all read"}
          </button>
        )}
      </div>

      {actionError && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-[13px] leading-snug text-clay"
        >
          {actionError}
        </p>
      )}

      {/* ---- empty ---- */}
      {items.length === 0 ? (
        <Card className="mt-5 p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ember-soft text-ember-deep">
            <IconBell width={26} height={26} />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-ink">Nothing yet</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
            When your roster comes out, a shift of yours changes, or your manager answers a cover
            request, it shows up here.
          </p>
          <Button size="lg" variant="outline" className="mt-5 w-full" onClick={() => void load()}>
            Check again
          </Button>
        </Card>
      ) : (
        <ul className="mt-5 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <NotificationRow item={item} now={now} onOpen={() => open(item)} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 px-1 text-center text-[12px] leading-snug text-ink-faint">
        Only the last 40 are kept on screen.{" "}
        <Link href="/me" className="font-semibold underline">
          My shifts
        </Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One notification. The whole row is the tap target and is comfortably over
// 44px tall (M7 §1) — a manager reading this mid-service should not have to aim.
// ---------------------------------------------------------------------------

function NotificationRow({
  item,
  now,
  onOpen,
}: {
  item: MyNotification;
  now: Date;
  onOpen: () => void;
}) {
  const unread = item.readAt === null;
  return (
    <button
      onClick={onOpen}
      className={`flex w-full min-h-[64px] items-start gap-3 rounded-card border px-4 py-3 text-left transition ${
        unread
          ? "border-ember/30 bg-ember-soft/40 hover:bg-ember-soft/60"
          : "border-line bg-surface hover:bg-surface-2"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-ember" : "bg-transparent"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-[15px] leading-snug ${
              unread ? "font-semibold text-ink" : "font-medium text-ink-soft"
            }`}
          >
            {item.title}
          </span>
          <span className="shrink-0 text-[11px] text-ink-faint">{ago(item.createdAt, now)}</span>
        </span>
        {item.body && (
          <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{item.body}</span>
        )}
        <span className="sr-only">{unread ? "Unread." : "Read."}</span>
      </span>
    </button>
  );
}
