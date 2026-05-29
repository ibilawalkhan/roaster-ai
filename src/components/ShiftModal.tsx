"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar, Button, Input, Label, Modal, Select } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { LOCATIONS, ROLES, type Employee, type Role, type Shift, type LocationName } from "@/lib/types";
import { formatDayLong, formatHours, shiftHours } from "@/lib/utils";

export function ShiftModal({
  open,
  onClose,
  employee,
  date,
  shift,
}: {
  open: boolean;
  onClose: () => void;
  employee: Employee;
  date: string;
  shift?: Shift;
}) {
  const { addShift, updateShift, removeShift } = useStore();

  const [start, setStart] = useState(shift?.startTime ?? "16:00");
  const [end, setEnd] = useState(shift?.endTime ?? "22:30");
  const [role, setRole] = useState<Role>(shift?.role ?? employee.role);
  const [location, setLocation] = useState<LocationName>(
    shift?.location ?? employee.location
  );
  const [breakMinutes, setBreakMinutes] = useState(shift?.breakMinutes ?? 30);
  const [notes, setNotes] = useState(shift?.notes ?? "");

  const preview = shiftHours({ startTime: start, endTime: end, breakMinutes });
  const valid = preview > 0;

  const save = () => {
    if (!valid) return;
    const payload = {
      employeeId: employee.id,
      date,
      startTime: start,
      endTime: end,
      role,
      location,
      breakMinutes,
      notes: notes.trim() || undefined,
    };
    if (shift) updateShift(shift.id, payload);
    else addShift(payload);
    onClose();
  };

  const remove = () => {
    if (shift) removeShift(shift.id);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shift ? "Edit shift" : "Add shift"}
      subtitle={formatDayLong(date)}
      footer={
        <>
          {shift && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              <IconTrash width={16} height={16} /> Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            {shift ? "Save changes" : "Add shift"}
          </Button>
        </>
      }
    >
      <div className="mb-5 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
        <Avatar name={employee.name} accent={employee.accent} size={42} />
        <div>
          <p className="font-medium text-ink">{employee.name}</p>
          <p className="text-[13px] text-ink-soft">
            {employee.employmentType} · {employee.hourlyRate.toFixed(0)}/hr
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="start">Start</Label>
          <Input
            id="start"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="nums"
          />
        </div>
        <div>
          <Label htmlFor="end">End</Label>
          <Input
            id="end"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="nums"
          />
        </div>
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
          <Label htmlFor="loc">Location</Label>
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
        <div>
          <Label htmlFor="brk">Unpaid break</Label>
          <Select
            id="brk"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(Number(e.target.value))}
          >
            <option value={0}>No break</option>
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>60 min</option>
          </Select>
        </div>
        <div>
          <Label>Paid hours</Label>
          <div
            className={`flex h-11 items-center rounded-[11px] border px-3.5 text-sm font-semibold ${
              valid
                ? "border-line bg-surface-2 text-ink"
                : "border-clay/40 bg-clay/5 text-clay"
            }`}
          >
            {valid ? formatHours(preview) : "End must be after start"}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. opening shift, training Layla"
        />
      </div>
    </Modal>
  );
}
