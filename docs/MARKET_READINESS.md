# Rosterly — Market Readiness Review

**Role:** Devil's Advocate (adversarial pre-launch review)
**Date:** 2026-07-28
**Branch:** `dev` @ `b673502`
**Verdict:** **NO-GO.** Do not onboard a paying customer against this build.
**Scope:** read-only. No code, tests or migrations were modified by this review.

---

## 0. What was actually run (not claimed — run)

> **The repository changed underneath this review.** Between the first and last command below, M10 (costs reporting) and most of the M9 (notifications) machinery were written into the working tree. Every finding below was **re-verified against the tree as of 13:25**, and the two findings that changed materially (LB-2, LB-9) are marked. Test counts moved from 327 → **367** during the review for the same reason. Treat this document as a snapshot, and re-run the probes in §4 before acting on it.

| Check | Result |
|---|---|
| `npx vitest run` | **367 passed / 20 files** (was 327/19 at review start). Genuinely green. |
| `npx tsc --noEmit` | Clean, exit 0. |
| `npx eslint` | Clean, exit 0. |
| `cd solver && .venv/Scripts/python.exe -m pytest tests -q` | **2 failed / 98 passed** — not one, as briefed. |

The two solver failures:

- `solver/tests/test_scale_and_dst.py:208` — `test_target_scale_solves_in_under_two_seconds`: **8.71 s** against a 2.0 s budget. This is the known one, but see LB-8: 4.4× over budget is not a tuning nit.
- `solver/tests/test_scale_and_dst.py:219` — `test_lambda_direct_invocation`: `handler(req) != solve(req)`, differing on `stats`. This one is **not** in the brief. It is almost certainly `solve_seconds` wall-clock jitter, but nobody has confirmed that, and it is the only test that asserts the Lambda entry point and the Flask entry point agree — i.e. the only guard on the exact seam that is undeployed and unverified. A permanently-red test on that seam is a test nobody reads.

Five further defects below were **proved empirically**, not inferred: I wrote a throwaway probe suite against the real migrations in PGlite, ran it, recorded the output, and deleted it. Working tree is unchanged (`git status` verified).

### First, the thing that is not a code problem at all

**The entire M8 swap feature — the most important, most dangerous module in the product — is uncommitted.**

```
?? src/lib/domain/swaps.ts
?? src/lib/supabase/swaps.ts
?? src/app/admin/swaps/page.tsx
?? src/app/me/open-shifts/page.tsx
?? supabase/migrations/0011_open_shift_visibility.sql
?? tests/db/open-shift-visibility.test.ts
?? tests/domain/swaps.test.ts
?? solver/README.md
```
Plus 9 modified tracked files. A solo developer with a day job, on a Windows laptop, with no backup, is one `git clean -fd`, one disk failure or one bad merge away from losing the whole swap module *and* the migration that makes it reachable. Commit before reading any further.

---

## 1. LAUNCH BLOCKERS

Ordered by how badly each one ends.

---

### LB-1 — The service-role key is stored under a `NEXT_PUBLIC_` name, pointing at a live project

**File:** `.env` line 3.

```
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJ…   (221 chars — a real JWT)
```

The Supabase **service_role** key bypasses Row-Level Security entirely. `NEXT_PUBLIC_` is Next.js's explicit marker for "inline this into the JavaScript sent to every browser."

Mitigating facts, stated fairly: `.env` is git-ignored (`.gitignore:39`) and `git log --all -- .env` confirms it was **never committed**; and no code currently reads that identifier — `src/lib/env.ts:19,45` correctly reads the un-prefixed `SUPABASE_SERVICE_ROLE_KEY`. So the key is not in today's bundle.

That is not reassurance, it is luck. The failure modes are all one step away:

1. Anyone (including a future you, or an AI assistant pattern-matching on the surrounding vars) writes `process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` once, and `next build` welds an RLS-bypassing key into a public JS asset on Vercel's CDN.
2. The var name gets copy-pasted into the Vercel dashboard — which is exactly what a developer does when moving from local to prod — and the same thing happens.
3. It is in `.env`, not `.env.local`. Next.js loads `.env` in **production** builds too, so this is not a dev-only file.

**Consequence:** total collapse of tenant isolation. Every business's roster, every staff member's phone number, every wage, readable and writable by anyone who opens DevTools. That is a notifiable data breach under the Privacy Act 1988 (Cth), and the end of the business.

Also note what this file proves: the project ref is real and the anon key is real. The briefing said "no live Supabase project in this environment." There is one, and development has been happening against it. If that project is the one Al Tazah will use, CLAUDE.md rule 9 ("never develop against the customer's live data") is already broken.

**Fix:** rotate the service_role key in the Supabase dashboard **today** (assume it is burned), rename to `SUPABASE_SERVICE_ROLE_KEY`, move to `.env.local`, and confirm no `NEXT_PUBLIC_*` var anywhere holds a secret.

---

### LB-2 — Nothing actually sends a notification. `notify()` is not called from a single business action.

> **Changed during review.** At review start there was no `notify()` module at all. `src/lib/notify/{events,policy,index}.ts`, `src/lib/supabase/notifications.ts` and `src/app/api/notify/route.ts` were written mid-review. The conclusion is **materially unchanged**, for the reasons below.

**Files:** `src/lib/notify/index.ts:246` (`notify()`), `src/app/api/notify/route.ts`, `supabase/migrations/0008_notifications.sql`.

**The decisive fact:** `grep -rn "notify(" src/app src/lib/supabase` (excluding `src/lib/notify` itself) finds **no call sites at all** — only three comments mentioning the name. The publish action does not call it. `requestDrop` does not call it. `openShiftToTeam` does not call it. `approveClaim` does not call it. The machinery is built to a good standard and **nothing pulls the trigger**.

**Proved empirically** (probe re-run against the current tree): counted `public.notification` rows, called `request_drop()` as a staff member, counted again. **3 → 3.** No row written. That is still true today.

Three further gaps that survive even once the call sites are wired:

1. **It is not the transactional outbox `0008` claims.** `0008_notifications.sql:7-15` says *"the business action writes its data AND a `notification` row in the SAME transaction — both or neither."* It does not. `grep "insert into public.notification" supabase/migrations/` returns nothing; rows are inserted by an HTTP round trip to `/api/notify` **after** the action commits. To its considerable credit, `route.ts:26-34` says so explicitly and names the failure mode as a lost notification rather than a lost action. But that means the migration's header comment currently misdescribes the system, and a chef's drop request whose `notify()` call fails leaves the manager permanently uninformed — with **no sweeper to replay it** (see 3).
2. **There is still no SMS.** No `supabase/functions/`, no Twilio integration. Delivery is Realtime in-app only (`src/lib/supabase/notifications.ts:159`), which reaches only someone who **already has the app open**. For the scenario that matters — a manager on the pass who has not opened a browser since Wednesday — in-app-only delivery is close to no delivery.
3. **There is no worker, and no cron.** `grep -rn "cron" supabase/ src/` → nothing. `notification.status='pending'` and `scheduled_for` (quiet-hours deferral) both presuppose something that sweeps due rows. Nothing does. Anything queued behind quiet hours is queued forever, and the retry/backoff behaviour promised by `0008:13-14` and BUILD_PLAN.md:146 does not exist.

**Also note the collision with LB-1:** `route.ts:79-84` calls `serverEnv()`, which requires `SUPABASE_SERVICE_ROLE_KEY`. `.env` defines that key under the **`NEXT_PUBLIC_`-prefixed** name instead, so `serverEnv()` throws and the route returns `503 "Notifications are not configured."` As configured today, the notification path fails closed on the first request.

What this means operationally, in plain words:

- A chef drops a shift. **The manager is not told.** Not by SMS, not by push, not by an in-app badge. The `drop_requested` row sits in the database until the manager happens to navigate to `/admin/swaps`.
- The manager opens a shift to the team. **No staff member is told.** They would have to independently decide to open `/me/open-shifts` and pull to refresh.
- The manager approves a claim. **The winner is not told they are now working Friday night.** The loser is not told. The dropper is not told they are off the hook.

REQUIREMENTS.md §5.3's acceptance criterion — *"all four parties get the correct notification"* — has a score of zero out of four. This is not "M9 in progress." M9 is a `CREATE TABLE` statement and a paragraph of aspirational commentary.

**Consequence:** the differentiating feature does not function. The customer's actual current process (a flurry of WhatsApp messages) is strictly better than this, because WhatsApp notifies people.

---

### LB-3 — Only the first person can ever claim an open shift. "Two claim, manager picks" is impossible.

**Files:** `supabase/migrations/0011_open_shift_visibility.sql:51-58`, `supabase/migrations/0007_swaps.sql:189-191`, `src/lib/supabase/swaps.ts:163`.

**Proved empirically.** Probe output:

```
PROBE before claim, A2 sees rows: 1  [{ status: 'open' }]
PROBE shift status after first claim: { status: 'claimed_pending' }
PROBE after first claim, A2 sees rows: 0        ← locked out
```

The mechanism, exactly:

1. `0011:51-58` widens `shift_select` for non-managers to include *only* `status = 'open'`.
2. `0007:189-191` — the **first** claim flips the shift to `claimed_pending`.
3. That status now matches neither branch of the policy, so the shift vanishes from every other staff member's `SELECT`.
4. `src/lib/supabase/swaps.ts:163` queries `.in("status", ["open", "claimed_pending"])` — the author clearly *intended* claimed_pending to remain visible. RLS silently strips those rows. The query and the policy disagree, and the policy wins quietly.

This directly contradicts three documents:
- REQUIREMENTS.md §5.3: *"Simultaneous claims → all recorded; manager still chooses"* and *"drop → open → two claim → approve one"*.
- MODULE_08 §3.3: *"Multiple people may claim; all claims are recorded with timestamps."*
- BUILD_PLAN.md:157 (item J DoD): *"Concurrent approvals → exactly one winner."*

The `approve_claim` critical section is beautifully built to arbitrate between competing claims — and in production it will never see more than one, because the UI can only ever surface one. The manager's careful "pick the best-suited person" screen is decoration over a first-tap-wins lottery.

**Worse, for the claimant:** the first claimer also loses visibility of their own shift. `src/app/me/open-shifts/page.tsx:214` sets local state so the card reads "Requested — waiting for manager," but that is client memory only. On refresh, `load()` re-fetches, RLS returns nothing, and the screen shows **"No shifts are listed right now."** There is no claim record anywhere else in the staff app — `src/app/me/page.tsx` has zero references to claims. A staff member who volunteered for Friday night has, from their phone's point of view, no evidence they ever did.

**Why the test suite missed it:** `tests/db/open-shift-visibility.test.ts` asserts "staff A2 can now see the OPEN shift" — the happy path only. `tests/db/swap-concurrency.test.ts` seeds two claims *directly via SQL as the DB owner* (`tests/db/harness.ts:297-304`), bypassing RLS entirely. No test ever asks a **second staff member** to see and claim a shift a first one has already claimed. That is the exact scenario the module exists for, and it is the one path never exercised end-to-end.

---

### LB-4 — Sentry is not wired. You will not know anything broke.

`grep -rn "sentry" src/ package.json` returns exactly one hit: a code **comment** at `src/lib/supabase/swaps.ts:51` ("The original Postgres/PostgREST error, for Sentry"). No `@sentry/nextjs` in `package.json`. No config files. No DSN in use.

Compounding it: there is **no error boundary anywhere** — `find src/app -name "error.tsx" -o -name "global-error.tsx"` returns nothing. Individual screens do handle their own fetch failures well (`/me/open-shifts` has real loading/error/retry states — credit where due), but any uncaught render error in a client component produces Next.js's production white screen, *"Application error: a client-side exception has occurred."*

CLAUDE.md rule 10 and REQUIREMENTS §11 both list Sentry under **"Never cut."** It was cut. BUILD_PLAN.md:33 lists Sentry as item **A** — "start now, first thing" — and it is the one item on the whole plan that was never started.

**Consequence:** at 7pm Friday a manager sees a white screen. They phone the owner. The owner phones the developer. The developer has no stack trace, no breadcrumb, no user ID, no idea. The only debugging tool is "can you describe what you tapped?"

---

### LB-5 — The database does not check who is allowed to claim a shift

**File:** `supabase/migrations/0007_swaps.sql:144-199` (`claim_shift`).

**Proved empirically:** staff member A2, whose only role is **Front of House**, called `claim_shift()` on a **Kitchen** shift. It succeeded and recorded a pending claim.

`claim_shift` checks authentication, tenancy and shift status. It checks **nothing** about the claimant: not role, not location, not whether they are deactivated, not whether they are the dropper. All of that lives in `src/app/me/open-shifts/page.tsx:188-205`, in the browser, in JavaScript the user controls.

`0011:24-33` argues this is deliberate — re-implementing eligibility in SQL would create a second copy that drifts. That reasoning is sound for the *visibility list*. It does not extend to the *write*. Right now the policy is "any authenticated employee of the business may register a claim on any open shift by calling one public RPC," and the anon key needed to do it is in the page source by design.

BUILD_PLAN.md:165 (item K DoD) explicitly requires: *"staff-claims-ineligible denied."* It is not denied, and no test asserts it.

Mitigation, stated fairly: the manager is still the gate, and `approve_claim` is protected by the `0010` overlap trigger, so this cannot by itself put the wrong person on a shift. The realistic harm is the manager's approval screen filling with claims from people who cannot do the job, and a dishwasher being able to spam every open shift. It is a rule-2 violation ("never trust the client; the DB is the final gate"), not an immediate breach.

---

### LB-6 — Direct reassignment orphans pending claims forever

**Files:** `src/app/admin/swaps/page.tsx:465-477`, `src/lib/supabase/roster-edit.ts:149-175`.

The manager's fourth option, "Reassign directly" (MODULE_08 §3.2), calls `reassignShift()`. That function issues a bare `UPDATE shift SET assigned_user_id=…, status='assigned'`. It does **not**:

- reject the outstanding `shift_claim` rows (contrast `cancel_open_shift`, `0011:251-254`, which correctly does);
- guard on the current status (contrast every other transition, which uses `FOR UPDATE` + a status re-check). It is a blind write. A reassign racing an `approve_claim` is a genuine last-write-wins race on the one table where that matters;
- write a `shift_swap_event` row, so the swap audit trail — which `0011` was written specifically to complete — still has a hole exactly where a human overrode the system.

**The scenario:** two people offered to cover Friday. The manager, in a hurry, ignores both and reassigns to a third person. Both volunteers' claims stay `outcome='pending'`. Their phones keep saying *"Requested — waiting for manager"* forever. Nobody tells them the shift is gone (see LB-2 — nobody tells them anything). One of them turns up on Friday believing they might be on.

This is precisely the class of failure MODULE_08 §1 names as the invariant that matters most: ambiguity about who is responsible.

---

### LB-7 — `request_drop` has no cutoff, no past-shift guard, and no published-roster check

**File:** `supabase/migrations/0007_swaps.sql:89-137`.

Three things proved empirically:

- A staff member dropped a shift dated **2020-01-01**, long finished. Returned `drop_requested`.
- The same call works on a shift starting in ten minutes. The 4-hour cutoff (MODULE_08 §3.1, MVP-tagged) exists **only** in the browser, at `src/lib/domain/swaps.ts:43` + `src/app/me/shifts/[id]/page.tsx:68`.
- A staff member dropped a shift belonging to a **DRAFT** roster (`shiftDraftA`) — a roster RLS deliberately hides from staff. `request_drop` is `SECURITY DEFINER` and never checks `roster.status`, so it happily mutates the manager's unpublished planning. (Low exploitability: the staff member cannot read the shift's ID through normal channels. But a `SECURITY DEFINER` function that bypasses the very visibility rule its own policy enforces is a bug waiting to be reachable.)

Note `src/lib/domain/swaps.ts:36-42` is honest about the seam ("there is no column for it yet"). Honesty in a comment is not enforcement. `DEFAULT_DROP_CUTOFF_HOURS` is a client-side suggestion.

---

### LB-8 — The solver is 4.4× over its own performance budget, and is not deployed

`solver/tests/test_scale_and_dst.py:208` — target-scale solve (30 staff × ~200 positions) takes **8.71 s** against the 2.0 s budget in BUILD_PLAN.md:107 and MODULE_05.

This is not a vanity metric. The default time limit is 15 s and the ceiling is 30 s (SOLVER_CONTRACT). 8.71 s is measured on a developer laptop. AWS Lambda gives you CPU proportional to configured memory, and OR-Tools CP-SAT is CPU-bound and multi-threaded. On a modestly-sized Lambda, plus a container **cold start** pulling an OR-Tools image (hundreds of MB), the realistic first-call latency is well past 15 s — meaning the very first roster generation a new customer ever attempts is the one most likely to time out.

The degradation path is genuinely well built (`src/lib/solver/client.ts` turns every failure into one typed `SolverUnavailableError` and the seeded roster survives), so this fails safe. But "fails safe" means the manager builds the fortnight by hand, which is the product's headline feature not working on first use.

And it is **not deployed at all**: `NEXT_PUBLIC_SOLVER_URL` is blank in `.env.example`, absent from `.env`. There is a `Dockerfile` and a `lambda_handler.py`; there is no evidence either has ever run on AWS. The app↔Lambda round trip is 100% unverified.

**Additionally — the solver has no authentication.** `solver/app/server.py:26` and `lambda_handler.py:34` accept any POST. `src/lib/solver/client.ts:190` reads `NEXT_PUBLIC_SOLVER_URL` — a **public** variable — and calls it **from the browser**. If this ships on a Lambda Function URL, the endpoint is in the page source and anyone on the internet can invoke 15–30 seconds of CP-SAT compute per request, unauthenticated, unratelimited, billed to the developer. That is a trivially weaponisable cost-amplification attack.

---

### LB-9 — There is no payment enforcement, and the dashboard tells the customer the product is unfinished

> **Partially resolved during review.** M10 was a 21-line placeholder at review start; a full costs screen (`src/app/admin/costs/page.tsx`, plus `src/lib/domain/cost-reports.ts`, `src/lib/supabase/cost-reports.ts` and 
`tests/domain/cost-reports.test.ts`) landed mid-review. Spot-checked: it renders `COST_DISCLAIMER` in **six** places including a prominent header banner, has real loading/error/retry states, and routes all arithmetic through the shared `cost.ts` primitives. That sub-finding is **withdrawn**. It has not been reviewed in depth and has never run against a real database.

- **Enforcement:** REQUIREMENTS §1.1 states a `suspended` business's manager "sees a 'contact us about your account' block instead of the app — **this is the entire payment-enforcement mechanism for now**." `grep -rn "subscription_status\|suspended"` across `src/` finds it in `mappers.ts:21`, `types.ts:21` and generated types — **and nowhere else**. It is never read, never checked, never gates anything. The entire commercial mechanism of this business does not exist. A customer who stops paying keeps full access indefinitely.
- **The dashboard ships developer scaffolding to the customer.** `src/app/admin/page.tsx:35-42` — the first screen a restaurant owner sees after logging in — still reads: *"You're in the rebuild"*, *"Roster — coming next module"*, *"The week template, auto-scheduler, roster review and labour-cost reporting arrive in the next modules."* It also hardcodes `Locations` to `value={0}`. This is now also simply **false** — the template, roster review and cost reporting all exist. You cannot charge a subscription for a page that tells the customer the product isn't finished, and you certainly cannot ship one that undersells what you did build.

---

## 2. The "Friday dinner rush" test

The real operational path, step by step, with the failure named at each step.

**Wednesday — the manager publishes the fortnight roster.**
Works, provided the manager built it by hand. If they press "generate," the solver is not deployed (LB-8), so `NEXT_PUBLIC_SOLVER_URL` is blank and `solver/client.ts` returns "couldn't generate right now — try again or build manually." Correct, graceful, and not what was sold.
→ **Publishing notifies nobody** (LB-2). No "roster is out" SMS, no in-app push. Staff learn the roster exists by being told verbally, or by opening the app on spec. MODULE_09 E1 does not fire.

**Thursday — a new staff member tries to log in for the first time.**
`invite` sets `invite_status='invited'` and stops there (AD-11: "SMS delivery lands with M9"). Nothing is sent. The manager must verbally tell each person the URL. Then phone-OTP requires the **Supabase Auth** SMS provider to be configured and funded on the hosted project — `supabase/config.toml:59-63` holds dummy local credentials with an explicit note that real SMS is configured "per-environment via the dashboard." Unverified. **If that is not configured and paid for on the day, nobody can log in at all** — not staff, not the manager. This is the single hardest dependency in the product and there is no evidence it has ever been exercised against a hosted project.
→ Also: `config.toml:44,52` sets `enable_signup = true` for both SMS and email. On a hosted project this is an open door: anyone can request OTPs to arbitrary numbers and burn the owner's SMS spend. They get no data (`current_business_id()` returns NULL for an unlinked auth user, so RLS denies everything — that part is correct and well designed), but they cost money.

**Friday 16:00 — the chef drops his shift.**
He opens `/me/shifts/[id]`, taps "I can't make this shift." The cutoff logic is right and the copy is excellent — *"You're still rostered until your manager confirms"* is genuinely the correct sentence and it is repeated in every non-assigned state (`src/lib/domain/swaps.ts:32`). The DB records `drop_requested`.
→ **The manager is not notified** (LB-2). Nothing buzzes. Nothing appears. The chef assumes the system has told the manager. The manager is on the pass and has not opened a browser since Wednesday.

**Friday 16:20 — the manager, by luck, opens `/admin/swaps`.**
The queue renders. This screen is good work: four transitions, shared `checkEligibility`, senior-coverage delta computed before/after, warning-gated confirm. He taps "Open to team."
→ **No eligible staff member is notified** (LB-2). The shift is now visible on a screen nobody has been prompted to open.

**Friday 17:00 — a kitchen hand happens to open the app.**
She sees the shift, taps "I can cover this." The RPC is idempotent, the copy is right.
→ **The shift now vanishes from every other staff member's phone** (LB-3), including anyone better suited. The manager's careful comparison screen will show exactly one candidate.
→ **She also loses her own record of it.** Her card says "Requested — waiting for manager" in React state; the moment she backgrounds the app or the tab reloads, the shift is gone from the list and nothing in `/me` shows a pending claim. She has no way to know her offer stands.
→ **The manager is not notified she claimed** (LB-2).

**Friday 17:40 — the manager, on a phone, in a loud kitchen, with wet hands.**
He must remember to re-open `/admin/swaps` and refresh. If he does, approval works: `approve_claim` (`0007:222-293`) is genuinely correct — row lock, status re-check, atomic winner/loser, audit row. This is the best code in the repository.
→ **Nobody is told the outcome.** Not the winner ("you're on tonight"), not the dropper ("covered by X"), not the losing claimants. All four notifications in REQUIREMENTS §5.3's acceptance criterion are absent.
→ If instead he ignores both claims and reassigns directly, the claims are orphaned `pending` forever (LB-6).

**Friday 18:00 — nobody claimed and the shift is 2 hours away.**
MODULE_08 §7 requires an alert to the manager at a 12-hour lead. `isUncoveredSoon()` exists (`src/lib/domain/swaps.ts:144`) but it only styles a row on a page. There is **no pg_cron job, no scheduled Edge Function, no worker at all** (`grep -rn "cron" supabase/ src/` → nothing). Nothing runs unless a human has a browser open.
→ The dropper does remain `assigned_user_id`, so the shift is never technically ownerless — that invariant holds, and it holds correctly. But CLAUDE.md rule 4's second half — *"or explicitly flagged to the manager"* — depends on a notification that cannot be sent.

**Friday 19:30 — something throws.**
White screen (LB-4). No error boundary, no Sentry event, no alert. The developer finds out when the owner phones.

### Undeployed infrastructure this path depends on

| Dependency | State | Consequence if missing on the night |
|---|---|---|
| Sentry | **Not wired** — one comment, no package | Blind. No diagnosis possible. |
| Twilio / SMS | **Does not exist** — no `supabase/functions/` | No out-of-app alerts at all. |
| `notify()` call sites | **Zero.** Module built, never invoked | Nothing is sent even though the sender exists. |
| Supabase Realtime | Subscribe code exists (`notifications.ts:159`); nothing publishes to it | Reaches only users already in the app. |
| Notification worker / sweeper | **Does not exist** | Quiet-hours-deferred rows never send; no retries. |
| Supabase Auth SMS provider | Dummy creds in `config.toml`; hosted config unverified | **Nobody can log in.** |
| pg_cron / scheduled function | **Does not exist** | No uncovered-shift alert, no batching, no retries. |
| OR-Tools solver on Lambda | **Not deployed**; 4.4× over budget; unauthenticated | Manual rostering only; open cost-amplification if deployed as-is. |
| Live Supabase (staging) | Real keys exist in `.env` — but staging≠prod separation unproven | Migrations never applied outside PGlite. |
| Backups | **Never configured or mentioned outside a checklist** | Unrecoverable data loss. |
| Uptime ping / health check | **No API routes at all** in `src/app` | Customer tells you it's down. |

---

## 3. Legal / commercial exposure

### The disclaimer — verified by grep, not assumed

Nine files render money via `formatMoney`. Four import `COST_DISCLAIMER`. The gap:

| File | Figure shown | Disclaimer? |
|---|---|---|
| `src/app/admin/schedule/grid.tsx:280,357,367` | Per-person / per-day / total cost | ✅ line 378 |
| `src/app/admin/schedule/panels.tsx:219,242` | Roster health cost | ✅ line 245 |
| `src/app/admin/schedule/modals.tsx:839` | Est. cost | ✅ line 841 |
| `src/app/admin/template/page.tsx:362` | Est. weekly cost | ✅ lines 364, 460 |
| `src/app/me/page.tsx:257` | Staff estimated pay | ✅ `STAFF_PAY_DISCLAIMER` line 262 |
| `src/app/me/shifts/[id]/page.tsx:254` | Per-shift estimated pay | ✅ line 257 |
| `src/app/me/profile/page.tsx:62,67` | Own pay rate | ✅ line 71 (bespoke wording) |
| `src/components/TeamMemberModal.tsx:235` | Pay-rate input | ✅ "For labour-cost estimates only — not payroll." |
| **`src/app/admin/employees/page.tsx:116`** | **Every staff member's hourly rate, on the Team list** | ❌ **NONE** |

**One genuine miss.** `employees/page.tsx` imports `formatMoney` (line 15) and no disclaimer constant. It renders `<Metric label="Rate" value={formatMoney(m.payRate)} />` for every employee. CLAUDE.md rule 5 and REQUIREMENTS §12 both say *every* screen showing a dollar figure. This is a small fix and should be made before launch, not because a rate card is likely to be mistaken for payroll, but because "we put the disclaimer everywhere" must be literally true when a dispute happens.

Also: `src/app/me/profile/page.tsx:67` contains `formatMoney(me.payRate).replace("$", "$")` — a no-op replacing `$` with `$`. Harmless, but it is the fingerprint of a half-finished edit on the one screen where a staff member reads their own wage. Worth a look.

Credit: the disclaimer discipline is otherwise better than most products at this stage. The staff-facing wording is separately authored (`my-roster.ts:60`) rather than reusing the manager's, which is the right instinct. And the "never award pay" boundary is held consistently — `cost.ts` is `hours × base rate` and nothing else, with no penalty-rate logic anywhere.

### Australian privacy

The product stores, for every employee of every customer: full name, **mobile number**, email, employment type, **pay rate**, availability patterns, and a complete record of when they worked and when they said they couldn't. That is personal information under the Privacy Act 1988 (Cth), and the availability data in particular ("unavailable every Tuesday", "unavailable 14 March") can reveal a great deal about a person's life.

What exists: excellent technical protection. Wage privacy is enforced structurally (staff read only their own `app_user` row), `colleagues_on_shift` (`0011:71-124`) is a model of minimal disclosure — name and role only, caller must be on the shift, published rosters only, returns silently across a tenant boundary rather than confirming existence. That is careful, thoughtful work.

What does not exist:

- **No privacy policy or collection notice.** Staff are added by their manager and receive no statement of what is collected, why, who can see it, or how to correct it. APP 5 requires notification at collection.
- **No consent path for SMS.** The plan is to text employees' personal mobiles. That needs to be disclosed. (Also relevant to the Spam Act for anything that drifts toward promotional.)
- **No deletion or retention policy.** `active=false` preserves history by design (correct for rostering) but there is no answer to "an ex-employee has asked you to delete their number."
- **No data-export path**, despite REQUIREMENTS §12 listing *"Manual data export possible (no lock-in / no loss risk)"* as a before-you-take-money item. There is no CSV export anywhere in `src/`.
- **No breach-response plan**, which the NDB scheme effectively assumes.
- MODULE_11:160 acknowledges this exactly once: *"Australian privacy obligations grow with the business; revisit with a lawyer as customer count grows."* Deferring is defensible for a hobby project. It is not defensible when you are the data processor for two restaurants' entire workforces and taking money for it.

### Things the product could be read as claiming but cannot do

1. **`solver/README.md`** (untracked, but the file that would go in front of anyone technical): *"Rosterly will never produce an invalid roster — nobody double-booked, over their hours, or working when unavailable."* Two problems. The solver is not deployed, so today it produces nothing. And "never" is only true of solver output — the manual edit path deliberately *warns rather than blocks* on hours, rest and availability (AD-14, by design and correctly so). Only the overlap block is enforced in the DB (`0010`). A customer reading "never" and then seeing a roster that puts someone over their hours will feel misled.
2. **Auto-scheduling.** The dashboard, the nav and the module docs all promise an auto-scheduler. It is unreachable in the current deployment.
3. **Labour-cost reporting.** `/admin/costs` is a placeholder (LB-9).
4. **Notifications.** Any sales conversation that mentions "your staff get notified" is currently false in every particular.
5. **REQUIREMENTS §12's written-agreement item is unticked** — there is no scope agreement covering what it does, what it does not, price, who pays for SMS, or data export. Do not take money before that exists, independent of the code.

---

## 4. Data-loss and correctness risks

### Where a shift could silently become nobody's

Genuinely well handled, and I tried to break it. The dropper stays `assigned_user_id` through `drop_requested`, `open` and `claimed_pending` (`0011:198-200` is explicit about why). `cancel_open_shift` reverts and rejects claims in one transaction. `approve_claim` reassigns atomically. **I could not construct a path that leaves `assigned_user_id` NULL on a live shift.** Rule 4's first half holds.

Rule 4's second half does not: *"or explicitly flagged to the manager."* The flag is a CSS class on a page (LB-2, LB-7). Nobody is ever told.

### Where two people could believe they have the same shift

This is the real exposure, and it is not in the database — the DB is correct.

1. **Orphaned pending claims after a direct reassign** (LB-6). Two volunteers' phones say "waiting for manager" indefinitely while a third person actually has the shift. This is the closest thing to "two people believe they're on," and it is reachable through the normal UI in three taps.
2. **The dropper's belief.** Mitigated better than anywhere else in the product — `STILL_ROSTERED_NOTICE` is a shared constant repeated in every non-assigned state (`swaps.ts:32`, rendered at `me/shifts/[id]:373,392,427`). Genuinely the right design.
3. **The claimant's belief, in reverse.** Because of LB-3 the claimant loses all evidence of their claim on refresh. They may reasonably conclude their offer didn't register, tell the manager verbally, and the manager — who was never notified either — may reassign to someone else. Both then think they're on.

### Where a tenant could see another's data

The tenancy spine is the strongest part of this codebase and I want to be clear about that. `0002_rls.sql:16-32` — three `SECURITY DEFINER` helpers, correctly avoiding self-referential-policy recursion. RLS enabled on every table. Every new table ships policies in the same migration. The isolation suite genuinely tests cross-tenant read **and** write (`WITH CHECK`), staff-reads-draft-roster denial, wage privacy, append-only audit, and unforgeable notifications. `colleagues_on_shift` returns silently rather than erroring across a tenant boundary, which avoids even existence disclosure.

The one realistic cross-tenant risk is **not** in the policies — it is LB-1. The service_role key bypasses all of it, and it is currently named as though it belongs in the browser.

Secondary risk: `src/lib/supabase/database.types.ts` is **hand-maintained** (BUILD_PLAN.md:187 flags this itself). Types that drift from the real schema are how a query silently selects a column that no longer means what the code thinks. Regenerate from the CLI at the first real `db push` and diff it.

### Do the tests prove the invariants, or assert happy paths?

Mostly they prove things. This is a serious suite, and the PGlite approach (AD-2) is a good decision — real Postgres, real unmodified migrations, no Docker, fast enough to actually run. The swap-concurrency suite launches genuinely concurrent approvals and asserts exactly one winner, no claims left pending, exactly one audit event. That is real.

But there are three specific holes, and they are all in the same place:

1. **The second claimant is never tested** (LB-3). `harness.ts:297-304` seeds two claims *as the database owner*, bypassing RLS. Every concurrency test then starts from a state the application can never reach. The suite proves `approve_claim` arbitrates correctly between two claims; it never proves two claims can exist.
2. **Eligibility on claim is never tested** (LB-5), despite BUILD_PLAN.md:165 requiring "staff-claims-ineligible denied."
3. **`reassignShift` has no test at all** (LB-6) — not for the claim cleanup it omits, not for the status race, not for the missing audit row.

The pattern: every test asserts the transition the author was thinking about. None asserts what a second, competing human does at the same moment. That is exactly the class of bug the module exists to prevent.

---

## 5. Solo-operator reality

**What pages you at 9pm on a Saturday:**

Nothing does. That is the finding. There is no Sentry (LB-4), no uptime ping, and no health endpoint — `src/app/api` now contains exactly one route, `/api/notify`, and nothing that answers "are you alive?". There is no alerting of any kind. Every failure mode is discovered by a restaurant owner phoning you mid-service. You will always be the last to know, and you will always be diagnosing from a verbal description.

**What is unrecoverable:**

- **Backups are not configured.** The only mention of the word in the entire repository is in a cut-list that says never to cut it (`BUILD_PLAN.md:224`). Supabase's free tier does not include point-in-time recovery. If a migration goes wrong on the live project, or someone runs `db reset` against the wrong ref, **Al Tazah's roster is gone with no recovery path**, and there is no export feature (§3) to reconstruct from.
- **The uncommitted working tree** (§0). The entire M8 module and migration `0011` exist only on one laptop's disk.
- **`.env` holds live credentials** for what appears to be a real project (LB-1), on a development machine, with the RLS-bypass key mislabelled as public.

**What will consume your evenings:**

- Manually creating each business and manager via the Supabase dashboard (by design — §1.4 — but it is unbudgeted time and it involves hand-editing production data at 9pm).
- Manually chasing every drop/claim/approval, because nothing notifies anyone (LB-2). Until M9 ships, *you* are the notification layer.
- Manually policing payment, because `subscription_status` gates nothing (LB-9).
- Being the only person who can interpret a failure, because there is no observability.

**The honest structural risk:** this codebase is well-architected for a team. `src/lib/domain/` is pure and testable, the data layer is thin, the migrations are disciplined and forward-only, and the commentary is unusually good. But a solo operator with a day job cannot be the pager, the on-call, the notification system and the billing system simultaneously. The gap between "the code is good" and "the service is operable" is where this launch fails.

---

## 6. What is honestly NOT ready vs. what the build log claims

### AD-1 … AD-15

| AD | Claim | Verified? |
|---|---|---|
| AD-1 | RLS + SECURITY DEFINER helpers, wage privacy, guard trigger | ✅ Verified in PGlite. Solid. |
| AD-2 | PGlite runs unmodified migrations, no Docker | ✅ Verified — 327 tests, 8.9 s. Good call. |
| AD-3 | Instants UTC, shift times wall-clock, render Sydney | ✅ Static + DST unit tests. ⚠️ Never rendered by a real browser in a real tz. |
| AD-4 | Controlled vocabularies as enums | ✅ Verified. |
| AD-5 | Vitest; forward-only migrations | ✅ Verified. `0010` correctly drops/re-adds a CHECK rather than editing `0009`. |
| AD-6 | Client-side auth, RLS as the boundary | ⚠️ Defensible *only* while no secret carries a `NEXT_PUBLIC_` name. See LB-1. |
| AD-7 | `link_current_user()` idempotent, refuses unknown phones | ✅ Tested. Never run against real Supabase Auth. |
| AD-8 | Location dropdowns use a constant | Superseded. |
| AD-9 | Store swapped to Supabase | Superseded by AD-10/11. |
| AD-10 | Schema re-baselined; *"no production/real data yet"* | ⚠️ `.env` holds a live project ref and real keys. Re-baselining is only safe while that stays true. |
| AD-11 | M2 Team rewired; **`database.types.ts` hand-maintained** | ⚠️ Self-declared drift risk, still unresolved. |
| AD-12 | M3 one shared availability resolver | ✅ Verified, incl. DST. |
| AD-13 | Roster is a COPY; solver call always degrades | ✅ Degradation verified statically. ⚠️ Round trip never executed. |
| AD-14 | One shared eligibility fn; block-vs-warn as a data property; *"blocks enforced in UI/solver, not by a DB constraint"* | ✅ Design verified. The named gap was then closed for **overlap only** by `0010`. Role/location/inactive blocks are still UI-only (LB-5). |
| AD-15 | M8: app calls the RPCs, never re-implements them | ✅ True and correct. ⚠️ **The AD is stale in three places**: it says the open-shifts list "returns nothing until a SECURITY DEFINER RPC exposes open shifts" and that the manager transitions "leave no swap-event row" — `0011` fixed both. And `src/lib/supabase/swaps.ts:363-383` still routes `withdrawDrop` through the old plain-UPDATE path (`setShiftStatus`) even though `0011`'s `cancel_open_shift` implements staff self-withdrawal properly (`0011:232-239`). Dead code plus a comment that now misdescribes the system. |

### Module acceptance criteria vs. reality

| Module | Claimed | Actual |
|---|---|---|
| M1 Settings | Built | Settings UI + tabs exist. Not verified against a real DB. |
| M2 Team | Built | Built. ❌ Missing disclaimer on the rate column. |
| M3 Availability | Built | Built and tested. |
| M4 Week template | Built | Built, with feasibility panel + disclaimer. Good. |
| M5 Solver | Built | ❌ **Not deployed. 4.4× over budget. Unauthenticated. Round trip never executed.** |
| M6 Draft/publish | Built | Built. Change log + warnings verified. |
| M7 Staff app | Built | Built. ❌ No pending-claim visibility (LB-3). |
| M8 Swaps | Built | Core RPCs excellent. ❌ LB-3, LB-5, LB-6, LB-7. ❌ Uncommitted. |
| M9 Notifications | "in progress" | ⚠️ **Sender built mid-review; zero call sites; not transactional; no SMS; no sweeper.** Nothing is sent. (LB-2) |
| M10 Costs | "in progress" | ✅ **Landed mid-review.** Disclaimer in 6 places, shared primitives, loading/error states. Not reviewed in depth; never run against a real DB. |
| M11 Auth/tenancy | Built | Strongest module. ⚠️ Never run against hosted Supabase Auth. |

### Verified only statically — needs a real end-to-end run

BUILD_PLAN.md:190-194 lists four gates and is honest that none is satisfiable in this environment. All four remain unsatisfied. Concretely, **none of the following has ever executed once**:

1. A real phone-OTP login against hosted Supabase Auth with a real SMS.
2. Migrations applied to a real Supabase project (only PGlite, which lacks `btree_gist` — see `0010:33-47`, a trade-off honestly documented).
3. The isolation suite run against real Supabase rather than PGlite.
4. A single solver HTTP round trip from the app.
5. A Realtime subscription (none exists).
6. Any SMS via Twilio (no Edge Function exists).
7. Any Sentry event.
8. Any backup or restore.
9. Any DST-boundary render in a real browser in `Australia/Sydney`. The arithmetic is unit-tested; `Intl` behaviour in a real runtime is not.

---

## 7. Verdict and the shortest credible path

### **NO-GO.**

Not because the engineering is bad. It is, in places, better than it needs to be — the RLS design, the `approve_claim` critical section, the shared-domain-logic discipline, the PGlite test harness, and the plain-English copy in the staff app are all genuinely good, and the commentary in the migrations is better than most commercial codebases. Someone has thought hard about the right things.

It is a NO-GO because the **product** is not operable:

- Nothing notifies anyone, so the headline feature is a screen nobody is told to open.
- Only one person can ever claim a shift, so the swap flow is a lottery, not a workflow.
- There is no observability, so the first production failure is undiagnosable.
- There are no backups, so the first production accident is unrecoverable.
- The RLS-bypass key is named as though it belongs in the browser.
- The dashboard tells the customer the product isn't finished, and the costs page agrees with it.

REQUIREMENTS §12 — *"Before you take money"* — has **eight** checkboxes. By my count **two** are met (the isolation test; the swap concurrency test). Do not take money.

### Shortest credible path to onboarding customer #1

**Stop-the-bleeding (do today, ~1 hour)**
1. `git add -A && git commit`. The whole M8 module and migration `0011` exist on one disk. *(Per your standing preference, you run the commit — I have not.)*
2. Rotate the service_role key in the Supabase dashboard. Rename to `SUPABASE_SERVICE_ROLE_KEY`. Move to `.env.local`. (LB-1)

**Tier 1 — genuinely non-negotiable (~4–5 days)**
3. **Sentry.** `@sentry/nextjs`, DSN, plus `src/app/global-error.tsx` and a per-route `error.tsx`. It is item A on your own plan and the one thing that makes every later problem survivable. (LB-4)
4. **Fix the second-claimant lockout.** One-line policy change in a new migration `0012`: widen the staff branch of `shift_select` to `status IN ('open','claimed_pending')`. Then write the test that would have caught it — *a second staff member sees and claims a shift a first one already claimed.* (LB-3)
5. **Surface pending claims in `/me`.** A claimant must be able to see their live offer after a refresh. (LB-3)
6. **Wire up the notifications you just built.** The sender exists and is good; it has **zero call sites**. Call `notify()` from publish, `requestDrop`, `openShiftToTeam` and `approveClaim`. Then either (a) move the inserts into the SECURITY DEFINER RPCs so `0008`'s transactional-outbox claim becomes true, or (b) correct `0008`'s header comment to describe what was actually built. Do not leave a migration asserting a guarantee the system does not provide. **And get one real SMS path working** — in-app-only reaches nobody who isn't already looking at the app, which is precisely the person who needs telling. (LB-2)
7. **Fix `reassignShift`:** reject pending claims, guard on status, write the swap event. (LB-6)
8. **Backups.** Confirm the Supabase plan tier includes daily backups; take a manual export before every migration. (§5)
9. **Disclaimer on `employees/page.tsx:116`.** Five minutes. (§3)

**Tier 2 — before the customer sees it (~2–3 days)**
10. **Rewrite `/admin`** so the first screen a paying customer sees does not say *"You're in the rebuild"* and *"coming next module"* — copy that is now also factually wrong, since the template, roster and costs screens all exist. Fix the hardcoded `Locations: 0` while you are there. (LB-9)
11. **Move the cutoff and eligibility checks server-side**, or accept and document that they are advisory. (LB-5, LB-7)
12. **Gate on `subscription_status`.** Ten lines in `store.tsx`. It is your entire commercial mechanism. (LB-9)
13. **The written scope agreement** (REQUIREMENTS §12) + a collection notice for staff. Do not take money without these. (§3)

**Tier 3 — the gate you cannot skip (~1–2 days)**
14. **A real staging Supabase project.** Apply all migrations forward-only. Run the isolation suite against real Postgres, not PGlite. Confirm Auth SMS is configured and funded — **this is the dependency that decides whether anyone can log in at all**.
15. **A full manual end-to-end run on two physical phones**, on staging: manager publishes → chef drops → two staff both claim → manager approves one → verify all four parties' screens. Cross a DST boundary while you are there.
16. **Then decide about the solver.** It is not on the critical path — the degradation story is good and manual rostering works. Launch without it rather than launch with an unauthenticated, over-budget, never-round-tripped Lambda. If you do deploy it, put auth in front of it first (LB-8).

**Realistic estimate: 8–11 working days** before a paying customer should touch this — and that is with M9 deliberately reduced to in-app-only and the solver deliberately descoped. That is not a criticism of the pace; it is what the remaining list costs.

**Never cut, from your own rules, and currently cut:** Sentry, backups, the estimate disclaimer (one screen), and a swap approve step that a second person can actually participate in.

---

## Appendix — what is genuinely good

Stated briefly, because it is true and because a review that only finds fault is not trustworthy.

- **`0002_rls.sql`** — the `SECURITY DEFINER` context-helper pattern is the correct solution to self-referential policy recursion, and wage privacy enforced by row scope (rather than an impossible column-level rule) is exactly right.
- **`0007_swaps.sql:222-293`** — `approve_claim` is textbook. Lock, re-check under the lock, single-statement winner/loser resolution, audit row. It does what CLAUDE.md rule 3 demands, and the concurrency test proves it.
- **`0010_shift_integrity.sql`** — the trigger-instead-of-exclusion-constraint decision, with an advisory transaction lock keyed on the person, and the explicit choice to raise SQLSTATE `23P01` so callers need not know which mechanism is in force. The reasoning about testability under PGlite is exactly the trade-off a senior engineer should make and document.
- **`0011:71-124`** — `colleagues_on_shift` is a model of minimal disclosure.
- **`src/lib/domain/`** — pure, dependency-free, genuinely unit-testable. One shared availability resolver, one shared eligibility function, one shared cost function. This is the thing that stops two screens disagreeing, and it was done properly.
- **`STILL_ROSTERED_NOTICE`** — identifying the single most damaging misunderstanding in the product and pinning it to a shared constant repeated in every relevant state is genuinely excellent product thinking.
- **The error copy throughout `swaps.ts`** — "Sorry, this shift has already been filled" instead of a Postgres exception. Every failure carries a `kind` so screens can react rather than merely apologise.
- **AD-15's own honesty about its seams.** Most build logs oversell. This one names its gaps. That the log has since gone stale in three places is a maintenance issue, not a credibility one.
