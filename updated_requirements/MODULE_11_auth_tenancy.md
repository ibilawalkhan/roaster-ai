# Rosterly — Module 11: Auth, Roles & Tenant Isolation

**Status:** draft for review
**Depends on:** M2 (staff records)
**Feeds:** every module — this is cross-cutting

---

## 1. Purpose

Who can log in, and what they can see once they do.

This is the **highest-stakes module in the product**. Every other module can fail gracefully; this one cannot. A tenant-isolation failure means one restaurant reading another restaurant's staff, wages and rosters — commercially fatal, and a privacy breach involving real people's personal data. A within-business failure means a kitchen hand reading everyone's pay rates, which will get you thrown out of a customer's business the same day.

**The governing principle:** *the database is the security boundary.* Hidden UI, unlinked routes, and client-side checks are convenience, never protection. Every rule in this module is enforced by Row-Level Security in Postgres, and every rule has a test.

---

## 2. Three layers of access

| Layer | Who | Scope |
|---|---|---|
| **Platform** | You (software owner) | All businesses. Operated via Supabase dashboard / seed scripts — **no in-app super-admin UI in v1** (M12) |
| **Business** | Manager/owner | Exactly one business: its staff, rosters, costs, settings |
| **Staff** | Team member | Their own record, their own shifts, their own availability, eligible open shifts |

A user belongs to **exactly one business** (REQUIREMENTS.md §1.5). Multi-business users are [LATER].

---

## 3. Authentication

### 3.1 Method **[MVP]**
- **Phone number + one-time code (OTP)** via Supabase Auth — the primary method for everyone. Restaurant staff reliably have phones, not always email, and passwords get lost.
- **Email + password** as a manager-only fallback, for owners who prefer it or whose phone changes often.
- No social login. No password for staff.

### 3.2 Identity linking **[MVP]**
- The manager creates an `app_user` record with a phone number (M2) **before** the person ever logs in.
- On first successful OTP, the Supabase auth user is linked to that `app_user` by matching phone within the business → `auth_user_id` set, `invite_status` → `active`.
- **No self-signup.** A phone number with no matching pre-created record cannot create anything — it sees "your manager hasn't added you yet." This is deliberate: it removes an entire class of account-takeover and spam problems.

### 3.3 Sessions **[MVP]**
- Long-lived sessions (target 60 days) with refresh — staff who must re-authenticate weekly will abandon the app (M7 §2).
- Manager sessions may be shorter (14 days) since they hold more privilege.
- Sign out clears the session on that device. **[V1.1]** "sign out everywhere" for a lost phone.

### 3.4 Abuse protection **[MVP]**
- OTP request rate limits per phone and per IP; a short lockout after repeated failures.
- OTP codes expire quickly (≤10 minutes) and are single-use.
- Failed auth attempts are logged.

---

## 4. Roles and permissions

Two app roles: **manager** and **staff** (`app_user.is_manager`). This is distinct from a person's *job role* (Kitchen, FOH) — a manager who also works kitchen shifts is normal and must not be conflated.

**[LATER]** A supervisor role (edit one location's roster, no cost access).

### 4.1 Permission matrix — the definitive reference

| Resource | Manager | Staff |
|---|---|---|
| Business settings, trading hours, roles, rules (M1) | Read/write | None |
| Staff records (M2) | Read/write all | Read **own** only; write own contact fields only |
| Pay rates | Read/write all | Read **own** only |
| Availability (M3) | Read/write all | Read/write **own** only |
| Week template (M4) | Read/write | None |
| Draft rosters (M5/M6) | Read/write | **None** — invisible and unreachable |
| Published rosters | Read/write all shifts | Read **own shifts** only |
| Colleagues on an overlapping shift | Full detail | **Name and job role only** — no rate, hours or contact |
| Shift drop request (M8) | Approve/decline/open/reassign | Create for **own** shifts only |
| Open shifts | See all | See only those they're **eligible** for (M8 §4) |
| Claims | See all, approve | Create own; see own only |
| Cost views and reports (M10) | Full | **None** — except own estimated pay |
| Notifications (M9) | Own (manager-scoped events) | Own only |
| Change log / audit | Read | None |

Write the isolation tests directly from this table — it is a test specification, not documentation.

---

## 5. Row-Level Security design

### 5.1 Pattern **[MVP]**
Every table carries `business_id`. Every table has RLS **enabled** with policies built from two helper functions:

```sql
current_business_id()  -- business_id of the app_user linked to auth.uid()
is_manager()           -- whether that app_user has is_manager = true
```

Canonical policy shapes:

```sql
-- Business-scoped, manager-only (settings, template, costs)
USING (business_id = current_business_id() AND is_manager())

-- Business-scoped, readable by all members (roles, locations)
USING (business_id = current_business_id())

-- Own-record-only (availability, claims, notifications)
USING (business_id = current_business_id()
       AND (is_manager() OR user_id = current_app_user_id()))

-- Shifts: managers see all; staff see own, and only if published
USING (business_id = current_business_id()
       AND (is_manager()
            OR (assigned_user_id = current_app_user_id()
                AND roster_status = 'published')))
```

### 5.2 Non-negotiable rules
- **RLS is enabled on every table.** A table without RLS is a hole; there are no exceptions "because it's only lookup data."
- **The service-role key never reaches the client.** It exists only in server-side Edge Functions (notifications worker, solver bridge, seed scripts). Leaking it bypasses every policy in this document.
- **Server-side functions must still authorise explicitly** — running with elevated privileges is not permission to skip checks.
- **Draft rosters are invisible to staff at the database level**, not merely hidden in the UI (M6 §4.2).
- New tables require policies **in the same migration** that creates them. A migration adding a table without RLS fails review.

---

## 6. The isolation test suite — **mandatory**

An automated suite that must exist and pass in CI before launch (REQUIREMENTS.md §9). Minimum cases:

**Cross-tenant (the fatal class):**
1. Manager of business A reads staff of business B → **denied**
2. Manager of A reads shifts / rosters / costs / templates / notifications of B → **denied**
3. Manager of A writes to any B row → **denied**
4. Staff of A reads anything of B → **denied**
5. A solve request cannot reference two businesses' data

**Within-tenant:**
6. Staff reads another staff member's pay rate → **denied**
7. Staff reads another staff member's availability → **denied**
8. Staff reads any cost view → **denied**
9. Staff reads a **draft** roster → **denied**
10. Staff writes to another person's availability or shift → **denied**
11. Staff creates a drop request on someone else's shift → **denied**
12. Staff claims an open shift they're not eligible for → **denied**
13. Staff escalates themselves to manager (`is_manager` write) → **denied**
14. Colleague-on-shift view exposes name and role but no rate or contact

**Auth:**
15. Unknown phone number cannot create records
16. Deactivated user's session cannot read or write

Run against a seeded database with **two businesses** so cross-tenant cases are real, not hypothetical (M1 §11, week-1 checkpoint).

---

## 7. Data protection

- **Collect the minimum:** name, mobile, optional email, job details. No addresses, no ID documents, no bank details, ever.
- **Personal data of third parties:** staff phone numbers are provided by the manager; the service agreement records that the customer has the right to provide them (SERVICE_AGREEMENT.md §6).
- **Export on request** — per-business data export (M10 §6 / agreement §6).
- **Deletion:** when a business leaves, their data is exported then removed within an agreed window. Staff are deactivated, never hard-deleted, while the business is active (M2 §3.5).
- **Audit trail** of privileged actions (see §8) is retained.
- Australian privacy obligations grow with the business; revisit with a lawyer as customer count grows (agreement §10 note).

---

## 8. Audit logging **[MVP]**

Recorded with actor and timestamp:
- Login success/failure, OTP request
- Staff created / deactivated / reactivated
- Pay rate changed (old → new)
- `is_manager` granted or revoked
- Business settings and scheduling rules changed
- Roster published / unpublished
- Every swap transition (M8 §6) and roster change (M6 §5)

Managers can read their business's audit log. Nobody can edit it.

---

## 9. Edge cases

- **Same phone number at two customer restaurants** — allowed; `phone` is unique per `business_id`, not globally. The OTP must then resolve which business: prompt to choose. (Rare, but real in hospitality.)
- **Phone number changed after login** (M2 §6) — re-link the auth identity explicitly or force re-invite; never leave an orphaned login. Log it as a privileged action.
- **Auth user with no `app_user`** (invited then deleted) — clean "no access" screen, no partial app.
- **Staff deactivated mid-session** — next request fails authorisation and returns them to a polite signed-out state (M7 §7).
- **Last manager** — a business must always retain at least one active manager; the last one cannot deactivate or demote themselves (M2 §6).
- **Manager who is also rostered staff** — sees the manager view; their own shifts appear normally; they receive manager-role notifications only, never duplicates (M9 §8).
- **Suspended business** (M12 / REQUIREMENTS §1.1) — manager login succeeds but the app shows an account-status screen; staff see a read-only view or the same notice. Data is untouched.
- **Session on a shared kitchen tablet** — offer a visible sign-out and consider a shorter session for manager logins on shared devices. Document the risk to the owner rather than solving it technically in v1.

---

## 10. Acceptance criteria

- [ ] Every table has RLS enabled; a migration adding a table without policies fails review.
- [ ] The full §6 isolation suite exists, runs in CI, and passes — including all cross-tenant cases against a two-business seed.
- [ ] Staff cannot read any other person's pay rate, availability, or contact details, nor any cost view, nor any draft roster.
- [ ] A staff member cannot grant themselves manager rights.
- [ ] Phone-OTP login works end to end from an SMS invite; unknown numbers gain nothing.
- [ ] The service-role key exists only server-side; no client bundle contains it.
- [ ] Sessions persist long enough that staff aren't re-authenticating weekly; sign-out works.
- [ ] OTP requests are rate-limited and codes are single-use and short-lived.
- [ ] Privileged actions (rate changes, role grants, publish, deactivation) are audit-logged with actor and timestamp.
- [ ] A business must always retain at least one active manager.
- [ ] Deactivated users lose access on their next request.

## 11. Out of scope for this module

Supervisor/partial-admin roles [LATER], multi-business users [LATER], SSO or enterprise identity [LATER], two-factor beyond OTP-as-primary [LATER], self-serve signup (deliberately excluded — you create businesses), in-app platform admin UI (M12), per-field encryption beyond Supabase defaults [LATER].
