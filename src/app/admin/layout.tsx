"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import {
  IconCalendar,
  IconChart,
  IconClock,
  IconFlame,
  IconHome,
  IconLogout,
  IconUsers,
} from "@/components/icons";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: IconHome, exact: true },
  { href: "/admin/schedule", label: "Schedule", icon: IconCalendar },
  { href: "/admin/employees", label: "Team", icon: IconUsers },
  { href: "/admin/availability", label: "Availability", icon: IconClock },
  { href: "/admin/costs", label: "Costs", icon: IconChart },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session, hydrated, logout, business } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (hydrated && session.role !== "admin") router.replace("/");
  }, [hydrated, session.role, router]);

  if (!hydrated || session.role !== "admin") {
    return <div className="min-h-screen bg-paper" />;
  }

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-charcoal text-paper lg:flex">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-ember text-white">
            <IconFlame width={20} height={20} />
          </span>
          <div className="leading-tight">
            <p className="font-display text-base font-semibold">{business?.name ?? "Rosterly"}</p>
            <p className="text-[11px] uppercase tracking-wider text-paper/45">
              Manager
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-ember text-white shadow-[0_4px_14px_rgba(215,83,33,0.4)]"
                    : "text-paper/65 hover:bg-white/5 hover:text-paper"
                }`}
              >
                <Icon width={19} height={19} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-5">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-paper/55 transition hover:bg-white/5 hover:text-paper"
          >
            <IconLogout width={19} height={19} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-charcoal px-4 py-3 text-paper lg:hidden">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-ember text-white">
              <IconFlame width={18} height={18} />
            </span>
            <span className="font-display font-semibold">{business?.name ?? "Rosterly"}</span>
          </div>
          <button onClick={handleLogout} className="text-paper/60">
            <IconLogout width={20} height={20} />
          </button>
        </header>

        <main className="flex-1 pb-24 lg:pb-0">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-line bg-surface/95 backdrop-blur lg:hidden">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  active ? "text-ember" : "text-ink-faint"
                }`}
              >
                <Icon width={21} height={21} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
