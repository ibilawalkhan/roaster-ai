// Domain types for the Al Tazah roster app.

export const ROLES = [
  "Kitchen",
  "Front of House",
  "Cashier",
  "Driver",
  "Manager",
] as const;
export type Role = (typeof ROLES)[number];

export const LOCATIONS = ["Regents Park", "Wollongong"] as const;
export type LocationName = (typeof LOCATIONS)[number];

export const EMPLOYMENT_TYPES = ["casual", "part-time", "full-time"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  employmentType: EmploymentType;
  hourlyRate: number; // AUD per hour
  location: LocationName; // home location
  isActive: boolean;
  /** Token used to pick the employee's accent colour in the grid. */
  accent: string;
  createdAt: string; // ISO
}

export interface Shift {
  id: string;
  employeeId: string;
  date: string; // 'yyyy-mm-dd'
  startTime: string; // 'HH:MM' 24h
  endTime: string; // 'HH:MM' 24h
  role: Role;
  location: LocationName;
  /** Unpaid break in minutes, deducted from paid hours. */
  breakMinutes: number;
  notes?: string;
  createdAt: string;
}

export type ScheduleStatus = "draft" | "published";

export interface Schedule {
  id: string;
  name: string;
  startDate: string; // first day, a Monday
  endDate: string; // last day (13 days later)
  status: ScheduleStatus;
  createdAt: string;
}

export interface RosterData {
  employees: Employee[];
  shifts: Shift[];
  schedules: Schedule[];
}
