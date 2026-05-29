"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/ui";
import {
  IconArrowRight,
  IconCalendar,
  IconFlame,
  IconUser,
} from "@/components/icons";
import { activeEmployees } from "@/lib/selectors";

export default function Landing() {
  const router = useRouter();
  const { login, hydrated, data } = useStore();

  const goAdmin = () => {
    login("admin");
    router.push("/admin");
  };
  const goEmployee = () => {
    const first = activeEmployees(data)[0]?.id ?? null;
    login("employee", first);
    router.push("/me");
  };

  if (!hydrated) return <Splash />;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-charcoal px-8 py-10 text-paper sm:px-14 sm:py-14">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #d75321, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #e0a020, transparent 70%)" }}
        />

        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-ember text-white shadow-[0_4px_16px_rgba(215,83,33,0.5)]">
            <IconFlame width={22} height={22} />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">
            Al Tazah
          </span>
        </div>

        <div className="relative max-w-lg py-12">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-medium uppercase tracking-wider text-paper/70">
            <span className="h-1.5 w-1.5 rounded-full bg-ember-glow" /> Charcoal Chicken · Regents Park
          </p>
          <h1 className="font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
            The roster,
            <br />
            <span className="text-ember-glow italic">off the spreadsheet.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-paper/70">
            Build two-week schedules, track everyone&rsquo;s pay, and let the team
            check their shifts from their phone — no more screenshots on WhatsApp.
          </p>
        </div>

        <div className="relative flex items-center gap-6 text-sm text-paper/55">
          <Stat n={data.employees.length} label="team members" />
          <span className="h-8 w-px bg-white/10" />
          <Stat n={data.shifts.length} label="shifts rostered" />
          <span className="h-8 w-px bg-white/10" />
          <Stat n={2} label="locations" />
        </div>
      </section>

      {/* Role select */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-14">
        <div className="mx-auto w-full max-w-md">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Who&rsquo;s signing in?
          </h2>
          <p className="mt-1 text-ink-soft">Choose how you want to use the roster.</p>

          <div className="mt-8 space-y-4">
            <RoleCard
              onClick={goAdmin}
              accent="ember"
              icon={<IconCalendar width={24} height={24} />}
              title="Manager"
              desc="Build schedules, set pay rates, track labour cost."
              delay={0}
            />
            <RoleCard
              onClick={goEmployee}
              accent="herb"
              icon={<IconUser width={24} height={24} />}
              title="Team member"
              desc="See your upcoming shifts, hours and pay."
              delay={80}
            />
          </div>

          <div className="mt-8 rounded-card border border-line bg-surface-2 p-4">
            <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
              On the team today
            </p>
            <div className="flex -space-x-2">
              {activeEmployees(data)
                .slice(0, 7)
                .map((e) => (
                  <div key={e.id} className="ring-2 ring-surface-2 rounded-full">
                    <Avatar name={e.name} accent={e.accent} size={32} />
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <span className="nums font-display text-2xl font-semibold text-paper">{n}</span>
      <span className="ml-1.5 text-sm">{label}</span>
    </div>
  );
}

function RoleCard({
  onClick,
  icon,
  title,
  desc,
  accent,
  delay,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  accent: "ember" | "herb";
  delay: number;
}) {
  const tone =
    accent === "ember"
      ? "group-hover:border-ember bg-ember-soft text-ember-deep"
      : "group-hover:border-herb bg-herb-soft text-herb";
  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className="rise group flex w-full items-center gap-4 rounded-card border border-line bg-surface p-5 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-pop"
    >
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-transparent transition ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-lg font-semibold text-ink">{title}</span>
        <span className="block text-sm text-ink-soft">{desc}</span>
      </span>
      <span className="text-ink-faint transition group-hover:translate-x-1 group-hover:text-ink">
        <IconArrowRight />
      </span>
    </button>
  );
}

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-charcoal text-paper">
      <div className="flex items-center gap-3 opacity-80">
        <span className="grid h-10 w-10 animate-pulse place-items-center rounded-xl bg-ember text-white">
          <IconFlame width={22} height={22} />
        </span>
        <span className="font-display text-lg">Al Tazah</span>
      </div>
    </div>
  );
}
