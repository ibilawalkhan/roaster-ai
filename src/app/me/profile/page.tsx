"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar, Badge, Button, Card, Input, Label } from "@/components/ui";
import { IconMail, IconPhone, IconPin } from "@/components/icons";
import { EMPLOYMENT_LABEL, LEVEL_LABEL } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export default function MyProfile() {
  const { me, roles, locations, updateOwnContact } = useStore();

  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [email, setEmail] = useState(me?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  const roleName = (id: string | null) => roles.find((r) => r.id === id)?.name ?? "—";
  const locationName = (id: string | null) => locations.find((l) => l.id === id)?.name ?? "—";
  const myRoles = me.roleIds.map(roleName).filter((n) => n !== "—");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateOwnContact({ phone, email });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-5">
      <Card className="rise overflow-hidden">
        <div className="flex flex-col items-center px-6 py-7 text-center">
          <Avatar name={me.name} accent={me.colour} size={76} />
          <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink">
            {me.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Badge tone="ember">{roleName(me.primaryRoleId)}</Badge>
            <Badge tone={me.level === "senior" ? "ember" : "herb"}>{LEVEL_LABEL[me.level]}</Badge>
            <span className="text-[13px] text-ink-soft">{EMPLOYMENT_LABEL[me.employmentType]}</span>
          </div>
          {myRoles.length > 1 && (
            <p className="mt-2 text-[12px] text-ink-faint">Also works: {myRoles.filter((r) => r !== roleName(me.primaryRoleId)).join(", ")}</p>
          )}
        </div>

        {/* Pay rate */}
        <div className="mx-6 mb-5 rounded-xl bg-charcoal px-5 py-4 text-paper">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] uppercase tracking-wider text-paper/55">Your pay rate</p>
              <p className="nums font-display text-2xl font-semibold">
                {formatMoney(me.payRate, true)}
                <span className="text-base font-normal text-paper/60"> / hour</span>
              </p>
            </div>
            <span className="grid h-12 w-12 place-items-center rounded-full bg-ember/20 font-display text-lg font-semibold text-ember-glow">
              {formatMoney(me.payRate).replace("$", "$")}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-paper/45">
            Estimate for your information only — your actual pay comes from your employer&rsquo;s payroll.
          </p>
        </div>
      </Card>

      {/* Contact — editable */}
      <Card className="mt-4 p-1">
        {!editing ? (
          <>
            <ContactRow icon={<IconPhone width={18} height={18} />} label="Phone" value={me.phone || "—"} />
            <ContactRow icon={<IconMail width={18} height={18} />} label="Email" value={me.email || "—"} />
            <ContactRow icon={<IconPin width={18} height={18} />} label="Home store" value={locationName(me.homeLocationId)} last />
          </>
        ) : (
          <div className="space-y-4 p-4">
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && <p className="text-[13px] text-clay">{error}</p>}
          </div>
        )}
      </Card>

      <div className="mt-4 flex justify-center">
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit contact details
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setPhone(me.phone); setEmail(me.email); }} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <p className="mt-5 px-2 text-center text-[12px] text-ink-faint">
        Role, level and pay are set by your manager.
      </p>
    </div>
  );
}

function ContactRow({
  icon,
  label,
  value,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${last ? "" : "border-b border-line"}`}>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-ink-soft">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="truncate text-sm font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}
