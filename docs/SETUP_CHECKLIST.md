# Rosterly — Owner Setup Checklist

The things only you can do, in the order they should be done. Each step says
**why**, **exactly what to do**, and **how to know it worked**.

Nothing in this list is code — the app is built. This is the gap between
"the tests pass" and "a restaurant depends on it".

---

## Step 1 — Rotate the service-role key 🔴 SECURITY, DO FIRST

**Why:** your `.env` holds a Supabase **service-role** key named
`NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`. That key bypasses Row-Level Security
entirely — it can read and write every restaurant's data. The `NEXT_PUBLIC_`
prefix is Next.js's literal instruction to **inline a value into the browser
bundle**. It is git-ignored and nothing reads it today, so nothing has leaked —
but one stray reference, or one paste into Vercel under that name, publishes it
to every visitor.

**Do:**
1. Supabase dashboard → your project → **Settings → API → Project API keys**.
2. Next to `service_role`, click **Reset / Rotate**. Copy the new key.
3. Open `.env` and **delete** the `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` line.
4. Add it back with the correct, server-only name:
   `SUPABASE_SERVICE_ROLE_KEY="<new key>"`
5. If you ever pasted the old key into Vercel, delete it there too.

**Verify:** `grep NEXT_PUBLIC_SUPABASE_SERVICE .env` returns nothing.

---

## Step 2 — Commit everything

**Why:** roughly half the product (M8 swaps, M9 notifications, M10 costs,
migrations 0011–0012, the whole Python solver) exists only as untracked files on
one laptop. A disk failure loses weeks. This is the cheapest catastrophic loss
available.

**Do:**
```bash
git add -A
git status          # confirm .env and solver/.venv are NOT listed
git commit -m "feat: complete M1-M11, solver service, Sentry and error boundaries"
git push
```

**Verify:** `git status` is clean and GitHub shows the new commit.

---

## Step 3 — Create the Sentry project and paste the DSN

**Why:** the code is wired but dormant. With no DSN the SDK is a deliberate
no-op, so today a crash at Friday dinner service leaves no trace at all.

**Do:**
1. sentry.io → sign up (free tier is plenty) → **Create Project** →
   platform **Next.js** → name it `rosterly`.
2. Copy the **DSN** it shows you (`https://…@…ingest.sentry.io/…`).
3. In `.env`: `NEXT_PUBLIC_SENTRY_DSN="<the DSN>"`
4. Optional, for readable production stack traces — Sentry → Settings →
   Auth Tokens → create one with `project:releases` scope, then set
   `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.

**Verify:** run `npm run dev`, visit any page, and force an error (e.g. add a
temporary button that throws). You should see the styled "Something went wrong"
screen **and** the event appear in Sentry within a minute. Remove the button.

---

## Step 4 — Stand up the staging Supabase project 🔵 THE BIG ONE

**Why:** this is the single highest-value remaining task. Every one of the 419
tests is static — **no one has ever clicked through this product against a real
database.** Nine modules have never met live Postgres, real auth, or real
latency. Expect this step to surface issues no unit test can.

**Do:**
1. supabase.com → **New project** → name `rosterly-staging`, region
   **Sydney (ap-southeast-2)**, save the DB password.
2. Link and push all twelve migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-staging-ref>
   npx supabase db push
   ```
3. Regenerate the typed schema so it matches reality rather than my hand-written
   version:
   ```bash
   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
   npx tsc --noEmit
   ```
   If that surfaces type errors, they are real drift — tell me and I'll fix them.
4. Point `.env` at staging (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
5. Seed two businesses so tenant isolation is real, not hypothetical:
   ```bash
   npx supabase db reset      # local
   # or run supabase/seed.sql against staging via the SQL editor
   ```

**Verify:** Supabase → Table Editor shows all tables; Authentication → Policies
shows RLS enabled on every one.

---

## Step 5 — Enable phone login and walk the whole product

**Why:** the acceptance criteria that matter most ("a manager builds a roster",
"a chef drops a shift") can only be checked by a human.

**Do:**
1. Supabase → **Authentication → Providers → Phone** → enable. For staging you
   can use Twilio test credentials, or add your own number as a test OTP.
2. `npm run dev`, then walk this path end to end:
   - Sign in as a manager → **Settings**: trading hours, roles, rules
   - **Team**: add 3–4 staff with different roles and levels
   - **Availability**: set a pattern for one person
   - **Template**: design a week of slots
   - **Schedule**: create a roster → pre-flight → generate → review → **Publish**
   - Sign in as a staff member on your phone → see the shift → **drop it**
   - Back as manager → **Cover**: open it to the team
   - As a second staff member → claim it
   - As manager → approve it
3. Write down everything that looks wrong. Send me the list.

**Verify:** you completed the whole path without getting stuck. That is the real
definition of done.

---

## Step 6 — Deploy the solver (optional, and safely skippable)

**Why:** the app degrades gracefully without it — rosters still seed and can be
built by hand. It is also currently **unauthenticated** and misses its own speed
target, so shipping it as-is to a public URL is a cost risk.

**Recommendation:** launch the first customer **without** the auto-scheduler.
Manual rostering with a good grid is already better than their spreadsheet, and
it removes a whole class of launch risk. Add the solver once the basics are
proven in a real restaurant.

If you do want it: build `solver/Dockerfile`, push to AWS ECR, create a Lambda
from the container image, put it behind a Function URL, and set
`NEXT_PUBLIC_SOLVER_URL`. **Ask me to add authentication first.**

---

## Step 7 — Backups and the money conversation

**Do:**
1. Supabase → **Settings → Database → Backups**: confirm daily backups are on
   (may need the Pro plan). Take a manual CSV export before any risky migration.
2. Before taking money, work through `REQUIREMENTS.md` §12. Two of its eight
   boxes are currently ticked.
3. Write the one-page agreement with each owner: what it does, what it explicitly
   does **not** do (payroll / award pay), price, who pays for SMS, that all
   figures are estimates, and data export on request.

---

## Still outstanding in code (mine, not yours)

For visibility — these remain after the steps above:

- **E13 "shift uncovered, starting soon"** + the cron sweeper — the safety net
  for the invariant you care most about
- Notification enqueue is post-commit, not truly transactional
- SMS budget / quiet-hours have no settings columns yet
- Solver authentication and performance
- `subscription_status` gates nothing (no payment enforcement)
- "Build template from a past week" (M4 §4.4, tagged MVP)
