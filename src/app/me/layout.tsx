"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui";
import { IconCalendar, IconFlame, IconLogout, IconUser } from "@/components/icons";

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  const { session, hydrated, me, business, logout } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!hydrated) return;
    if (session.role !== "employee") router.replace("/");
  }, [hydrated, session.role, router]);

  if (!hydrated || session.role !== "employee") {
    return <div className="min-h-screen bg-paper" />;
  }

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  const tabs = [
    { href: "/me", label: "Shifts", icon: IconCalendar, exact: true },
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

      <main className="flex-1 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md items-stretch justify-around border-t border-line bg-surface/95 backdrop-blur">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                active ? "text-ember" : "text-ink-faint"
              }`}
            >
              <Icon width={22} height={22} />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
