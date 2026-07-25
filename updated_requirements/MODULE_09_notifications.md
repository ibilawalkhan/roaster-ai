# Rosterly — Module 9: Notifications

**Status:** draft for review
**Depends on:** M2 (phone numbers), M6 (publish, roster edits), M7 (staff app), M8 (swaps)
**Feeds:** every module that needs to tell somebody something

---

## 1. Purpose

Getting the right message to the right person at the right moment — and **never** to everyone else.

Two channels, deliberately separated so one can be tuned, throttled, or removed without touching any business logic:

1. **In-app** — a notifications list plus live updates while the app is open. Free, unlimited, no interruption.
2. **SMS deep link** — a text message with a link straight to the relevant screen. Costs money, interrupts a real person's evening, and is therefore reserved for things that genuinely can't wait.

**Principles:**
- **Quiet by default.** Every unnecessary notification trains people to ignore the necessary ones. When in doubt, in-app only.
- **A failed notification must never fail the action that triggered it.** A Twilio outage cannot break shift approval.
- **Every message is actionable and links somewhere specific.** No "something changed" messages.
- **The manager is the hub** (M8): staff are notified about *their own* shifts; the manager is notified about *the restaurant*.

---

## 2. Event catalogue

The single reference table for the whole product. Every notification in Rosterly is one of these.

| # | Event | Recipient | In-app | SMS | Notes |
|---|---|---|---|---|---|
| E1 | Roster published | Each staff member with shifts | ✓ | ✓ | The one broadcast that matters. Links to their shifts. |
| E2 | Your shift changed (time/role/location) | Affected staff member | ✓ | ✓ | Must never be silent (M6 §4.3) |
| E3 | Your shift was removed | Affected staff member | ✓ | ✓ | |
| E4 | You were added to a shift | Affected staff member | ✓ | ✓ | |
| E5 | Roster withdrawn (unpublished) | Staff with shifts in it | ✓ | ✓ | Disruptive; rare |
| E6 | Drop requested | **Manager only** | ✓ | ✓ | Per M8 — never broadcast to staff |
| E7 | Drop declined | Dropper | ✓ | — | Not urgent enough for SMS |
| E8 | Shift opened to team | **Eligible staff only** (M8 §4) | ✓ | ✓ | Only sent when the manager chooses to open it |
| E9 | Shift claimed | Manager | ✓ | — | Batched if several claims (§4) |
| E10 | Your claim approved — you're on | Chosen staff member | ✓ | ✓ | Time-critical |
| E11 | Shift filled by someone else | Other claimants | ✓ | — | |
| E12 | Your shift was covered by X | Dropper | ✓ | ✓ | Closes the loop; they need certainty |
| E13 | Shift still uncovered, starting soon | Manager | ✓ | ✓ | Default 12h lead (M8 §7) |
| E14 | Staff marked unavailable for a shift they're on | Manager | ✓ | — | From M3 §5 |
| E15 | Availability reminder before roster generation | Staff with none set | ✓ | — | **[V1.1]**, opt-in per business |
| E16 | You've been invited to Rosterly | New staff member | — | ✓ | The invite link (M2 §4.4) |

**Nothing else sends a notification.** Adding an event to this table is a deliberate decision, not a side effect of writing code.

---

## 3. Delivery architecture

**Transactional outbox** — the pattern that makes "never break the action" true:

1. The business action (publish, approve, drop) writes its data **and** a `notification` row in the **same database transaction**. Either both happen or neither does.
2. A separate worker picks up pending notifications and delivers them: in-app immediately (Supabase Realtime), SMS via a Twilio Edge Function.
3. Delivery success or failure is recorded on the row. Failures retry with backoff (3 attempts), then land in a failed state visible to you.

Consequences:
- A Twilio outage never rolls back a shift approval.
- No notification is ever lost because the app crashed after the write.
- You can see, per business, exactly what was sent and what failed — essential when an owner says "I never got told."

**In-app realtime:** while the app is open, changes stream in via Supabase Realtime, scoped by `business_id` and `user_id` (never a global firehose — REQUIREMENTS.md §8).

**Deep links:** every SMS contains a link to the exact screen — a specific shift, the open-shifts list, the approval screen. A text that dumps someone on a home screen wastes both the message and their time. Links must work for a signed-out user (land on login, then continue to the target).

---

## 4. Throttling, batching, quiet hours

Restaurant staff are asleep at 2am and mid-service at 7pm. Notification hygiene is a product feature, not a nicety.

- **Quiet hours (SMS only):** default **22:00–07:00** business time. Non-urgent SMS queues until morning; in-app is unaffected.
  - **Exception:** E13 (uncovered shift starting soon) and E10 (you're on for a shift starting soon) may break quiet hours — they're time-critical by definition.
- **Batching:** multiple claims on one shift (E9) collapse into one message per shift within a short window (default 10 minutes): *"3 people have offered to cover Friday 16:00."*
- **Roster publish (E1)** sends **one** SMS per staff member summarising their fortnight — never one per shift.
- **Rate cap per person:** no more than N SMS per person per day (default 5). Excess degrades to in-app only.
- **De-duplication:** identical event + recipient + target within 60 seconds is sent once (protects against double-clicks and retries).

---

## 5. SMS cost control

SMS is the only part of Rosterly with a per-use cost, so it needs guard rails from day one:

- **Per-business monthly SMS budget** (a number you set, e.g. 500 messages). At 80% the manager is warned; at 100% SMS degrades to in-app only and you're alerted. The product keeps working — it just gets quieter.
- **Per-business SMS toggle:** a business can run in-app-only if they'd rather not pay for texts.
- Cost is passed on per the service agreement (SERVICE_AGREEMENT.md §5).
- Every SMS attempt logs its cost so you can reconcile against the Twilio bill and price the subscription honestly.

---

## 6. Staff-facing settings

Deliberately minimal — a settings screen full of toggles is a settings screen nobody uses:

- Staff may turn off SMS for **non-critical** events only (E7, E11). Roster publication, shift changes, and "you're on" cannot be disabled — those are operational.
- Managers may turn off SMS for E9 (claims) if they check the app regularly.
- No categories, no schedules, no per-event matrix.

---

## 7. Data model

```
notification (
  id, business_id, user_id,
  event_type,            -- 'E1'..'E16' (named constants in code)
  payload_json,          -- what's needed to render + deep-link target
  channel,               -- 'inapp' | 'sms'
  status,                -- 'pending' | 'sent' | 'failed' | 'suppressed'
  suppressed_reason,     -- 'quiet_hours' | 'rate_cap' | 'budget' | 'user_pref'
  attempts, last_error,
  scheduled_for,         -- for quiet-hours queuing
  sent_at, read_at, created_at
)

notification_batch (      -- for collapsing related events
  id, business_id, key,   -- e.g. 'claims:shift_123'
  window_ends_at, sent
)
```

- Written in the same transaction as the triggering action (§3).
- `read_at` drives the staff/manager in-app list (M7 §3.5).
- All rows carry `business_id`; RLS restricts each user to their own notifications.

---

## 8. Edge cases

- **Invalid or disconnected phone number** → SMS fails, logged, manager sees a "couldn't reach Ahmed" flag on the team screen. Never silently swallowed.
- **Staff member never logged in** → SMS still works (it's just a text); in-app accumulates for whenever they do.
- **Event fires for a deactivated staff member** → suppressed, logged.
- **Roster published twice** (edited and republished) → do **not** re-blast everyone; only notify staff whose shifts actually changed (E2/E3/E4).
- **Bulk change** (manager edits 10 shifts for one person) → batch into a single "your shifts have changed" message.
- **Quiet-hours queue and the event becomes stale** (a shift already started) → discard rather than send a pointless 7am text; mark `suppressed`.
- **Timezone** — quiet hours and "starting soon" use the business timezone (M1), not the phone's.
- **Twilio down** → retries with backoff; in-app is unaffected; the action itself always succeeded.
- **Same person is both manager and rostered staff** → they receive the manager-role notification only, never duplicates.

---

## 9. Acceptance criteria

- [ ] Every notification sent by the product appears in the §2 catalogue; nothing sends outside it.
- [ ] Drop requests (E6) reach the manager only — verified by test that no staff notification row is created.
- [ ] Shift-opened (E8) reaches only staff who pass the M8 §4 eligibility check.
- [ ] Notification rows are written in the same transaction as the triggering action; a forced SMS failure leaves the shift change intact.
- [ ] Failed deliveries retry (3×, backoff) and end in a visible failed state, never silently lost.
- [ ] Quiet hours suppress non-urgent SMS and release them in the morning; time-critical events override.
- [ ] Multiple claims on one shift collapse into a single manager message within the batch window.
- [ ] Roster publish sends exactly one SMS per staff member, not one per shift.
- [ ] SMS budget cap degrades gracefully to in-app only and alerts, without breaking any feature.
- [ ] Every SMS deep link opens the correct screen, including for a signed-out user after login.
- [ ] Realtime subscriptions are scoped per business and user; the tenant-isolation test passes.

## 10. Out of scope for this module

True web push / PWA notifications [LATER — deliberately avoided for the timeline; deep-linked SMS covers the need], native mobile apps [LATER], WhatsApp Business API [V1.1 — the module is channel-agnostic, so adding it later is a new sender, not a redesign], email notifications [V1.1], notification preferences beyond §6 [LATER], read receipts shown to the manager ("who has seen the roster") [V1.1 — see M7 §6].
