"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui";
import { SuspendedBanner } from "@/components/SuspendedNotice";
import {
  IconArrowRight,
  IconBell,
  IconCalendar,
  IconClock,
  IconFlame,
  IconLogout,
  IconUser,
} from "@/components/icons";
import { fetchUnreadCount, subscribeToMyNotifications } from "@/lib/supabase/notifications";

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  const { session, hydrated, me, business, logout } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!hydrated) return;
    if (session.role !== "employee") router.replace("/");
  }, [hydrated, session.role, router]);

  // ---- M9: the unread badge on the bell ----
  //
  // Best-effort by design (CLAUDE.md rule 7): a failed count leaves the badge
  // hidden and the nav working. It must never take the whole staff app down.
  const [unread, setUnread] = useState(0);
  const userId = session.appUserId;

  const refreshUnread = useCallback(async () => {
    try {
      setUnread(await fetchUnreadCount());
    } catch {
      setUnread(0);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    // setState only ever runs after an await — no render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshUnread();
  }, [userId, refreshUnread, pathname]);

  // Live: a new row for THIS user (scoped, never a global firehose) bumps the badge.
  useEffect(() => {
    if (!userId) return;
    return subscribeToMyNotifications(userId, () => {
      void refreshUnread();
    });
  }, [userId, refreshUnread]);

  if (!hydrated || session.role !== "employee") {
    return <div className="min-h-screen bg-paper" />;
  }

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  const tabs = [
    { href: "/me", label: "Shifts", icon: IconCalendar, exact: true },
    // M8 §3.3 — shifts the manager has opened to the team.
    { href: "/me/open-shifts", label: "Cover", icon: IconArrowRight, exact: false },
    { href: "/me/availability", label: "Availability", icon: IconClock, exact: false },
    // M9 §3 / M7 §3.5 — the in-app notifications list.
    { href: "/me/notifications", label: "Alerts", icon: IconBell, exact: false, badge: unread },
    { href: "/me/profile", label: "Profile", icon: IconUser },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col border-x border-line bg-paper">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-charcoal px-4 py-3 text-paper">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-ember text-white">
            <IconFlame width={18} height={18} />
          </span>
          <span className="font-display font-semibold">{business?.name ?? "Rosterly"}</span>
        </div>
        <button onClick={handleLogout} className="text-paper/60" aria-label="Sign out">
          <IconLogout width={20} height={20} />
        </button>
      </header>

      {me && (
        <div className="flex items-center gap-3 bg-charcoal px-4 pb-4 text-paper">
          <Avatar name={me.name} accent={me.colour} size={44} />
          <div>
            <p className="text-[13px] text-paper/55">Signed in as</p>
            <p className="font-display text-lg font-semibold leading-tight">{me.name}</p>
          </div>
        </div>
      )}

      {/* Staff keep READ access while an account is suspended — nobody should
          lose sight of tomorrow's shift over the owner's invoice. A quiet
          banner, not a wall, and it doesn't hand them the billing problem. */}
      {business?.subscriptionStatus === "suspended" && <SuspendedBanner />}

      <main className="flex-1 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md items-stretch justify-around border-t border-line bg-surface/95 backdrop-blur">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          const Icon = t.icon;
          const badge = t.badge ?? 0;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-label={badge > 0 ? `${t.label}, ${badge} unread` : t.label}
              className={`flex min-h-[56px] flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                active ? "text-ember" : "text-ink-faint"
              }`}
            >
              <span className="relative">
                <Icon width={22} height={22} />
                {badge > 0 && (
                  <span
                    aria-hidden="true"
                    className="nums absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ember px-1 text-[10px] font-bold leading-none text-white"
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
