@AGENTS.md

# Al Tazah · Roster

Staff scheduling + pay-tracking MVP for **Al Tazah Charcoal Chicken** (Regents Park & Wollongong). Replaces a spreadsheet-and-WhatsApp workflow: managers build a 2-week roster on a grid; staff view their shifts on a phone. Built as a **front-end prototype for the owner pitch** — no backend.

## Commands

```bash
npm run dev      # dev server at http://localhost:3000
npm run build    # production build (also runs tsc + lint)
npm start        # serve the production build
npm run lint     # eslint
npx tsc --noEmit # typecheck only
node scripts/verify.mjs   # Playwright smoke test (dev server must be running)
```

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript** + **Tailwind CSS v4**
- All pages are **client components** (`"use client"`) — the app is interactive and state lives in the browser.
- No database: seeded demo data + `localStorage`. Persisted under key `altazah-roster-v1`.

## Architecture

State flows through a single store: `src/lib/store.tsx` (React Context + `useReducer`, wrapped around the app in `src/app/layout.tsx`). Access it with `useStore()`.

- On mount the provider loads from `localStorage`; if empty it falls back to `buildSeed()`. Every change re-persists.
- `hydrated` is `false` during SSR / first paint. **Layouts and the landing page gate on `hydrated`** (render a splash/empty shell until true) — this is deliberate and avoids hydration mismatches from `localStorage` and `Math.random()` ids. Don't render store-dependent UI before `hydrated`.
- `session` holds the demo "login": `{ role: 'admin' | 'employee' | null, employeeId }`. Picking a role on `/` calls `login(...)` and routes to `/admin` or `/me`. The admin/employee layouts redirect to `/` if the role doesn't match.

Data is **derived, not stored**: hours and costs are always computed from shifts via helpers in `src/lib/selectors.ts` and `src/lib/utils.ts`. There are no precomputed totals to keep in sync.

## Directory map

```
src/
  app/
    layout.tsx            root: fonts + StoreProvider
    page.tsx              role landing (charcoal/ember hero)
    admin/
      layout.tsx          manager shell (sidebar + mobile nav, role guard)
      page.tsx            dashboard home
      schedule/page.tsx   THE grid builder (centerpiece)
      employees/page.tsx  team list (add/edit/deactivate)
      costs/page.tsx      labour cost breakdown
    me/
      layout.tsx          employee shell (mobile frame, role guard, "view as" switcher)
      page.tsx            my schedule (next shift + upcoming)
      profile/page.tsx    pay rate + contact (read-only)
  components/
    ui.tsx                primitives: Button, Card, Badge, Avatar, StatCard, Modal, form fields
    icons.tsx             inline stroke SVG icon set
    ShiftModal.tsx        add/edit/remove a shift
    EmployeeModal.tsx     add/edit a team member
  lib/
    types.ts              Employee, Shift, Schedule + ROLES/LOCATIONS/EMPLOYMENT_TYPES consts
    utils.ts              dates, time formatting, money/hours, shiftHours/shiftCost, ACCENTS palette
    seed.ts               buildSeed(): 10 staff + a fortnight of shifts, relative to the current Monday
    store.tsx             Context store + actions + localStorage
    selectors.ts          derived data: weekDays, dayTotals, rangeTotals, employeeSummaries, etc.
```

## Conventions & gotchas

- **Read the bundled Next.js 16 docs** (`node_modules/next/dist/docs/`) before using unfamiliar APIs — this version post-dates training data (see `AGENTS.md`).
- **Design system = "Charcoal & Ember"**, defined as Tailwind v4 `@theme` tokens in `src/app/globals.css`. Use the semantic utilities (`bg-paper`, `text-ink`, `text-ink-soft`, `bg-ember`, `bg-charcoal`, `border-line`, `rounded-card`, `shadow-soft/pop`) rather than raw hex. Per-person colour comes from the `ACCENTS` palette in `utils.ts`, keyed by `employee.accent`; resolve with `accentOf(token)` (returns inline-style hex, used via `style=` because the tokens are dynamic).
- **Fonts:** Fraunces (`font-display`) for headings/brand, Hanken Grotesk (`font-sans`) for UI. Numeric data uses the `.nums` class (tabular figures). No Inter/Geist.
- **Dates are ISO `yyyy-mm-dd` strings**, parsed with `parseISO`/`addDays` from `utils.ts` — **never `new Date(iso)`** directly (timezone shifts). Weeks start **Monday** (`mondayOf`).
- **`weekDays`, `fortnightDays`, and all totals live in `selectors.ts`**, not `utils.ts` — a common import mix-up.
- **One shift per employee per day** is assumed (`shiftFor` returns the first match; the grid is one cell per day). Keep this invariant if extending.
- `shiftHours` = gross span − `breakMinutes`; cost = hours × `hourlyRate`. The shift modal shows live paid-hours.
- Store actions create ids/timestamps for you — call `addShift({...})` / `addEmployee({...})` with the payload minus `id`/`createdAt`.

## Verifying changes

Run `node scripts/verify.mjs` with the dev server up: it drives every flow with Playwright, screenshots to `/tmp/altazah-shots/`, and **fails on any page or console error**. Good for catching regressions before a demo.

## Future / out of scope

This is a pitch MVP. Real auth, WhatsApp/SMS notifications, clock-in/out, leave & shift-swap requests, and penalty-rate awards are intentionally deferred. The data layer is isolated behind `store.tsx` so a swap to **Supabase** (the planned backend) is a contained change. See `../altazah-scheduler-spec.md` for the full requirements.
