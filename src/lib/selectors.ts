import type { Employee, RosterData, Shift, LocationName } from "./types";
import { addDays, shiftCost, shiftHours, todayISO } from "./utils";

export function employeeById(data: RosterData, id: string | null): Employee | undefined {
  if (!id) return undefined;
  return data.employees.find((e) => e.id === id);
}

export function activeEmployees(data: RosterData): Employee[] {
  return data.employees.filter((e) => e.isActive);
}

/** Inclusive 14-day list of ISO dates from a Monday. */
export function fortnightDays(startMonday: string): string[] {
  return Array.from({ length: 14 }, (_, i) => addDays(startMonday, i));
}

export function weekDays(startMonday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startMonday, i));
}

export function shiftsOn(data: RosterData, date: string, location?: LocationName): Shift[] {
  return data.shifts.filter(
    (s) => s.date === date && (!location || s.location === location)
  );
}

export function shiftFor(
  data: RosterData,
  employeeId: string,
  date: string
): Shift | undefined {
  return data.shifts.find((s) => s.employeeId === employeeId && s.date === date);
}

export function shiftsForEmployee(data: RosterData, employeeId: string): Shift[] {
  return data.shifts
    .filter((s) => s.employeeId === employeeId)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

/** Upcoming shifts (today onward) for an employee. */
export function upcomingShifts(data: RosterData, employeeId: string): Shift[] {
  const today = todayISO();
  return shiftsForEmployee(data, employeeId).filter((s) => s.date >= today);
}

export function hoursInRange(
  data: RosterData,
  employeeId: string,
  startIso: string,
  endIso: string
): number {
  return data.shifts
    .filter(
      (s) => s.employeeId === employeeId && s.date >= startIso && s.date <= endIso
    )
    .reduce((sum, s) => sum + shiftHours(s), 0);
}

export interface DayTotals {
  date: string;
  hours: number;
  cost: number;
  staff: number;
}

export function dayTotals(
  data: RosterData,
  date: string,
  location?: LocationName
): DayTotals {
  const shifts = shiftsOn(data, date, location);
  let hours = 0;
  let cost = 0;
  for (const s of shifts) {
    const emp = employeeById(data, s.employeeId);
    hours += shiftHours(s);
    cost += shiftCost(s, emp);
  }
  return { date, hours, cost, staff: shifts.length };
}

export interface RangeTotals {
  hours: number;
  cost: number;
  shifts: number;
}

export function rangeTotals(
  data: RosterData,
  startIso: string,
  endIso: string,
  location?: LocationName
): RangeTotals {
  const shifts = data.shifts.filter(
    (s) =>
      s.date >= startIso &&
      s.date <= endIso &&
      (!location || s.location === location)
  );
  let hours = 0;
  let cost = 0;
  for (const s of shifts) {
    hours += shiftHours(s);
    cost += shiftCost(s, employeeById(data, s.employeeId));
  }
  return { hours, cost, shifts: shifts.length };
}

export interface EmployeeRangeSummary {
  employee: Employee;
  hours: number;
  cost: number;
  shifts: number;
}

export function employeeSummaries(
  data: RosterData,
  startIso: string,
  endIso: string,
  location?: LocationName
): EmployeeRangeSummary[] {
  return activeEmployees(data)
    .filter((e) => !location || e.location === location)
    .map((employee) => {
      const shifts = data.shifts.filter(
        (s) =>
          s.employeeId === employee.id && s.date >= startIso && s.date <= endIso
      );
      const hours = shifts.reduce((sum, s) => sum + shiftHours(s), 0);
      return {
        employee,
        hours,
        cost: hours * employee.hourlyRate,
        shifts: shifts.length,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}
