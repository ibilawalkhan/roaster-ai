import type { Employee, Role, Shift, Schedule, RosterData, LocationName } from "./types";
import { addDays, mondayOf, toISODate, uid } from "./utils";

// Shift templates used to generate a believable roster.
type Template = { start: string; end: string; break: number };
const T: Record<string, Template> = {
  DAY: { start: "10:00", end: "16:30", break: 30 },
  MID: { start: "11:30", end: "19:30", break: 30 },
  EVE: { start: "16:00", end: "22:30", break: 30 },
  FULL: { start: "10:00", end: "18:00", break: 45 },
  LATE: { start: "15:30", end: "22:30", break: 30 },
};

interface Seed {
  name: string;
  email: string;
  phone: string;
  role: Role;
  employmentType: Employee["employmentType"];
  rate: number;
  location: LocationName;
  accent: string;
  // [dayOffset within a week (0=Mon..6=Sun), template]
  pattern: [number, keyof typeof T][];
}

const SEEDS: Seed[] = [
  {
    name: "Khaled Nasser",
    email: "khaled@altazah.com.au",
    phone: "0412 884 110",
    role: "Manager",
    employmentType: "full-time",
    rate: 38,
    location: "Regents Park",
    accent: "ember",
    pattern: [
      [0, "FULL"], [1, "FULL"], [2, "FULL"], [4, "FULL"], [5, "FULL"],
    ],
  },
  {
    name: "Sara Haddad",
    email: "sara.h@altazah.com.au",
    phone: "0423 551 902",
    role: "Kitchen",
    employmentType: "part-time",
    rate: 30,
    location: "Regents Park",
    accent: "herb",
    pattern: [
      [0, "DAY"], [1, "DAY"], [3, "DAY"], [4, "DAY"], [5, "DAY"],
    ],
  },
  {
    name: "Ahmed Khan",
    email: "ahmed.k@altazah.com.au",
    phone: "0431 220 778",
    role: "Front of House",
    employmentType: "casual",
    rate: 28,
    location: "Regents Park",
    accent: "saffron",
    pattern: [
      [0, "EVE"], [1, "EVE"], [3, "EVE"], [4, "EVE"], [6, "DAY"],
    ],
  },
  {
    name: "Layla Mansour",
    email: "layla.m@altazah.com.au",
    phone: "0438 901 235",
    role: "Cashier",
    employmentType: "casual",
    rate: 27,
    location: "Regents Park",
    accent: "clay",
    pattern: [
      [2, "MID"], [3, "MID"], [4, "MID"], [5, "MID"], [6, "MID"],
    ],
  },
  {
    name: "Omar Farouk",
    email: "omar.f@altazah.com.au",
    phone: "0444 117 660",
    role: "Driver",
    employmentType: "casual",
    rate: 26,
    location: "Regents Park",
    accent: "teal",
    pattern: [
      [1, "EVE"], [2, "EVE"], [3, "EVE"], [4, "LATE"], [5, "LATE"],
    ],
  },
  {
    name: "Yusuf Demir",
    email: "yusuf.d@altazah.com.au",
    phone: "0421 778 345",
    role: "Kitchen",
    employmentType: "full-time",
    rate: 32,
    location: "Regents Park",
    accent: "plum",
    pattern: [
      [0, "EVE"], [1, "EVE"], [2, "EVE"], [4, "EVE"], [5, "EVE"],
    ],
  },
  {
    name: "Mariam Aziz",
    email: "mariam.a@altazah.com.au",
    phone: "0455 332 109",
    role: "Front of House",
    employmentType: "casual",
    rate: 27,
    location: "Regents Park",
    accent: "slate",
    pattern: [
      [2, "DAY"], [3, "MID"], [5, "EVE"], [6, "DAY"],
    ],
  },
  {
    name: "Bilal Rahman",
    email: "bilal.r@altazah.com.au",
    phone: "0466 220 884",
    role: "Kitchen",
    employmentType: "casual",
    rate: 29,
    location: "Wollongong",
    accent: "gold",
    pattern: [
      [0, "EVE"], [2, "EVE"], [4, "EVE"], [5, "DAY"], [6, "DAY"],
    ],
  },
  {
    name: "Nadia Suleiman",
    email: "nadia.s@altazah.com.au",
    phone: "0477 661 023",
    role: "Cashier",
    employmentType: "part-time",
    rate: 28,
    location: "Wollongong",
    accent: "ember",
    pattern: [
      [1, "MID"], [3, "MID"], [4, "MID"], [5, "MID"],
    ],
  },
  {
    name: "Hassan Ali",
    email: "hassan.a@altazah.com.au",
    phone: "0488 014 552",
    role: "Driver",
    employmentType: "casual",
    rate: 26,
    location: "Wollongong",
    accent: "herb",
    pattern: [
      [4, "LATE"], [5, "LATE"], [6, "EVE"],
    ],
  },
];

export function buildSeed(): RosterData {
  const start = mondayOf(new Date()); // first Monday of the current fortnight
  const end = addDays(start, 13);
  const createdAt = new Date().toISOString();

  const employees: Employee[] = SEEDS.map((s, i) => ({
    id: `emp_${i + 1}`,
    name: s.name,
    email: s.email,
    phone: s.phone,
    role: s.role,
    employmentType: s.employmentType,
    hourlyRate: s.rate,
    location: s.location,
    isActive: true,
    accent: s.accent,
    createdAt,
  }));

  const shifts: Shift[] = [];
  SEEDS.forEach((s, i) => {
    const emp = employees[i];
    for (let week = 0; week < 2; week++) {
      for (const [dayOffset, tplKey] of s.pattern) {
        const tpl = T[tplKey];
        const date = addDays(start, week * 7 + dayOffset);
        shifts.push({
          id: uid("shf"),
          employeeId: emp.id,
          date,
          startTime: tpl.start,
          endTime: tpl.end,
          role: emp.role,
          location: emp.location,
          breakMinutes: tpl.break,
          createdAt,
        });
      }
    }
  });

  const schedule: Schedule = {
    id: "sch_1",
    name: "Current fortnight",
    startDate: start,
    endDate: end,
    status: "draft",
    createdAt,
  };

  return { employees, shifts, schedules: [schedule] };
}
