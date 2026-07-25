"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { Button, Card, StatCard } from "@/components/ui";
import { IconArrowRight, IconCalendar, IconUsers, IconChart } from "@/components/icons";

export default function AdminDashboard() {
  const { business, team } = useStore();
  const active = team.filter((m) => m.active);
  const seniors = active.filter((m) => m.level === "senior").length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ember">{business?.name ?? "Rosterly"}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">
            {greeting}
          </h1>
        </div>
        <Link href="/admin/employees">
          <Button>
            Manage team <IconArrowRight width={16} height={16} />
          </Button>
        </Link>
      </header>

      <div className="rise mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3" style={{ animationDelay: "60ms" }}>
        <StatCard label="Active team" value={active.length} sub={`${seniors} senior${seniors === 1 ? "" : "s"}`} accent="ember" icon={<IconUsers width={18} height={18} />} />
        <StatCard label="Locations" value={0} sub="set up in Settings" accent="herb" icon={<IconCalendar width={18} height={18} />} />
        <StatCard label="Roster" value="—" sub="coming next module" accent="saffron" icon={<IconChart width={18} height={18} />} />
      </div>

      <Card className="rise mt-6 p-6" >
        <h2 className="font-display text-lg font-semibold text-ink">You&rsquo;re in the rebuild</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          The Team module is live — add staff, set their roles, levels and pay. The week template,
          auto-scheduler, roster review and labour-cost reporting arrive in the next modules and will
          appear here as they land.
        </p>
        <div className="mt-4 flex gap-2">
          <Link href="/admin/employees">
            <Button variant="outline" size="sm">
              <IconUsers width={15} height={15} /> Go to Team
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
