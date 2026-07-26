# Rosterly — Master Build Plan

**Owner:** Product Manager (strict)
**Status:** authoritative sequencing for the remaining MVP build
**Governing docs:** `updated_requirements/TECH_STACK.md` + `MODULE_01..11` (spec, wins on conflict), `CLAUDE.md` (non-negotiable rules), `REQUIREMENTS.md §14` (build log AD-1..AD-12).

This plan covers **only the remaining work**. It does not re-plan anything already shipped.

---

## 0. Where we are (done — do not re-plan)

| Slice | State | Evidence |
|---|---|---|
| **M1 schema + tenancy spine** | Migrations `0001_init` (business/location/role/trading_hours/scheduling_rule/break_rule/app_user + `is_manager`/`level`/multi-role/user_role), `0002_rls`, `0003_auth_link` | AD-1, AD-4, AD-7, AD-10 |
| **M11 auth + RLS core** | Phone-OTP link RPC, `current_business_id()`/`is_manager()` helpers (SECURITY DEFINER), wage-privacy, staff-self-edit guard trigger; isolation suite (20 tests) | AD-1, AD-6, AD-7, AD-11 |
| **M2 Team** | Store/types/mappers rewired to new schema; Team list + `TeamMemberModal`; staff `me/profile` | AD-11 |
| **M3 Availability** | `0004_availability.sql`; one shared resolver `src/lib/domain/availability.ts`; shared `AvailabilityEditor` (staff + manager-on-behalf); DST-safe | AD-12 |
| **Test harness** | Vitest + in-process PGlite (`tests/db/harness.ts`), no Docker/live Supabase; 37 tests green | AD-2, AD-5 |

**Verification reality in this environment:** everything is checked statically — `npx tsc --noEmit`, `npx eslint`, `npx vitest run`. No Docker, no live Supabase, no Lambda. `src/lib/supabase/database.types.ts` is hand-maintained (regenerate from CLI after the next real `db push`/`db reset`).

**Gap flagged now:** the **M1 Settings UI does not exist** — the schema is there, but there is no wizard/settings screen to manage business profile, locations, trading hours, roles, rules, or breaks. This is on the critical path (M4/M5 need trading hours + rules maintained by a human).

---

## 1. Sequenced backlog (strict dependency order)

Dependencies come straight from each module's "Depends on" header. **Legend:** 🔴 critical path · 🟡 parallelisable · ⬛ cross-cutting infra.

| # | Work item | Depends on | Can start when… | Parallel with |
|---|---|---|---|---|
| **A** | ⬛ **Sentry wiring** (not yet wired — TECH_STACK §1, rule 10) | — | now | anything |
| **B** | 🔴 **M1 Settings UI** (wizard + settings tabs over existing schema) | M1 schema (done) | now | A, C |
| **C** | 🟡 **M4 Week Template** (grid, slot CRUD, copy-day, build-from-week, feasibility/supply-vs-demand panel, cost preview) | M1 (rules/trading hours/roles) + M2 (feasibility) | after **B** exposes editable trading hours/rules | A |
| **D** | 🔴 **M5 Solver contract + tables** (`roster`, `roster_position`, `shift`, `solve_run` migration + RLS; request/response TS types; shared **eligibility** fn in `src/lib/domain/`) | M1–M4 | after **C** (template = demand) | E-app-side |
| **E** | 🔴 **M5 Python OR-Tools solver** (model, hard constraints H1–H14, soft penalties, senior-timeline 15-min blocks, diagnostics, determinism/seed) | D (contract) | after **D** contract frozen | can run in parallel with D once contract is agreed |
| **F** | 🔴 **M6 Draft review / publish** (roster grid w/ unfilled cards, health panel, manual edit block-vs-warn, lock&regenerate, publish, change log, `roster_warning`) | M1–M5 | after **D/E** produce a draft | — |
| **G** | 🟡 **M10 Costs & reporting** (shared hours/cost fn, `pay_rate_snapshot`, summary/by-day/by-person/by-role/by-location, filters) | M2 + M4 + M5/M6 shifts | after **F** has shifts (preview slice can start with **C**) | H, I |
| **H** | 🔴 **M7 Staff app** (my shifts hero, shift detail, availability entry, open shifts list, notifications list, profile; offline cache; deep links) | M2, M3, M6 | after **F** publishes | G |
| **I** | 🔴 **M9 Notifications** (transactional outbox `notification`/`notification_batch`, `notify()` module, Realtime in-app, Twilio Edge Function, quiet hours/batching/budget) | M2, M6, M7 | after **F** (publish is first event E1) | G; SMS worker parallel to in-app |
| **J** | 🔴 **M8 Shift swaps** (state machine, drop→claim→approve **single-transaction** critical section, eligibility reuse, concurrency test) | M1–M3, M6, **M9** | after **H** (staff drop UI) + **I** (delivery) | — |
| **K** | ⬛ **Extend isolation suite** per M11 §6 for every new table (D/F/I/J) | each migration | continuous — same PR as each table | every module |

**Critical path:** A → B → C → D → E → F → { H, I } → J. M10 (G) rides alongside F/H. **The swap module (J) is last** because it needs both the staff drop UI (H) and notification delivery (I).

**Parallelism worth exploiting:**
- **A (Sentry)** and **B (Settings UI)** can start immediately and independently.
- Once the **M5 request/response contract (D)** is frozen, the **Python solver (E)** and the **app-side seeding/pre-flight (D)** proceed in parallel — the contract is the interface.
- **M9 in-app (Realtime)** and **M9 SMS (Twilio)** are two senders behind one `notify()`; build in-app first, SMS second.
- **M10** cost selectors can be written and unit-tested (PGlite) before the M6 UI consumes them.

---

## 2. Per-module Definition of Done

Every module inherits the **cross-cutting gate** (§2.0) *and* its own acceptance criteria. A module is not done until every box in both lists is checked.

### 2.0 Cross-cutting gate (applies to EVERY item A–K)
- [ ] `npx tsc --noEmit`, `npx eslint`, `npx vitest run` all clean.
- [ ] **Tenant-isolation test extended** for every new table (cross-tenant read/write denied; within-tenant per M11 §6). Suite still green.
- [ ] **RLS enabled + policies in the SAME migration** that creates any table (M11 §5.2 — a table without policies fails review).
- [ ] Every **$ figure** carries the estimate-not-payroll disclaimer in plain words (rule 5, M10 §0).
- [ ] Every new screen / async action has **loading + error states** with retry; optimistic UI rolls back visibly (rule 6).
- [ ] Shared logic lives in **`src/lib/domain/`** (availability / hours+cost / eligibility) — never duplicated in a component or the solver (TECH_STACK §7).
- [ ] **Australian English** in all user-facing strings (roster, organise, colour).
- [ ] **TypeScript strict; no `any`** without an inline justification comment.
- [ ] Times: store UTC for instants, wall-clock for shift times, render Australia/Sydney (AD-3); DST tested where relevant.
- [ ] `REQUIREMENTS.md §14` gets a new AD entry if data model/architecture changed; `database.types.ts` updated.
- [ ] No TODOs without a linked issue.

### B — M1 Settings UI
- [ ] First-run **wizard**: business → locations → trading hours → roles → rules → done; progress visible, resumable, all steps skippable-with-defaults except locations + trading hours (M1 §4.1).
- [ ] **Settings tabs** for ongoing edits: Business · Locations · Trading hours · Roles · Rules · Breaks (M1 §4.2).
- [ ] Trading hours support normal / closed / overnight (18:00→02:00) / 24-hour days; `closes_at == opens_at` only valid when 24h.
- [ ] Roles seeded with defaults, fully editable; role in use cannot be hard-deleted (deactivate only).
- [ ] Last active location / last manager cannot be deactivated.
- [ ] Impossible rule (e.g. 2 seniors required, 1 employed) warns **at save time**, not at generation.
- [ ] Editing config never alters an already-published roster; "applies to next generation" stated on rule edits.
- [ ] Setup completable in <15 min by a non-technical owner.

### C — M4 Week Template
- [ ] Slot primitive supports overlapping times, overnight windows, 24-hour days — no special modes.
- [ ] Template grid echoes the roster grid; per-day totals (people, hours, est. cost).
- [ ] Slot add/edit; **copy day → other days** (discoverable); **build template from a past week**.
- [ ] Slot outside trading hours is **blocked** with an actionable message; count ≥ 1; role must be active.
- [ ] Uncovered open-hours window **warned** per day with the exact time range named.
- [ ] Senior-coverage feasibility check runs at template time and names the uncovered window.
- [ ] Supply-vs-demand panel: total hours + per-role shortfalls vs current team, live-updating.
- [ ] Weekly cost estimate with disclaimer.
- [ ] Editing the template never alters a generated/published roster (template is copied, not referenced live).

### D — M5 App-side (contract + tables + pre-flight)
- [ ] Migration adds `roster`, `roster_position`, `shift`, `solve_run` with `business_id` + RLS in the same file.
- [ ] Create-roster seeds concrete `roster_position` rows by copying template slots onto real dates.
- [ ] **Pre-flight check** reports blockers before solving (no availability, no eligible staff for a role, senior shortfall, demand > available hours); empty template blocks generation with a pointer to M4.
- [ ] Request built with **pre-resolved availability** via M3's shared resolver; shared **eligibility** fn added to `src/lib/domain/`.
- [ ] Solver call fails gracefully — timeout/down keeps the seeded roster, never hangs the UI, loses no work.
- [ ] Every solve persisted to `solve_run` (request/response/seed/duration) and replayable.

### E — M5 Python OR-Tools solver
- [ ] Hard constraints **H1–H14** provably never violated (automated suite incl. randomised inputs).
- [ ] **Always returns a roster** — shortfalls are penalised slack, not infeasibility; partial weeks come back with reasons.
- [ ] Every unfilled position + coverage gap has human-readable `reason`/`detail` and `closest_candidates` with the first failing constraint.
- [ ] Senior coverage modelled over the **timeline in 15-min blocks** across open hours; handles overlaps, overnight, 24h.
- [ ] Deterministic: same inputs + seed → identical output; seed stored.
- [ ] Time limit default 15s, ceiling 30s; `time_limit_hit` flagged; 30 staff × 200 positions < 2s.
- [ ] A solve request references exactly one business's data.
- [ ] Solver never re-implements availability/eligibility/cost — receives them in the request (TECH_STACK §7).

### F — M6 Draft review / publish
- [ ] Unfilled positions render as explicit "unfilled" cards, never blank cells.
- [ ] Health panel: plain-language what/where, each item clickable → scrolls to its cell, each stating the solver reason.
- [ ] Manual edit re-checks rules within ~200ms; totals + panel update live.
- [ ] **Block** physically-impossible edits (overlap, deactivated staff); **warn-but-allow** policy violations (availability, hours, rest, consecutive days, senior gap) — each names who/when/which rule and persists as a visible flag.
- [ ] Lock & regenerate preserves pinned shifts exactly; warns before overwriting unlocked manual edits.
- [ ] Publish with gaps allowed but gaps stated at commit; draft vs published state unmistakable.
- [ ] Post-publish edits notify affected staff (M9) + write to `roster_change_log`; `roster_warning` persists overrides.
- [ ] Failed save rolls back visibly — no phantom assignments.

### G — M10 Costs & reporting
- [ ] **One shared** hours/cost fn (`src/lib/domain/`) used by grid, reports, template preview, staff app — they can never disagree.
- [ ] `pay_rate_snapshot` captured at assignment/reassignment; rate change affects future shifts only (stated on save).
- [ ] Round only at display; totals from unrounded values (column = sum of shown rows).
- [ ] Summary, by-day, by-person, by-role, by-location — all reconcile to the same period total.
- [ ] Overnight shifts attribute to start date; DST → real elapsed hours.
- [ ] Roster with unfilled positions shows the unfilled count beside cost.
- [ ] Location + period filters consistent across every view.
- [ ] **No staff member** can read any cost view or another's figures (isolation test).

### H — M7 Staff app
- [ ] "When do I work next?" answerable within 3s of a cold open; next-shift hero is unmissable.
- [ ] Phone+OTP login only; sessions persist for weeks; SMS deep links land on the exact screen (incl. after login when signed out).
- [ ] Only **published** rosters visible; drafts unreachable at the DB level.
- [ ] Staff cannot read anyone else's rate/hours/availability; colleagues show **name + job role only** (isolation test from M7 §4 table).
- [ ] Last-loaded roster readable offline with a visible "updated N ago" timestamp.
- [ ] No action reports success unless the server confirmed it (no false-optimistic drops).
- [ ] Overnight shifts state both days; every screen has a designed empty state.
- [ ] One-handed: tap targets ≥ 44px, primary actions thumb-reachable.

### I — M9 Notifications
- [ ] Every notification is in the §2 catalogue (E1–E16); nothing sends outside it.
- [ ] Notification row written in the **same transaction** as the triggering action (transactional outbox); forced SMS failure leaves the action intact.
- [ ] Drop requests (E6) reach **manager only** — test asserts no staff notification row created.
- [ ] Shift-opened (E8) reaches only M8-eligible staff.
- [ ] Failed deliveries retry 3× with backoff, end in a visible failed state, never silently lost.
- [ ] Quiet hours (22:00–07:00 business tz) suppress non-urgent SMS; E10/E13 override; stale queued messages discarded not sent.
- [ ] Claims batched per shift; publish = one SMS per staff member (not per shift); per-person daily cap + per-business budget degrade to in-app.
- [ ] Realtime subscriptions scoped per `business_id` + `user_id` (no global firehose); isolation test passes.
- [ ] `notify()` is the single channel-agnostic module; service-role key server-side only.

### J — M8 Shift swaps
- [ ] State machine implemented **exactly** as M8 §2 (ASSIGNED → DROP_REQUESTED → OPEN → CLAIMED_PENDING → ASSIGNED, plus decline/reassign/cancel/withdraw/uncovered-alert).
- [ ] Drop notifies **manager only**; dropper UI states "you're still rostered until your manager confirms."
- [ ] All four manager paths (decline / reassign / open / defer) work and notify correctly.
- [ ] Only eligible staff see/claim an open shift (reuse the shared eligibility fn — H1/H2/H3/H9/H10/H13).
- [ ] **Approval = single DB transaction**: re-read status, re-validate claimant against hard constraints, assign, mark winner approved + others rejected, write change log. Concurrent approvals → exactly one winner; loser sees a clear message. **Concurrency test exists and passes.**
- [ ] Claiming is idempotent (double-tap = one claim); claiming a filled shift → "already filled".
- [ ] All four parties notified on approval; senior-coverage-breaking approval warns first.
- [ ] Uncovered shift approaching start alerts the manager; **a shift is never ownerless** without notification (rule 4).
- [ ] Every transition recorded in `shift_swap_event` with actor + timestamp.

### K — Isolation suite (continuous)
- [ ] For each new table (roster/position/shift/solve_run, change_log/warning, notification/batch, shift_claim/swap_event): cross-tenant read + write denied; own-scope rules per M11 §6.
- [ ] Staff-reads-draft-roster denied; staff-reads-cost denied; staff-claims-ineligible denied; staff self-escalation to manager denied.

---

## 3. Cross-cutting industry checklist (PM enforces at every module review)

| Concern | What "pass" looks like |
|---|---|
| **Accessibility** | Tap targets ≥ 44px (staff app especially); every input has a label; sufficient colour contrast; keyboard-navigable manager screens; role colour never the *only* signal. |
| **Observability** | Sentry captures client + Edge Function + solver-bridge errors. **Not wired yet — item A, first thing.** Every caught failure (SMS, solve timeout, save conflict) is logged, not swallowed. |
| **Timezone / DST** | Instants UTC, shift times wall-clock, render Sydney (AD-3). At least one test crosses a DST boundary per module touching durations (M5, M6, M10, M9 quiet hours). |
| **Optimistic-UI rollback** | Any optimistic update rolls back visibly on failure; staff-app never shows false success (M7 §5). |
| **Idempotency** | Claims idempotent under double-tap/retry (M8 §5); notification de-dup within 60s (M9 §4); link-current-user RPC idempotent (AD-7). |
| **Graceful degradation** | Solver down → keep seeded roster; Twilio down → in-app unaffected; SMS budget hit → in-app only. No feature hard-fails on a dependency outage. |
| **Determinism / replayability** | Solver seed stored; every `solve_run` replayable as a regression test. |

---

## 4. Environment constraints & risks

### Constraints in THIS build environment
- **No Docker, no live Supabase, no AWS.** All verification is **static**: `tsc --noEmit`, `eslint`, `vitest` against **PGlite** (real Postgres in WASM applying the unmodified migrations). This proves schema/RLS/domain logic — it does **not** prove Realtime, Auth OTP, Edge Functions, Twilio, or the Lambda solver end-to-end.
- **`database.types.ts` is hand-maintained** — must be regenerated from the Supabase CLI after the next real `db push`/`db reset`; drift here is a silent-bug source.
- **The Python OR-Tools solver cannot be deployed or invoked here.** It can be written and unit-tested locally, but the app↔Lambda round-trip is unverified until deployed.

### Required gates before "market ready" (NOT satisfiable in this environment)
1. **Full end-to-end run on the user's machine** against a real Supabase **staging** project: phone-OTP login, publish, Realtime in-app notification, a real Twilio SMS with a working deep link.
2. **Solver deployed to AWS Lambda** (container image) and driven through the real request/response contract, including cold-start behaviour and the timeout path.
3. **Migrations applied to staging** (forward-only) and the isolation suite run against real Supabase, not just PGlite.
4. **Sentry receiving events** from a real deploy.

### Top risks (PM watch-list)
1. **Solver integration is the biggest unknown** — two languages, a network hop, cold starts, and a contract that both sides must honour exactly. It is on the critical path and cannot be exercised in this environment. *Mitigation:* freeze the request/response contract (item D) before writing E; build the app-side degradation path first so the product is usable manually even if the solver is late or down.
2. **The swap approval critical section (M8 §5)** — a race here double-books a real person on a real shift. It sits at the end of the chain (needs M9), so schedule pressure lands exactly where correctness matters most. *Mitigation:* the single-transaction approval + its concurrency test are non-cuttable (CLAUDE.md rule 3, rule 10); write the concurrency test against PGlite early, before the UI.
3. **RLS gaps on the new tables (roster/shift/notification/claim) + the hand-maintained types drifting from the real DB** — either can silently leak one tenant's data or one staff member's wage. *Mitigation:* enforce "RLS + isolation test in the same PR as the table" (item K, rule 1); regenerate `database.types.ts` from the CLI at the first real push and diff it.

---

## 5. Explicitly NOT in scope / NEVER (carried from the spec)

**NEVER (permanent, legal/design):**
- Award interpretation, penalty/overtime/casual-loading, superannuation, tax — costs are `hours × base rate`, estimates only (M10 §0, rule 5).
- Payroll, payslips, timesheets (M7 §9, M10 §10).
- **Clock-in / clock-out** — rostered ≠ worked; no "rostered vs actual" (M7 §9, M10 §3.7).
- Self-serve business signup — you create businesses manually (M1 §8, M11 §11).
- LLM/AI-generated rosters — cannot guarantee hard constraints (M5 §12, TECH_STACK §4).
- Direct staff-to-staff swaps without manager approval — the manager is the gate (M8 §9).
- Auto-publish without manager approval (M5 §12).

**LATER / V1.1 (design the data model, do not build now):**
- Named/multiple templates, demand forecasting, seasonal switching (M4 §9).
- "Show another option" regenerate, multi-week optimisation (M5 §12).
- Roster diff/version compare, second-manager approval, PDF/print export (M6 §8).
- Read receipts ("who saw the roster"), WhatsApp/email channels, true web-push/PWA, native apps (M7/M9).
- Labour-as-%-of-sales, planned-vs-actual, CSV export, "recalculate with new rates" (M10 §3.6/§3.7/§6/§2.1).
- Supervisor role, multi-business users, SSO, "sign out everywhere", in-app platform admin (M11 §11).
- Public holiday calendar, per-location rule overrides (M1 §8).
- Bulk sickness reporting, shift bidding/seniority allocation (M8 §9).

**Cut-list order if behind (REQUIREMENTS §11 discipline) — NEVER cut:** auth/RLS + isolation test, the estimate disclaimer, the swap approve step, error states, Sentry, backups.
