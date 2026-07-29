# Rosterly Scheduler Service (Module 5)

A standalone, stateless Python service that turns **demand** (the week template's
positions) plus **supply** (staff, their capability, limits and availability)
into a valid draft roster, using Google OR-Tools **CP-SAT**.

The Next.js app never contains scheduling logic; it POSTs a request and stores
the assignments. See **`../docs/SOLVER_CONTRACT.md`** — the frozen wire contract
and the single source of truth for both sides.

## The promise it keeps

> Rosterly will never produce an invalid roster — nobody double-booked, over
> their hours, or working when unavailable — and when it can't fill something,
> it says exactly what's missing and why.

- **Hard constraints (H1–H14) are never violated.** Role capability, availability,
  no overlap (incl. across midnight), max hours/shifts per week, max consecutive
  days, minimum rest, one-shift-per-day, location eligibility, required level,
  locked and excluded pairs, active staff only.
- **Demand is soft.** Every position carries a penalised *shortfall* variable, so
  a short-staffed week returns a **partial** roster with explained gaps instead
  of an infeasible solve that returns nothing.
- **Senior coverage is a timeline rule**, discretised into 15-minute blocks over
  the day's open hours with a penalised slack variable — an uncovered window is
  reported, it does not fail the solve.
- **Deterministic.** Same request + same `seed` ⇒ identical response.

Availability arrives **pre-resolved** by the app (one shared resolver, M3 §6);
the solver never re-derives pattern/exception logic.

## Layout

```
app/
  context.py        request → normalised internal model (preprocessing)
  constraints.py    hard constraints H1–H14
  model.py          CP-SAT variables, shortfall/slack vars, objective
  diagnostics.py    unfilled reasons, detail, closest_candidates
  solve.py          solve(request: dict) -> dict   ← the one implementation
  server.py         Flask  POST /solve  (local/dev) + GET /health
  lambda_handler.py AWS Lambda entry (direct or API Gateway/Function URL)
  slugs.py          the closed reason / blocked_by vocabulary
tests/              pytest suite (see below)
Dockerfile          container image for Lambda (OR-Tools is too large for a zip layer)
```

Both entry points delegate to `solve()`, so HTTP and Lambda cannot drift apart.

## Running locally

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux/macOS: .venv/bin/pip
.venv/Scripts/python -m flask --app app.server run --port 8000
```

Then point the app at it:

```
NEXT_PUBLIC_SOLVER_URL="http://localhost:8000/solve"
```

With that variable unset the app still works — it degrades gracefully, keeping
the seeded roster and offering manual assignment (M5 §10).

## Tests

```bash
.venv/Scripts/python -m pytest tests -q
```

The suite verifies the properties the product depends on, not just happy paths:

| File | Proves |
|---|---|
| `test_hard_constraints.py` | H1–H14 hold in returned assignments, incl. randomised inputs |
| `test_always_returns.py` | A short-staffed week returns `partial` with reasons — never an exception |
| `test_determinism.py` | Same request + seed ⇒ byte-identical output |
| `test_senior_coverage.py` | Timeline coverage incl. overnight and 24-hour days |
| `test_diagnostics.py` | Every unfilled position carries a human `reason` + `detail` |
| `test_scale_and_dst.py` | Target-scale performance and DST-spanning shift durations |

**Known:** `test_target_scale_solves_in_under_two_seconds` currently fails —
a 30-staff × 200-position solve took ~7s against the M5 §11 target of <2s. This
is a performance target, not a correctness defect: the roster returned is still
valid (hard constraints always hold) and well inside the 15s default time limit.
Re-measure on the real Lambda container before tuning; if it persists, the usual
levers are tightening the objective (fewer soft terms), reducing the senior-block
resolution from 15 minutes, or raising `time_limit_seconds` and accepting the
best solution found.

## Building the image

```bash
docker build -t rosterly-solver .
```

Deploy as a Lambda **container image** (OR-Tools exceeds the zip layer limit),
with `app.lambda_handler.handler` as the entry point. Stateless — every input
arrives in the request, so it scales to zero and costs nothing between solves.

## Python version

Target **3.12** (TECH_STACK §1). OR-Tools 9.15 ships cp313 wheels so 3.13 works
locally, but pin 3.11/3.12 in CI and Lambda for parity with the documented stack.
`tzdata` is a dependency because Windows and the slim Lambda base image do not
ship the system IANA timezone database, which `zoneinfo` needs for
`Australia/Sydney`.
