# Rosterly — Requirements & Build Spec (v2, multi-tenant platform)

> **Working name: Rosterly.** Simple shift scheduling, shift-swapping, and labour-cost tracking for small independent restaurants. One platform, many restaurants, each fully isolated. Sold on subscription. First customers: Al Tazah Charcoal Chicken (existing) and a Guildford restaurant (signed).
>
> *Rename is a find-replace away — confirm the `.com.au` domain and that no existing AU rostering product uses the name before committing.*

**Feature tags used throughout:** **[MVP]** ship in 2 weeks · **[V1.1]** soon after launch · **[LATER]** backlog.

---

## 0. Legal framing — applies everywhere, never cut **[MVP]**

All dollar figures are **indicative labour-cost estimates for rostering only**. Not payroll, not award-interpreted pay. Australian hospitality pay follows the Restaurant Industry Award (casual loading, evening/weekend/public-holiday penalties) — **Rosterly does not calculate award-compliant pay and must never claim to.** A visible disclaimer sits on every screen showing cost/pay. Payroll stays in the customer's existing system. Competing with Deputy on payroll/award compliance is explicitly a non-goal — it is their hardest, most liability-heavy problem, and staying out of it is our positioning, not a limitation.

---

## 1. Platform model — how many restaurants share one system

Three layers of access. This is the heart of turning "an app" into "a product."

### 1.1 Platform level (you — the software owner) **[MVP data model, LATER for UI]**
The level above all restaurants. Only you operate here.
- Create a new **Business** (restaurant account) when you sign a customer, with its first manager login.
- Set each business's `subscription_status`: `trial` / `active` / `past_due` / `suspended`.
- A `suspended` business's manager sees a "contact us about your account" block instead of the app — this is the entire payment-enforcement mechanism for now.
- **v1 reality:** no super-admin UI. You do this via a small seed script or the Supabase dashboard. Building a super-admin panel is **[LATER]** — do not spend launch time on it.

### 1.2 Business level (your customer) **[MVP]**
- Each business = one restaurant, with one or more **Locations** (v1: one location; the model supports more so multi-site is a later toggle, not a rebuild).
- A manager logs in and sees **only their own** business — staff, rosters, costs. They cannot tell other businesses exist.
- Isolation is enforced in the **database** via Row-Level Security keyed on `business_id`, not by hiding UI. This is a hard security requirement (see §6/§9).

### 1.3 Staff level **[MVP]**
- A team member sees only their own shifts, within their own business.

### 1.4 Signing customer #2 (the flow)
You create the business row + first manager (seed script) → manager gets an SMS/login link → logs in to an empty roster with their own staff → never aware Al Tazah shares the system. **Zero new deployment per customer** — one codebase, one database, one Vercel deploy serves all tenants. Adding customer #2 or #50 = one new `business` row.

### 1.5 Single vs multi-restaurant per customer
Per your decision: **one business per customer for now.** A user belongs to one business. Keep `business` and `location` as separate tables anyway (cheap, future-proof). Deputy validates the roadmap here — they tier "single location → multi location → franchise." That's our expansion path, deliberately deferred. **[V1.1/LATER]**

---

## 2. Subscription / billing **[LATER — do NOT build in the 2 weeks]**

Do not build Stripe, webhooks, or dunning for your first customers. It's a week you don't have solving a problem you don't have (you have 1–2 customers).
- `subscription_status` field per business, set **manually** by you.
- Collect money by **invoice / bank transfer** for the first 5–10 customers.
- Only when volume clearly justifies it, wire up **Stripe Billing** (subscriptions + customer portal + webhooks that flip `subscription_status`). Standard micro-SaaS sequencing.
- **Pricing to decide with owner:** per-location or per-business monthly. Market reference ~$20–50/location/month; price low as an unknown but not free (a paying reference customer is worth far more than a free one).

---

## 3. Roles **[MVP]**

| Role | Can do |
|---|---|
| **Manager/Owner** | Build roster, manage staff, approve swaps, see all costs for their business |
| **Team member** | See own shifts, drop a shift, claim an open shift, view own hours + estimated pay, edit own contact details, set availability (V1.1) |

**[LATER]** Supervisor role (edit one location's roster, no cost visibility).

---

## 4. Authentication & access **[MVP]**

- **Phone-number + OTP login** via Supabase Auth (staff have phones, not always email; no passwords to lose). Email+password fallback for managers.
- First login matches the user to their pre-created staff record by phone.
- Manager invites staff: create record (name, phone, role, rate, location) → staff get SMS link → OTP login → in.
- Session persistence so staff aren't re-logging-in constantly.
- **RLS is mandatory** (see §9). Unlinked `/admin` routes are NOT security.

**Acceptance:** a staff member hitting an `/admin` URL or another user's data is blocked by the database, not just the UI. No staff member ever sees another's wage.

---

## 5. Core features

### 5.1 Roster / Schedule **[MVP — mostly built]**
- 2-week fortnight grid (staff × 7 days), Week 1 / Week 2 toggle.
- Tap a cell → add/edit/remove shift: start, end, unpaid break (min), role, location, note.
- Per-day and per-person totals (hours + **estimated cost**).
- Location filter; Copy Week 1 → Week 2.
- **Publish** toggle: Draft (staff can't see) vs Published (staff see their shifts); publishing triggers "roster is out" notifications.
- **[V1.1]** Shift templates; overlap/double-booking warnings.

### 5.2 Team member phone view **[MVP — mostly built]**
- Next shift highlighted; upcoming shifts; fortnight hours + estimated pay (with disclaimer).
- Tap a shift → details. Editable own contact info; read-only pay rate.

### 5.3 Shift drop / claim / approve **[MVP — the hard, differentiating feature]**

State machine (implement exactly this; the edge cases are where it breaks):

```
ASSIGNED ─(dropper requests drop)─► DROP_REQUESTED
DROP_REQUESTED ─(manager rejects)─► ASSIGNED
DROP_REQUESTED ─(manager opens)───► OPEN
OPEN ─(staff claim)───────────────► CLAIMED_PENDING
CLAIMED_PENDING ─(manager approves X)► REASSIGNED
OPEN | CLAIMED_PENDING ─(manager cancels)► ASSIGNED
```

Flow: staff drops a shift (optional reason) → manager notified → manager opens it to eligible staff (default eligibility: same location; configurable) → eligible staff claim → manager picks one → chosen staff notified "you're on", others "filled", dropper "covered by X".

**Edge cases (must handle):**
- No claim before shift starts → stays with dropper; manager notified "uncovered." Never silently unassigned — someone is always accountable.
- Dropper can withdraw only before an approval.
- Simultaneous claims → all recorded; manager still chooses; a **DB transaction that re-checks status** prevents double-assignment.
- Manager may directly assign an open shift without waiting for claims.

**Acceptance:** drop → open → two claim → approve one → all four parties get the correct notification and every device shows the new owner. No shift ever owned by two people or by nobody-without-the-manager-knowing.

### 5.4 Availability & unavailability **[V1.1 — Deputy-informed, first thing customers ask for]**
Staff mark days/times they can't work; manager sees it while rostering. Capture-only in MVP if cheap; full feature is V1.1.

### 5.5 Leave requests **[LATER]**
Request time off → manager approve/deny. Deputy has it; not launch-critical.

### 5.6 Costs / labour reporting **[MVP — mostly built]**
- Fortnight cost, hours, avg $/hr, rostered-staff count; cost-by-day chart; cost-by-member breakdown; per-location + all-locations.
- Every figure carries the disclaimer.
- **[V1.1]** Labour cost as % of a manually-entered daily sales figure — the metric owners actually care about; cheap, high value.

### 5.7 Staff management **[MVP — mostly built]**
- Add/edit/deactivate staff (name, phone, email optional, role, employment type, base rate, home location, colour). Deactivate ≠ delete (preserve history).
- **[V1.1]** Store `is_casual` etc. now for future penalty-rate work.

---

## 6. Notifications **[in-app MVP; SMS MVP-if-time]**

Two layers, separated so SMS is swappable:
- **In-app realtime [MVP]:** Supabase Realtime pushes changes to open apps; a notifications bell/list shows recent events.
- **SMS/WhatsApp deep-link [MVP-if-time, else V1.1]:** a Supabase Edge Function calls **Twilio** to text a link for events needing someone not in the app (roster published, shift opened, you've been assigned, claim awaiting approval). Deep link opens the web app in the phone browser — no PWA push, no app-store install (deliberate for the timeline; true web-push is **[LATER]**).

| Event | Recipients |
|---|---|
| Roster published | staff in that location |
| Drop requested | manager |
| Shift opened | eligible staff |
| Shift claimed | manager |
| Claim approved | chosen staff + dropper; others "filled" |
| Uncovered, starting soon | manager |

SMS ~cents each; recommend launching in-app + SMS-for-critical-events only. Owner to be told SMS is a small running cost.

---

## 7. Technology stack

Chosen for **speed to ship, low ops, and not breaking in production** — not for résumé flash.

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | Next.js (App Router) + React + TypeScript + Tailwind | Already built; do not rewrite. Type-safety reduces prod bugs. |
| **Hosting (frontend)** | **Vercel** | Already deployed there; push-to-main deploys; auto HTTPS/CDN; scales automatically. |
| **Backend / DB / Auth / Realtime** | **Supabase** (managed Postgres + Auth + Realtime + RLS + Storage) | Collapses four services into one managed platform. Postgres is battle-tested and scales well past your needs. RLS gives real per-tenant security. Nothing to run. |
| **DB access / migrations** | Supabase client + typed queries; **Prisma or Supabase migrations** for versioned schema | Typed data layer; versioned, reviewable schema changes. |
| **Notifications (out-of-app)** | **Twilio** (SMS) via a Supabase **Edge Function** | Isolated behind one `notify()` module; swappable/removable. |
| **Scheduled jobs** | Supabase **cron** (pg_cron) / scheduled Edge Function | "Uncovered shift starting soon" checks; roster reminders. |
| **Error monitoring** | **Sentry** (frontend + edge functions) | See §9 — you cannot run a real product blind. |
| **Uptime check** | A simple ping (even your own Pulse project, or a free monitor) | Know it's down before the customer calls. |
| **Analytics (light)** | Vercel Analytics or PostHog free tier | See what's used; optional. |

**Why Supabase over AWS here (interview-ready answer):** your certs are AWS, and Pulse/Sorted show AWS depth — but this product's binding constraint is *ship in 2 weeks for a paying customer, then keep it running solo*. Supabase collapses Auth + Postgres + Realtime + RLS + cron into one managed service; the AWS equivalent (Cognito + RDS + AppSync + IAM + EventBridge) is more to wire and operate. Choosing the tool that fits the constraint — not the flashiest — is a senior signal. Keep AWS for the portfolio; use Supabase to get customers live.

---

## 8. Scalability — built to grow without re-architecture

You will not have scale problems at 1–50 restaurants; the goal is to avoid *design mistakes* that would force a rebuild later.

- **Multi-tenant from day one (§1).** One codebase + one database + `business_id` on every row. Adding customers = adding rows, never deployments. The single most important scalability decision, and it's a data-model choice, not infra.
- **Stateless frontend.** Next.js on Vercel scales horizontally automatically; no server state to bottleneck.
- **Postgres indexing from the start.** `shift(business_id, roster_id)`, `shift(assigned_user_id, date)`, `shift(status)` for open-shift lookups, `app_user(business_id, phone)`. Cheap now, saves pain later.
- **Costs derived, not stored** (`hours = end−start−break`, `cost = hours × rate`) — computed in selectors, so no aggregate to keep in sync across writes.
- **Realtime scoped per business/user**, never a global firehose — subscriptions filter by `business_id`, so one busy tenant can't flood others.
- **Pagination on lists** (staff, shifts, notifications) — never load unbounded rows.
- **Connection pooling** via Supabase's pooler for serverless functions (avoids exhausting DB connections — a classic serverless-on-Postgres footgun).
- **Idempotent writes** on the swap flow (a retried claim/approve must not double-apply — enforced by the status-checking transaction).

At genuinely large scale (hundreds+ of busy tenants) you'd revisit read replicas, per-tenant rate limits, and splitting notifications into its own service — all **[LATER]**, none requiring a rewrite because the tenant boundary is already right.

---

## 9. Production reliability — it must not break in front of a paying customer

What separates a demo from a product someone pays for. Treat as **[MVP]**, not polish.

- **RLS enforced AND tested.** Explicit test: log in as staff from business A, attempt to read business B's data and another user's wage — both must fail at the DB. Highest-stakes correctness property in the app.
- **Server-side authorization on every mutation.** Never trust the client. The DB (RLS + policies) is the final gate; a hidden UI button is not security.
- **The shift-swap transaction is the critical section.** Approving a claim must, in one transaction: re-check the shift is still `OPEN`/`CLAIMED_PENDING`, reassign, reject other claims. If two managers/tabs act at once, exactly one wins. Test this concurrency path deliberately.
- **Input validation** on every write (Zod on the client + DB constraints/checks as backstop). Reject impossible shifts (end before start, negative break, break ≥ shift length).
- **Error monitoring (Sentry) from day one.** You won't be watching when it breaks at Friday dinner rush — Sentry tells you what/where. Non-negotiable for a real product.
- **Graceful failure, no dead ends.** Every screen has loading and error states; a failed save shows retry, never a blank/frozen page or silent data loss. Optimistic UI on the roster rolls back visibly if the write fails.
- **Notification delivery is best-effort and logged.** SMS/realtime failures are recorded (a `notification` row with status), never crash the action that triggered them. A failed text must not fail the shift approval.
- **Backups.** Supabase provides automated Postgres backups; confirm the plan tier includes daily/point-in-time backup, and take a **manual CSV export** before any risky migration. The customer's roster must be recoverable.
- **Migrations forward-only, tested on staging** before touching production. Never edit an applied migration.
- **Two environments:** a Supabase **staging** project + Vercel **preview** deploys, separate from production. Don't develop against the customer's live data.
- **Timezones.** Store UTC, render Australia/Sydney. A shift off by an hour (or across DST) destroys trust instantly. Test around a DST change.
- **Health check + uptime ping** so you learn about downtime before the manager does.

**Definition of "won't break in production" for launch:** RLS test passes; swap concurrency test passes; every screen has error/loading states; Sentry live; backups confirmed; timezones correct across DST; staging separate from prod.

---

## 10. Data model (Supabase / Postgres)

```
business          (id, name, logo_initial, subscription_status, created_at)
location          (id, business_id, name)
app_user          (id, business_id, auth_user_id, phone, email, name,
                   role['manager'|'staff'], employment_type, pay_rate,
                   home_location_id, colour, active, created_at)
roster            (id, business_id, fortnight_start, status['draft'|'published'])
shift             (id, business_id, location_id, roster_id, date,
                   start_time, end_time, break_minutes, role, note,
                   assigned_user_id, status[§5.3], created_at, updated_at)
shift_claim       (id, business_id, shift_id, claimant_user_id,
                   outcome['pending'|'approved'|'rejected'], created_at)
availability      (id, business_id, user_id, date, available bool, note)   -- V1.1
notification      (id, business_id, user_id, type, payload_json,
                   channel['inapp'|'sms'], delivery_status, read, created_at)
```

- `business_id` on **every** table → the tenant key every RLS policy filters on.
- Costs derived in selectors, never stored.
- Indexes per §8. `shift.status` transitions per §5.3, guarded by transaction.

---

## 11. Two-week delivery plan

**Rule:** reach "real manager builds a real roster, real staff log in and see it, tenant-isolated" by end of week 1. Week 2 = swap workflow + notifications + production-reliability checklist. If short, **SMS drops first** (in-app still delivers the feature).

### Week 1 — real, multi-tenant, secure
- **D1–2:** Supabase project; schema (§10) + indexes; **RLS policies + isolation test (§9)**; seed 2 businesses (Al Tazah + Guildford) to prove isolation early.
- **D2–3:** Phone-OTP auth; user↔staff match; manager-invites-staff.
- **D3–5:** Swap localStorage store → Supabase behind the existing store interface; roster grid, team, costs on shared real data; **loading/error states** as you go.
- **D5:** Publish flow + staff phone view. **Sentry live. Checkpoint: two businesses, isolated, manager+staff logged in on two devices.**

### Week 2 — differentiator + hardening
- **D6–8:** Swap state machine (§5.3) incl. **concurrency transaction** and all edge cases.
- **D8–9:** In-app realtime notifications + bell/list.
- **D9:** SMS deep-link for critical events (Twilio edge fn) **if on schedule**, else V1.1.
- **D10:** Production checklist (§9): RLS test, swap concurrency test, timezone/DST check, backups, staging vs prod. Deploy; walk owner through it; sign the written scope agreement (§12).

### Cut-list if behind (in order)
1. SMS (keep in-app) → 2. Copy-week/templates → 3. cost-chart polish → 4. manager-gated drop (auto-open instead). **Never cut:** auth/RLS + isolation test, the disclaimer, swap approve step, error states, Sentry, backups.

---

## 12. Before you take money — checklist
- [ ] RLS isolation test passes (business A cannot see B; staff cannot see others' wages).
- [ ] Swap concurrency test passes (no double-assignment).
- [ ] Estimate disclaimer on every cost/pay figure.
- [ ] Error monitoring live; backups confirmed; staging separate from prod.
- [ ] Timezones correct across a DST boundary.
- [ ] Written agreement with each owner: what it does, what it explicitly does **not** (payroll/award pay), price, who pays SMS, that figures are estimates, and data-export on request.
- [ ] Manual data export possible (no lock-in / no loss risk).
- [ ] Pricing decided (per-location or per-business monthly).

## 13. Out of scope for v1 (tell the owner)
Award/penalty-rate pay, payroll/payslips, clock-in/out time tracking, POS/accounting integrations, native apps, self-serve signup, automated billing, leave management. Some are V1.1/LATER; **award pay is never in scope** (§0).

---

## 14. Architecture decisions (build log)

Brief, interview-defensible notes on decisions made during the build. Newest first.

### AD-1 — Tenant isolation enforced by RLS + SECURITY DEFINER context helpers
Every table has `business_id` with RLS enabled (`supabase/migrations/0002_rls.sql`). Policies resolve the caller's tenant via `public.current_business_id()` / `current_app_user_id()` / `is_manager()`, each `SECURITY DEFINER` so they read `app_user` **without** re-triggering RLS — this avoids the classic self-referential-policy infinite recursion. **Wage privacy** is enforced structurally: staff can `SELECT` only their own `app_user` row (RLS is row-level, so hiding one column isn't possible; restricting to the own row hides colleagues' rates entirely). A `BEFORE UPDATE` guard trigger (`guard_app_user_update`) blocks non-managers from changing `pay_rate`/`role`/`active`/`business_id` — server-side authz beyond RLS (rule 2).

### AD-2 — RLS tested against real Postgres via PGlite, no Docker required
The `tenant isolation` test (`tests/db/tenant-isolation.test.ts`, run by `npm run test`) boots **PGlite** (Postgres compiled to WASM, in-process), provisions the `auth` surface Supabase gives for free (`tests/db/auth-shim.sql`), applies the **unmodified** migration files, seeds two tenants (Al Tazah + Guildford), and asserts cross-tenant reads/writes and wage reads fail at the DB. Chosen over a Docker-based Supabase stack so the invariant test is fast, deterministic, and CI-friendly with zero external services; the same migrations apply identically to real Supabase (staging/prod).

### AD-3 — Timezone model: instants in UTC, shift times as local wall-clock
`created_at`/`updated_at`/notification times are `timestamptz` (UTC). Shift `date`/`start_time`/`end_time` are stored as the roster's **local calendar values** and attached to Australia/Sydney only at render — so a 10:00 shift stays 10:00 across a DST change (correct for a roster). Satisfies §9's "store UTC, render Sydney" for instants while keeping wall-clock shift semantics.

### AD-4 — Controlled vocabularies as Postgres enums
`subscription_status`, `app_role`, `employment_type`, `roster_status`, `shift_status` (the §5.3 state machine), `claim_outcome`, `notification_channel` are enums — a DB-level backstop to Zod (§9). Job roles (Kitchen/FOH/…) stay free text on `shift.role` since they vary per business.

### AD-5 — Test runner: Vitest; isolation/RLS tested at the DB layer
Vitest for speed and native ESM/TS. Business logic lives in `src/lib/` to stay testable without the UI (CLAUDE.md code style). Migrations are forward-only, filename-ordered (`0001_…`, `0002_…`), and never edited once applied (§9).

### AD-6 — Client-side auth (browser Supabase client), RLS as the boundary
The app is fully client-rendered (`"use client"` throughout, session gated in client layouts). So auth uses the Supabase **browser** client (`src/lib/supabase/client.ts`) with session persisted to localStorage and auto-refreshed — no SSR cookies/middleware (which also avoids the Next 16 middleware/cookie changes). This is safe because security is enforced by **RLS in Postgres**, not by the session transport: the anon key is public by design and grants only what policies allow. Moving rendering server-side (httpOnly cookie auth via `@supabase/ssr`) is a later hardening step, not a rewrite.

### AD-17 — M9 (Notifications): a closed event catalogue, a transactional outbox, and a `notify()` that cannot throw
The full catalogue lives in `src/lib/notify/events.ts` as a **closed union `E1..E16`** with the recipient rule, the channels, the time-critical flag and the deep link for each — so M9 §2's "nothing else sends a notification" is a type error rather than a code-review convention, and adding an event forces someone to answer all four questions. Copy is rendered at ENQUEUE time and stored on `payload_json`, which keeps the Deno worker dumb (it sends the text it was given) and puts all user-facing wording in one file. **Deep links are never a home screen:** each event names its exact screen (`/me/shifts/:id`, `/me/open-shifts?shift=…`, `/admin/swaps?shift=…`), enforced by a test. §4's hygiene rules are a separate pure module (`src/lib/notify/policy.ts`, 43 unit tests) that returns **typed decisions, never booleans** — `send` / `schedule(scheduledFor)` / `suppress(reason)` — because `suppressed_reason` is what makes "I never got told" answerable. Quiet hours (22:00–07:00) are evaluated in **business** time through the existing `zonedInstant`, so a held message releases at 07:00 local on both sides of a DST change (the UTC instant moves by an hour; tested). Only E10 and E13 override it. In-app is **never** suppressed for a delivery reason: hitting the daily SMS cap, the monthly budget or the business SMS toggle degrades to in-app only, so a message is quieter but never lost. Publish is structurally safe from fan-out — `planRosterPublish` collapses the shift list to **one plan per person** before anything is enqueued, so a 14-shift fortnight cannot produce 14 texts even by mistake, and a *re*publish sends nothing (only the E2/E3/E4 already raised per edit). **The load-bearing rule (CLAUDE.md rule 7) is structural:** `notify()`'s entire body is one try/catch with no throw path, so it returns `{ok:false}` rather than rejecting — a Twilio outage, an RLS refusal or a dropped connection cannot undo a shift approval, and `void notify(...)` at a call site cannot even produce an unhandled rejection. **Where the trust boundary sits:** migration 0008 gives `notification` no client INSERT policy (a browser that could insert could fabricate "your shift was cancelled"), so enqueueing goes through `src/app/api/notify/route.ts` — a service-role route handler that re-verifies the caller's JWT, re-reads their `business_id` from the database (never from the request), and refuses any draft addressed outside it. It performs exactly one server-side expansion, `recipientRule: 'manager'`, because staff legitimately raise E6/E9 but *cannot* read the team list (migration 0002, correctly) — so the manager's identity never reaches the browser. **Known seam, deliberately named:** M9 §3 wants the outbox row in the *same transaction* as the action; the atomic version belongs inside the SECURITY DEFINER RPCs (`approve_claim` writing its own rows), which is DB-owner work. Today the enqueue happens immediately *after* the server confirms, so the failure mode is a lost notification — recoverable from `roster_change_log.notified` and `shift_swap_event` — never a lost or falsified action, which is the safe direction. Delivery is `supabase/functions/notify-worker` (Deno, cron every 5 min): in-app rows are already delivered by Realtime and are just stamped; SMS goes to Twilio with the absolute deep link, retries 1/5/25 minutes and lands in a **visible `failed`** state after 3 attempts; a message queued overnight whose shift has since started is marked `suppressed`/`stale` rather than sent as a pointless 7am buzz. It is excluded from the app's tsconfig/ESLint (remote URL imports, `Deno` global) and cannot be executed without Docker — it is verified by deploying to staging. **Not built:** the per-business SMS budget/toggle and quiet-hours columns (no schema for them yet — every function takes them as parameters with documented defaults), E13/E14/E15/E16 call sites, and the batch-window *collapser* (`batchKey` and `notification_batch` exist and are keyed; the worker still sends per row). 43 new unit tests → 419 total.

### AD-16 — M10 (Costs & reporting): snapshots are the only source of a rate, and rows are reconciled to the total
Report aggregation lives in one pure module (`src/lib/domain/cost-reports.ts`) built on the existing shared primitives — `elapsedHours` for duration and `shiftCost`/`roundMoney`/`roundHours` for money — so the reports, the roster grid, the template preview and the staff app cannot disagree (M10 §9). Three decisions worth defending. **(1) There is no fallback to a current pay rate, anywhere.** Cost comes only from `shift.pay_rate_snapshot`; a filled shift with no snapshot contributes its hours but zero cost and is counted in `missingRateCount`, which the screen surfaces as "cost is missing from these totals". Falling back to `app_user.pay_rate` would be the one bug that makes a raise silently rewrite every historical roster and destroy the owner's trust in the numbers (M10 §2.1). **(2) Unfilled positions are first-class rows** (`userId: null`), carrying no cost and no rostered hours but counted — with their uncovered hours — in every bucket, so a roster with three holes can never read as a cheap one (M10 §8). The data layer synthesises them from `roster_position` rows no `shift` references, and a shift whose assignee was removed counts once, as itself. **(3) Rounding: the total is the authority, rows are allocated against it.** M10 §2 requires totals to be the rounded sum of unrounded values, and §9 requires a column to equal the sum of its rows as shown — which do not follow from each other (three shifts of $213.875 total $641.63 but display as 3 × $213.88 = $641.64). So `allocateRounded` rounds each row and puts the residual cent on the largest rows: every row stays within a cent of its true value and a manager can always add the printed column up by hand. Unit-tested for reconciliation across by-day/by-week/by-person/by-role/by-location, overnight attribution to the start date, real elapsed hours in both DST directions, and snapshot immutability (40 new tests → 367 total). The screen (`src/app/admin/costs/page.tsx`) is manager-only by route and by RLS, uses CSS bars rather than a chart dependency (with every number also present as text for screen readers), and repeats `COST_DISCLAIMER` beside every dollar figure. **Deliberately not built:** labour as a % of sales and the `daily_sales` table (V1.1), CSV export (V1.1), planned-vs-actual (V1.1).

### AD-15 — M8 (Shift swaps): the app calls the RPCs, it never re-implements them
The three transitions that must be atomic stay in the database: `request_drop`, `claim_shift` and `approve_claim` (migration `0007_swaps.sql`, 16 concurrency tests). `src/lib/supabase/swaps.ts` is a thin wrapper — re-implementing the approval critical section in TypeScript would replace a proven guarantee with a race. Its one real job is translation: `src/lib/domain/swaps.ts` maps each Postgres exception to a sentence a kitchen hand can act on (`'shift is no longer available'` → *"Sorry, this shift has already been filled."*), and every failure carries a `kind` so a screen can react (an `already_filled` failure re-reads the list) rather than merely apologise. The 4-hour self-drop cutoff (M8 §3.1) is a pure function taking the cutoff as a parameter — the per-business setting it should read has no column yet, so the default lives at the call site, not buried in the rule. The dropper's screen repeats one exact sentence in every non-assigned state — *"You're still rostered until your manager confirms."* — as a constant, because a dropper who thinks the app has taken the shift off them and doesn't turn up is the worst failure this module can produce. Eligibility gating uses the SAME `checkEligibility`, extended with an **opt-in** location rule (H9): `EligibilityTarget.locationId` is optional, so M6's roster screen is unchanged, while M8 can hide a shift from someone tied to another site. The block/warn line is exactly M8 §4 — blocks (role, location, overlap, deactivated) hide a shift from the staff list; policy breaches (hours, rest, consecutive days, one-shift-per-day) do **not** hide it and surface to the manager at approval, alongside a senior-coverage check that reports only gaps the swap would *create*. **Two known seams, both needing work in `supabase/**` by the DB owner:** (1) migration 0006's `shift_select` lets a non-manager read only their OWN shift, and an open shift still belongs to the dropper — so the staff open-shifts list returns nothing until a SECURITY DEFINER RPC exposes a business's open shifts; the screen therefore says only that nothing is *listed*, never that nothing is going. (2) `shift_swap_event` has no client INSERT policy (by design — the audit cannot be forged), so the manager's decline/open/cancel transitions leave no swap-event row; closing that needs three more RPCs. Staff self-withdrawal is the same shape: `withdrawDrop`/`withdrawClaim` exist and insist on the row coming back, so a policy-filtered write fails loudly instead of silently succeeding — but today they are manager actions, and the staff UI honestly says to speak to the manager. 30 new unit tests → 315 total.

### AD-14 — M6: one shared eligibility function, and block-vs-warn as a data property
The rule "can this person work this shift?" now lives in exactly one place — `src/lib/domain/eligibility.ts` — used by manual editing today and by the M8 swap claim later. It does not re-implement the solver: the solver decides a whole roster, this re-checks one candidate against one position. Crucially, **severity is a property of the rule, not of the caller**: `checkEligibility` returns each breach tagged `block` (overlap, deactivated, role not held — physically impossible, no override) or `warn` (unavailable, over hours, short rest, consecutive days, one-shift-per-day, below minimum hours — allowed, but named). The UI cannot get this wrong because it never decides: blocked candidates are disabled in the picker, warned ones stay selectable. Rationale (M6 §3.2): hard-blocking availability or hour limits makes the tool argue with the manager about his own restaurant; making the breach visible and *persistent* is the honest middle ground, so every accepted warning is written to `roster_warning` (acknowledged) and stays on the screen until resolved. Each issue also carries `persistedRule` — the `roster_warning.rule` CHECK vocabulary it maps to, or `null`. `one_shift_per_day` is currently `null`: it warns live but has no term in the constraint, and widening it needs a forward-only migration. Senior coverage is recomputed client-side after every edit (`seniorCoverageGaps`, 15-minute blocks over real instants, the same discretisation the solver uses) so the health panel can never show a gap the manager has already fixed. Every edit path goes through `src/lib/supabase/roster-edit.ts`, which writes a `roster_change_log` row from inside each mutation — the table is append-only at the database level (select+insert grants only), so history is corrected by new rows, never rewritten. Removing a person deletes the `shift` and leaves the `roster_position`, so the requirement reappears as unfilled; only `deletePosition` removes a requirement, and it is confirm-gated and visually distinct. **Known gap:** blocks are enforced in the UI and by the solver, not by a database constraint — a hand-rolled API call could still double-book someone. A Postgres exclusion constraint on (assigned_user_id, time range) is the real fix and belongs with the DB owner. 24 new unit tests → 244 total.

### AD-13 — M5 app side: the roster is a COPY, the solver call always degrades
Creating a roster expands the week template onto real dates as `roster_position` rows (`src/lib/supabase/roster.ts`); the roster never reads the template again, so editing the template later cannot alter a roster already generated. Position ids are generated client-side at seeding so the expansion key → row id mapping is exact and never depends on the order Postgres returns inserted rows in — the solver answers by `position_id`, so a wrong mapping would put people on the wrong shift. The `/solve` request is built by one pure function (`src/lib/domain/solver-request.ts`) that expands each slot's `count` into individual positions and pre-resolves availability through the single M3 resolver, so the Python service never re-implements pattern/exception logic (contract: `docs/SOLVER_CONTRACT.md`). Wall-clock → instant conversion (and the reverse) lives in `src/lib/domain/timezone.ts` via `Intl`, two-pass, so an overnight shift across a DST change is honestly 7 or 9 hours (unit-tested both directions). `src/lib/solver/client.ts` turns every failure — unconfigured, timeout, network, non-2xx, unparseable, `status: "failed"` — into one typed `SolverUnavailableError` whose message the UI renders verbatim; the seeded roster is untouched and the failed attempt is still written to `solve_run`. The product is therefore fully usable with the solver switched off (`NEXT_PUBLIC_SOLVER_URL` blank). Pre-flight (`src/lib/domain/preflight.ts`) draws the blocker/warning line at "can this produce anything sensible": empty template, no active staff, a role nobody holds and no senior at all **block**; short capacity, short seniors, a short-handed day and unrecorded availability **warn**, because demand is soft (M5 §5.2) and a short week is a legitimate, explainable result. 36 new unit tests → 184 total.

### AD-12 — M3 (Availability): pattern + exceptions with one shared resolver
Migration `0004_availability.sql` adds `availability_pattern` (per user+weekday) and `availability_exception` (per user+date), both RLS-scoped so staff read/write only their own rows and managers all in the business. The resolution rule (exception ?? pattern ?? default-available, then ∩ trading hours) lives in **one** pure function — `src/lib/domain/availability.ts` — used by the staff screen, the manager grid, and (later) roster warnings/solver, per TECH_STACK §7; it is deliberately not duplicated in SQL. Availability times are wall-clock `time`, so windows never drift across DST (unit-tested). A shared `AvailabilityEditor` component serves both the staff "My availability" screen (`me/availability`) and the manager's edit-on-behalf modal (`admin/availability` team grid), so the manager can maintain availability for staff who never open the app (M3 §2). "Not set" is badged everywhere (screen + grid + a manager warning banner). New tests: 10 resolver unit tests (incl. DST) + 7 availability-RLS tests → 37 total.

### AD-11 — M2 (Team) rewired to the new model; app layer un-frozen
The app's data/UI layer was rebuilt onto the re-baselined schema. `database.types.ts` is now hand-maintained for the M1/M2 schema (regenerate from the CLI after the next push/reset). New domain types (`TeamMember`/`Role`/`Location`/`Business`), `mappers.ts`, and a Team-focused `store.tsx` (auth + business/roles/locations/team + CRUD: add/update/deactivate/invite/updateOwnContact) replace the old localStorage-era shapes. The Team list + `TeamMemberModal` (multi-role, level, employment, home location, hour limits, manager toggle, progressive disclosure), and the staff `me/profile` (read-only role/level/pay + editable own contact) are built. `app_user.is_manager` drives the manager/staff access split; `user_role` isolation is tested. The 60-second "name + mobile" add path is honoured (everything else defaults). Screens depending on rosters/costs (dashboard, schedule, costs, staff shift home) are **stubbed** until M4/M5. Deleted the now-obsolete `selectors.ts`, `ShiftModal`, `EmployeeModal`, and shift/cost helpers in `utils.ts`. `invite` marks `invite_status='invited'`; SMS delivery lands with M9. 20 isolation/auth tests pass.

### AD-10 — Schema re-baselined toward the `updated_requirements/` modular spec
The `updated_requirements/` folder (TECH_STACK + MODULE_01..11) is now the authoritative spec; it expands well beyond this file (adds an OR-Tools solver service, week templates, availability pattern/exception, roster_position, richer notifications, audit). With no production/real data yet, the migrations were **re-baselined** (rewritten cleanly, not additive ALTERs). Where AD-1..AD-9 conflict with the modules, the modules win. First slice built: the **M1 foundation + tenancy spine** — `0001_init.sql` (business config, location, role, trading_hours, scheduling_rule, break_rule, app_user with `is_manager`/`level`/multi-role, user_role), `0002_rls.sql` (RLS per M11 §4.1: settings manager-only, reference data member-readable, wage-privacy on app_user, staff-self-edit guard), `0003_auth_link.sql`. Key corrections vs the old schema: `is_manager` boolean (not a role enum), `primary_role_id` + `user_role` (not free-text `position`), `employment_type` underscores, timezone/rules/levels per business. The isolation suite was rewritten to the Module 11 §6 case numbering (18 tests). `roster`/`shift`/`availability`/`notification` are deferred to their modules (M4/M5, M3, M9) in their correct shape. **Deferred rewire:** the app TS layer (store/mappers/auth/pages) and generated `database.types.ts` still target the pre-rebaseline schema and are rewired starting at M2; regenerate types after the next `db push`/`db reset`.

### AD-9 — Store swapped to Supabase behind the same interface (adapter + mappers)
`src/lib/store.tsx` is now Supabase-backed but keeps the `useStore()` shape and the `RosterData`/`Employee`/`Shift` UI types, so pages and pure selectors are unchanged (the spec's core task: replace the store, not the UI). `src/lib/mappers.ts` translates DB rows ↔ UI types (`pay_rate`↔`hourlyRate`, `active`↔`isActive`, `colour`↔`accent`, `home_location_id`↔location name, DB `time` "HH:MM:SS"↔"HH:MM"). Mutations write to Supabase (RLS enforces manager-only) then reload the affected slice — DB is the source of truth (optimistic UI with rollback is a later refinement, rule 6). Auth session drives `session.role` (manager→admin, staff→employee); the login screen is phone→OTP. Added `app_user.position` (migration 0004) for the job-role/title the UI shows, distinct from the manager/staff access role. The old localStorage seed (`src/lib/seed.ts`) was deleted as dead code.

### AD-8 — Location dropdowns still use a constant (dynamic per-tenant = follow-up)
`LocationName` is now `string` and the store maps location id↔name from the tenant's DB `location` rows. The Team/Shift dropdowns still read the `LOCATIONS` constant (Al Tazah's two sites) for now; making them fully dynamic per tenant (so Guildford's locations render) is a small, isolated follow-up. Acceptable interim because v1 targets one primary customer and the spec scopes multi-location as later (§1.2).

### AD-7 — User↔staff match via a SECURITY DEFINER RPC
Managers pre-create staff (`app_user`) with a phone and NULL `auth_user_id`. RLS forbids an authenticated user from writing a row that isn't yet theirs, so first-login linking runs through `public.link_current_user()` (`supabase/migrations/0003_auth_link.sql`): it matches the caller's **verified** `auth.users.phone` to an unclaimed, active staff record and claims it. Idempotent, refuses unknown phones, and never crosses tenants. Phones are stored as E.164 digits without "+" to match Supabase's `auth.users.phone`.
