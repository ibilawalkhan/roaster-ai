# CLAUDE.md — Rosterly Project Guide

Context and rules for Claude Code in this repository. The full spec — platform model, features, data model, delivery plan — lives in **REQUIREMENTS.md**. Read it before implementing anything non-trivial. When spec and code disagree, the spec wins; if the spec is wrong, update it in the same PR.

## What this is

Rosterly is a **multi-tenant SaaS** for restaurant shift scheduling, shift-swapping, and labour-cost estimates. Many restaurants share one codebase and one database, each fully isolated. It has real paying customers (Al Tazah; a Guildford restaurant) — this is production software people depend on, not a prototype. Correctness and not-breaking-in-production outrank feature count and speed.

## Owner context

- Solo developer, 2-week deadline to first real launch
- Existing codebase is a Next.js front-end prototype using a localStorage store behind `src/lib/store.tsx`; the core task is replacing that store with Supabase behind the same interface — NOT rewriting the UI
- Every choice must be interview-defensible; when you make an architectural decision, note it briefly in REQUIREMENTS.md

## Tech stack (fixed — do not substitute)

- **Frontend:** existing Next.js (App Router) + React + TypeScript + Tailwind. Reuse it. Do not rewrite the UI or restyle.
- **Backend:** **Supabase** — Postgres + Auth (phone OTP) + Realtime + Row-Level Security + Edge Functions + cron. No separate API server.
- **Notifications:** in-app via Supabase Realtime; out-of-app via a Supabase Edge Function calling **Twilio** (SMS), behind one `notify()` module.
- **Validation:** **Zod** on the client; Postgres constraints/checks as the backstop.
- **Monitoring:** **Sentry** wired from the first deploy.
- **Hosting:** Vercel (frontend) + Supabase (managed). Push-to-main deploys.

## THE non-negotiable rules

1. **Tenant isolation is sacred.** Every table has `business_id`. Every query and every RLS policy filters by it. There is an automated test (`tenant isolation`) that logs in as business A and asserts it cannot read business B's rows or any other user's wage — this test must exist and pass. Never write a query that could cross tenants. RLS in the database is the real boundary; hiding UI is NOT security.
2. **Server-side authorization on every mutation.** Never trust the client. The DB (RLS + policies) is the final gate.
3. **The shift-swap approval is a critical section.** Approving a claim runs in ONE transaction that re-checks the shift is still `OPEN`/`CLAIMED_PENDING`, reassigns it, and rejects other claims. Concurrent approvals: exactly one wins. There is a concurrency test for this. Implement the state machine in REQUIREMENTS.md §5.3 exactly — including every edge case (no-claim-before-start stays with dropper and alerts manager; withdraw only before approval; direct assign).
4. **Never silently lose a shift.** A shift is always owned by someone or explicitly flagged to the manager. No path leaves it ownerless without a notification.
5. **Costs are ESTIMATES, never payroll.** `hours = end − start − break; cost = hours × pay_rate`, computed in selectors, never stored as truth. The estimate disclaimer (REQUIREMENTS.md §0) renders on every screen showing a dollar figure. Do not add award/penalty-rate logic — it is deliberately out of scope for legal reasons.
6. **Every screen has loading and error states.** A failed write shows a retry, never a blank/frozen page or silent loss. Optimistic UI must roll back visibly on failure.
7. **Notifications are best-effort and logged.** A failed SMS/realtime push writes a `notification` row with `delivery_status` and never crashes the action that triggered it.
8. **Timezones:** store UTC, render Australia/Sydney. Test around a DST change.
9. **Migrations forward-only, tested on staging** before production. Never edit an applied migration. Never develop against the customer's live data — use the staging Supabase project.
10. **Scope discipline.** Only build what's tagged **[MVP]** in REQUIREMENTS.md for the 2-week launch. [V1.1]/[LATER] items are notes, not code. If behind, follow the §11 cut-list. Never cut: auth/RLS + isolation test, the disclaimer, the swap approve step, error states, Sentry, backups.

## Data model

Exactly REQUIREMENTS.md §10. All key/tenant logic lives in one data-access layer (extend the existing `src/lib/store.tsx` interface); no raw `business_id` string-building scattered through components. Index the hot paths listed in §8 from the first migration.

## Commands

```bash
npm run dev            # Next.js dev
npm run lint
npm run typecheck
npm run test           # includes the tenant-isolation + swap-concurrency tests
supabase db diff / supabase migration new   # schema changes (versioned)
```

Run lint + typecheck + test before declaring any task done.

## Code style

- TypeScript strict; no `any` without an inline justification
- Thin components; data access and business logic in `src/lib/` so they're testable without the UI
- Australian English in user-facing strings (roster, organise, colour)
- Conventional commits (`feat:`, `fix:`, `infra:`, `test:`, `chore:`); small reviewable commits

## Definition of done (any task)

- [ ] lint + typecheck + tests pass
- [ ] tenant-isolation invariant not weakened (and its test still passes)
- [ ] any cost/pay figure carries the disclaimer
- [ ] loading + error states present for any new screen or async action
- [ ] REQUIREMENTS.md updated if data model, features, or architecture changed
- [ ] no TODOs without a linked issue
