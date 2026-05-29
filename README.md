# Al Tazah · Roster

A staff scheduling and pay-tracking MVP for **Al Tazah Charcoal Chicken** (Regents Park & Wollongong). Built to replace the spreadsheet-and-WhatsApp workflow with a visual schedule builder for managers and a phone-friendly shift view for staff.

This is a **front-end prototype for the owner pitch** — all data lives in the browser (seeded demo data + `localStorage`), so there's no backend to set up. The data layer is isolated behind `src/lib/store.tsx`, so swapping in Supabase later is a contained change.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and choose **Manager** or **Team member**.

- **Manager** → Dashboard, Schedule grid, Team, and Cost summary.
- **Team member** → mobile view of upcoming shifts and profile. Use the dropdown in the top bar to view the app as any staff member.

Data persists in your browser. To reset to the seeded demo, clear site data (or the app exposes a reset via the store's `reset()`).

## Features

**Manager**
- Dashboard: today's roster, staff on, hours, and labour cost; week-at-a-glance bars.
- Schedule: 2-week grid (staff × days), click any cell to add/edit/remove a shift, per-day and per-person hours + cost totals, location filter, week switcher, copy Week 1 → Week 2, publish toggle.
- Team: add / edit / deactivate staff, set pay rate, role, employment type, location, roster colour.
- Costs: fortnight totals, cost-by-day chart, and cost-by-team-member breakdown.

**Team member**
- Next shift highlighted, upcoming shifts list, fortnight hours + estimated pay.
- Tap a shift for details (hours, break, location, notes, estimated pay).
- Profile with pay rate and contact details.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** — "Charcoal & Ember" theme in `src/app/globals.css`
- Fonts: **Fraunces** (display) + **Hanken Grotesk** (UI)
- Client-side store: React Context + reducer, persisted to `localStorage`

## Project layout

```
src/
  app/
    page.tsx              role landing
    admin/                manager shell + pages (dashboard, schedule, employees, costs)
    me/                   employee shell + pages (schedule, profile)
  components/             ui.tsx, icons.tsx, ShiftModal, EmployeeModal
  lib/                    types, utils, seed, store, selectors
```
# employee-scheduler
# employee-scheduler
