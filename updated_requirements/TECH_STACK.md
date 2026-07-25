# Rosterly — Tech Stack

**Status:** decided
**Applies to:** the full rebuild (multi-tenant platform, M1–M12)
**Governing constraint:** ship to a paying customer fast, then operate it **solo** while working a day job. Every choice below is optimised for *low operational surface*, not for résumé flash.

---

## 1. The stack at a glance

| Layer | Choice | Version target |
|---|---|---|
| Frontend framework | **Next.js (App Router)** | 15+ |
| Language | **TypeScript** (strict) | 5.x |
| Styling | **Tailwind CSS** | v4 |
| UI hosting | **Vercel** | — |
| Database | **Supabase Postgres** | 16 |
| Auth | **Supabase Auth** (phone OTP) | — |
| Realtime | **Supabase Realtime** | — |
| Authorisation | **Postgres Row-Level Security** | — |
| Migrations | **Supabase CLI migrations** | — |
| Validation | **Zod** | 3.x |
| Scheduler engine | **Python 3.12 + Google OR-Tools (CP-SAT)** | ortools 9.x |
| Scheduler hosting | **AWS Lambda** (container image) | — |
| SMS | **Twilio**, called from a Supabase Edge Function | — |
| Background jobs | **Supabase cron / scheduled Edge Functions** | — |
| Error monitoring | **Sentry** | — |
| Uptime check | External ping (free monitor, or the Pulse project) | — |
| Analytics (optional) | Vercel Analytics or PostHog free tier | — |

**Three deploy targets total:** Vercel (app), Supabase (managed — nothing to deploy), AWS Lambda (solver).

---

## 2. Architecture

```
                    ┌──────────────────────────────┐
  Manager (laptop)  │                              │
  Staff (phone)  ──►│   Next.js app on Vercel      │
                    │   (SSR + client, TS, Tailwind)│
                    └───────┬──────────────┬────────┘
                            │              │
            Supabase client │              │ POST /solve (JSON)
              (RLS-enforced)│              ▼
                            │      ┌────────────────────────┐
                            │      │  Scheduler service      │
                            │      │  AWS Lambda (container) │
                            │      │  Python + OR-Tools      │
                            │      │  stateless              │
                            │      └────────────────────────┘
                            ▼
        ┌───────────────────────────────────────────┐
        │ Supabase                                   │
        │  · Postgres (all data, RLS per business)   │
        │  · Auth (phone OTP)                        │
        │  · Realtime (in-app notifications)         │
        │  · Edge Functions (notify worker → Twilio) │
        │  · cron (uncovered-shift checks)           │
        └───────────────────────────────────────────┘
                            │
                            ▼
                    Twilio (SMS deep links)
```

---

## 3. Decisions and rationale

### 3.1 Next.js + TypeScript + Tailwind on Vercel
- Already the prototype's stack — no relearning, and the existing grid, cost views and team screens carry over.
- Push-to-main deploys, automatic HTTPS/CDN, preview environments per PR. No servers to patch.
- TypeScript strict mode catches a whole class of production bugs before they reach a restaurant.
- **Trade-off:** vendor lock-in to Vercel's build/hosting. Acceptable — the app is portable Next.js and could move to any Node host.

### 3.2 Supabase for database, auth, realtime and authorisation
The single biggest decision, and the one that makes a two-week backend possible.

- **One managed service replaces four** (Postgres + auth + websockets + policy engine). For a solo operator, every service avoided is an outage you don't have to debug at 9pm.
- **Row-Level Security is the reason, not a bonus.** M11's tenant isolation is enforced *in the database*. Any other stack would leave isolation to application code, where one forgotten `WHERE business_id = ...` leaks one restaurant's payroll to another. RLS makes the guarantee structural.
- **Phone-OTP auth out of the box** — the right login for restaurant staff (M11 §3).
- Postgres is battle-tested and scales far past this product's ceiling.
- **Trade-off:** heavy dependency on one vendor. Mitigated by the fact that the data lives in plain Postgres and is exportable at any time (SERVICE_AGREEMENT.md §6).

### 3.3 Python + OR-Tools on AWS Lambda for the solver
- **CP-SAT has no serious JavaScript equivalent.** The auto-scheduler (M5) needs a real constraint solver to guarantee hard constraints; approximating it in TypeScript would forfeit the entire promise of the feature.
- A **separate stateless service** is correct design regardless of language: independently testable, replayable against saved inputs as regression tests, tunable without touching the app (M5 §3).
- **Lambda container image** because the OR-Tools dependency is too large for a zip layer. Scales to zero, costs nothing between solves.
- **Trade-off:** two languages and a cold-start penalty (~1–3s on first invoke). Acceptable: solves happen a handful of times a week per customer, and a manager already expects "generating…" to take a moment.

### 3.4 Twilio for SMS, behind one module
- Notifications are channel-agnostic by design (M9 §3). Twilio sits behind a single `notify()` module, so adding WhatsApp or swapping providers later is a new sender, not a redesign.
- Called from a **Supabase Edge Function** so credentials never touch the client and delivery runs server-side off the transactional outbox.

### 3.5 Sentry from the first deploy
Non-negotiable for a product real businesses depend on. You will not be watching the screen when it breaks at Friday dinner service; Sentry is how you find out before the owner calls.

---

## 4. Deliberately NOT used

Each of these will be tempting. Each is the wrong call for this product.

| Not using | Why |
|---|---|
| A separate backend API server (NestJS/Express) | Supabase + Next.js server actions cover it. A third tier doubles the deploy and auth surface for no gain. |
| Kubernetes / Docker Swarm / microservices | One app, one solver. Container orchestration here is résumé-driven design; Pulse already demonstrates that skill. |
| Redis, a message broker, GraphQL | Postgres and Supabase Realtime handle M9 comfortably at this scale. Add infrastructure when a measured bottleneck demands it. |
| React Native / native mobile apps | M7 is deliberately a web app opened from an SMS deep link — no app stores, no review cycles, no second codebase. |
| PWA push notifications | Service workers + VAPID + unreliable iOS behaviour. Deep-linked SMS delivers the same outcome (M9 §10). |
| Rewriting the solver in TypeScript | No usable CP-SAT equivalent. Two languages is the correct trade. |
| An ORM layer beyond Supabase's client | Extra abstraction over a schema that's already explicit; RLS is expressed in SQL anyway. |
| An LLM for scheduling | Cannot guarantee hard constraints — the entire value of M5 (see M5 §12). |

---

## 5. Environments

| Environment | App | Database | Solver |
|---|---|---|---|
| **Local** | `next dev` | Supabase local or a dev project | Lambda dev URL, or run the Python service locally |
| **Staging** | Vercel preview (per PR) | Separate Supabase **staging** project | Separate Lambda alias |
| **Production** | Vercel production | Supabase **production** project | Lambda production alias |

**Rule:** never develop against the customer's live data (REQUIREMENTS.md §9). Staging exists so migrations are tested before they touch a real restaurant's roster.

---

## 6. Repository layout

```
rosterly/
├── CLAUDE.md                    # build rules for Claude Code
├── docs/                        # REQUIREMENTS.md, MODULE_01..12, DESIGN_BRIEF.md
├── app/                         # Next.js App Router
│   ├── (manager)/               # dashboard, schedule, template, team, availability, costs
│   ├── (staff)/                 # my shifts, shift detail, open shifts, availability, profile
│   └── api/                     # server actions / route handlers
├── components/
├── lib/
│   ├── supabase/                # typed client, queries
│   ├── domain/                  # cost + hours calc, availability resolution, eligibility
│   │                            #   ⚠ single source of truth — see §7
│   └── notify/                  # channel-agnostic notification module
├── supabase/
│   ├── migrations/              # versioned schema
│   ├── policies/                # RLS, commented per policy
│   ├── functions/               # Edge Functions (notify worker, solver bridge)
│   └── seed/                    # two-business seed for isolation tests
├── solver/                      # Python + OR-Tools service
│   ├── app/ (model.py, constraints.py, diagnostics.py)
│   ├── tests/
│   └── Dockerfile
└── tests/
    ├── isolation/               # M11 §6 suite — mandatory
    ├── scheduler/               # hard-constraint verification (M5)
    └── e2e/
```

---

## 7. Shared-logic rule (applies across the stack)

Three calculations must exist in **exactly one place** each, and be used by every screen and service:

1. **Availability resolution** (pattern + exception ∩ trading hours) — M3 §6
2. **Hours and cost** (paid hours, rate snapshot, rounding) — M10 §2
3. **Eligibility** (can this person work this position) — M5 §5.1 / M8 §4

Duplicating any of these across app and solver guarantees they drift, producing the worst class of bug: the scheduler and the UI disagreeing about the same shift. Where the solver needs them, the app computes and passes them in the request (M5 §4) — the solver never re-implements them.

---

## 8. Running costs (indicative, per month)

| Service | Free tier covers | Beyond |
|---|---|---|
| Vercel | Hobby: this app comfortably | ~$20/mo Pro if needed |
| Supabase | Free tier: 1–3 restaurants | ~$25/mo Pro (backups, larger DB) |
| AWS Lambda | Effectively free at this volume | cents |
| Twilio SMS | — | ~cents per message; capped per business (M9 §5) |
| Sentry | Free tier | — |

**Realistic:** roughly $0–50/month total until you have several paying customers. Price the subscription with SMS cost passed through per the service agreement.

---

## 9. Migration from the existing prototype

**Keep:** the roster grid, cost views, team screens, component structure, and the store *interface* — they work and represent real effort.
**Replace:** the localStorage store implementation with Supabase queries behind that same interface.
**Add (genuinely new):** Supabase schema + RLS, phone-OTP auth, the week template (M4), the solver service (M5), the swap state machine (M8), the notification layer (M9).

Rebuilding the frontend from zero is mostly waste. A visual redesign is styling and component structure, not logic.

---

## 10. Why this stack is the right interview answer too

The reasoning is itself the story: *"Supabase because the binding constraint was shipping in two weeks and operating it solo — RLS gave me database-enforced multi-tenancy rather than trusting application code. Python on Lambda for the solver because OR-Tools is Python-only and isolating it made the scheduling engine independently testable. I kept AWS deep work in my other projects where it was the right fit."*

Choosing the tool that fits the constraint — and being able to say why, including what you gave up — is a stronger signal than reaching for the most complex option available.
