"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Button, Input, Label, Modal, Select } from "@/components/ui";
import {
  EMPLOYMENT_TYPES,
  LOCATIONS,
  ROLES,
  type Employee,
  type EmploymentType,
  type LocationName,
  type Role,
} from "@/lib/types";
import { ACCENT_KEYS, accentOf } from "@/lib/utils";

export function EmployeeModal({
  open,
  onClose,
  employee,
}: {
  open: boolean;
  onClose: () => void;
  employee?: Employee;
}) {
  const { addEmployee, updateEmployee } = useStore();
  const isEdit = !!employee;

  const [name, setName] = useState(employee?.name ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [role, setRole] = useState<Role>(employee?.role ?? "Front of House");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    employee?.employmentType ?? "casual"
  );
  const [hourlyRate, setHourlyRate] = useState(String(employee?.hourlyRate ?? 27));
  const [location, setLocation] = useState<LocationName>(
    employee?.location ?? "Regents Park"
  );
  const [accent, setAccent] = useState(employee?.accent ?? ACCENT_KEYS[0]);

  const rate = parseFloat(hourlyRate);
  const valid = name.trim().length > 1 && rate > 0;

  const save = () => {
    if (!valid) return;
    const payload = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      role,
      employmentType,
      hourlyRate: rate,
      location,
    };
    if (employee) {
      updateEmployee(employee.id, { ...payload, accent });
    } else {
      addEmployee({ ...payload, accent, isActive: true });
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit team member" : "Add team member"}
      subtitle={isEdit ? employee!.name : "They'll appear on the schedule grid"}
      maxWidth={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            {isEdit ? "Save changes" : "Add member"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sara Haddad"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@altazah.com.au"
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="04xx xxx xxx"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="role">Role</Label>
            <Select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="type">Employment</Label>
            <Select
              id="type"
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="rate">Pay rate (AUD/hr)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
                $
              </span>
              <Input
                id="rate"
                type="number"
                min="0"
                step="0.5"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                className="nums pl-7"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="loc">Home location</Label>
            <Select
              id="loc"
              value={location}
              onChange={(e) => setLocation(e.target.value as LocationName)}
            >
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label>Roster colour</Label>
          <div className="flex flex-wrap gap-2">
            {ACCENT_KEYS.map((key) => {
              const a = accentOf(key);
              const selected = accent === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAccent(key)}
                  className={`h-8 w-8 rounded-full transition ${
                    selected ? "ring-2 ring-offset-2 ring-offset-surface" : ""
                  }`}
                  style={{
                    backgroundColor: a.dot,
                    ...(selected ? ({ "--tw-ring-color": a.dot } as React.CSSProperties) : {}),
                  }}
                  aria-label={key}
                />
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
