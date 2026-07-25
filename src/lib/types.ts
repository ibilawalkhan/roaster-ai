// Domain types for the Rosterly UI layer (M1/M2). These are the camelCase,
// UI-facing shapes; mappers.ts translates Supabase rows into them.

export const LEVELS = ["junior", "mid", "senior"] as const;
export type Level = (typeof LEVELS)[number];

export const EMPLOYMENT_TYPES = ["casual", "part_time", "full_time"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const TIME_OF_DAY = [
  "morning",
  "afternoon",
  "evening",
  "night",
  "no_preference",
] as const;
export type TimeOfDay = (typeof TIME_OF_DAY)[number];

export type InviteStatus = "not_invited" | "invited" | "active";
export type RosterPeriod = "week" | "fortnight";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "suspended";

/** Plain-language labels for enum values used in the UI. */
export const LEVEL_LABEL: Record<Level, string> = {
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
};
export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  casual: "Casual",
  part_time: "Part-time",
  full_time: "Full-time",
};
export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
  no_preference: "No preference",
};
export const INVITE_LABEL: Record<InviteStatus, string> = {
  not_invited: "Not invited",
  invited: "Invited",
  active: "Active",
};

export interface Business {
  id: string;
  name: string;
  timezone: string;
  weekStartDay: number;
  rosterPeriod: RosterPeriod;
  currency: string;
  subscriptionStatus: SubscriptionStatus;
  logoInitial: string | null;
}

export interface Location {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
}

/** A job role (Kitchen, FOH, …) — distinct from the manager/staff access role. */
export interface Role {
  id: string;
  name: string;
  shortCode: string | null;
  colour: string | null;
  active: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  phone: string;
  email: string;
  colour: string;
  level: Level;
  employmentType: EmploymentType;
  primaryRoleId: string | null;
  roleIds: string[]; // all roles they can work (from user_role)
  homeLocationId: string | null;
  canWorkOtherLocations: boolean;
  payRate: number;
  maxHoursWeek: number | null;
  minHoursWeek: number | null;
  maxShiftsWeek: number | null;
  preferredDays: number[];
  preferredTimeOfDay: TimeOfDay | null;
  notes: string;
  isManager: boolean;
  inviteStatus: InviteStatus;
  active: boolean;
  createdAt: string;
}

/** Input for creating a team member — the 60-second path needs only name+phone. */
export interface NewTeamMember {
  name: string;
  phone: string;
  email?: string;
  colour?: string;
  level?: Level;
  employmentType?: EmploymentType;
  primaryRoleId?: string | null;
  roleIds?: string[];
  homeLocationId?: string | null;
  canWorkOtherLocations?: boolean;
  payRate?: number;
  maxHoursWeek?: number | null;
  minHoursWeek?: number | null;
  maxShiftsWeek?: number | null;
  isManager?: boolean;
}
