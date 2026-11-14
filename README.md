# Aspire Attendance — verified repository update (v6.1)

**Base repository:** https://github.com/syedghazi0001-hub/Aspire_Attendence

**Base commit:** `f71b4e124a67e95d6c8fa280d2cec5a5c175978a`.

This complete source ZIP is based on that working repository, not a replacement template. GitHub has **not** been modified by this assistant. Secrets, installed dependencies, Git metadata, and generated build output are not included.

## IMPORTANT: upload alone does NOT migrate Supabase

GitHub upload may trigger your existing Cloudflare build, but it cannot apply database changes without an explicitly configured migration pipeline and credentials. This update deliberately fails closed rather than generating incomplete payroll if its required database functions are missing.

### Safest one-time update

1. **Back up your Supabase database** and save your current working Git commit.
2. In Supabase **SQL Editor**, run the included **`supabase/schema.sql`** once. It includes the base schema and all upgrade steps; **do not separately run the migrations if you used the complete schema**. This preserves existing rows, expands leave statuses, adds the manual overtime override, financial audit log, consistent payroll input snapshot, leave/attendance guards, and access restrictions. Existing broad browser-write access is intentionally removed.
3. Confirm your actual administrator profile has `role = 'admin'`. Replace the email below with your real admin email:
   ```sql
   UPDATE public.users SET role = 'admin'
   WHERE id = (SELECT id FROM auth.users WHERE email = 'your-admin@example.com');
   ```
   Email login does **not** grant admin access by itself. Do not promote all employees or all users.
4. Upload this ZIP's **contents**, preserving folder paths, to your GitHub repository. Keep your existing private environment variables and domain settings. Do not upload `.env.local` or service keys.
5. Set Cloudflare build/runtime public variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the **server-only runtime secret** `SUPABASE_SERVICE_ROLE_KEY`. Public variables must also be available during the Next.js build. Recommended build Node: **22.12+**.
6. Build command: `npm ci --legacy-peer-deps && npx @opennextjs/cloudflare build`.
7. Deployment command: `npx wrangler deploy` (or your already-working Cloudflare deployment workflow).
8. Test with an administrator and two test employees before authorizing real payroll. See `TEST_REPORT.md`.

**Alternative for an already-provisioned database:** run only the files in `supabase/migrations/` in filename order, then steps 3–8. All five files are needed, including Auth trigger hardening. Do not use `supabase db reset` on production.

## Features and exact behavior

### QR and GPS separated

- Sidebar **QR Code** opens `/admin/qr-code`, with a large workplace code and **Regenerate QR Code** below it.
- `/admin/settings` has only Latitude, Longitude, Radius and GPS capture controls.
- Rotation writes only the QR token; saving GPS updates only GPS columns. Neither operation resets the other settings with stale defaults.
- Rotation uses `crypto.randomUUID()`. The attendance API compares the scanned token with current database settings. Old tokens are rejected on subsequent validation. Already-in-flight requests may have validated the old token before rotation completed.

### Averaged GPS, honest accuracy limits

- Both employee scanning and Admin location capture use `watchPosition` with `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 10000`.
- Collects **five fresh, distinct-timestamp readings**. Readings with reported accuracy worse than **30m** are ignored, with **“GPS signal weak, please wait.”**
- Accepted coordinates are averaged. Watchers are cleared on completion, cancellation, permission denial, or the overall **30-second** collection deadline.
- Distance enforcement uses the existing unrounded Haversine result, not its two-decimal display value, and adds **no hidden tolerance** to the Admin radius.
- Haversine provides sub-meter **numeric resolution**, not guaranteed sub-meter positioning accuracy. GPS and the spherical Earth model have physical limitations; averaging cannot remove all bias or spoofing. A strict 1m radius can reject a genuine employee whose phone reports an imprecise location.

### Strict leave attendance rules

- Approved **Paid/Unpaid full-day leave** disables Check-In and Check-Out. API and database guards enforce the same rule, so bypassing a disabled button does not bypass the leave restriction.
- A full-day leave cannot be newly approved over an existing check-in or overtime adjustment. Resolve the conflict explicitly; the system does not erase worked time.
- Approved **Short Leave** permits attendance/check-out. Payroll deducts its approved `hours_missed × hourly_rate` **once**, from the leave ledger, not again from the attendance display field.
- Employee can cancel today's/future approved leave. Short leave **after check-in** and all historical cancellations require Admin review to prevent retroactive self-awarded pay. Cancellation is an atomic database function that verifies the approved device session.
- Admin can approve Paid, Unpaid or Short, switch Paid/Unpaid, and Cancel/Revoke. Cancellation changes `status` to **`cancelled`**; it does not delete the leave record.
- Admin's legacy Delete Leave action now also performs soft cancellation. Deleting an employee still preserves the previous Auth/profile cascade-delete behavior; financial audit records retain before/after snapshots.
- Cancelled/rejected/pending leaves never reduce pay or count as paid attendance.
- Cancelling leave restores normal attendance eligibility; it does not reopen an already-completed day's timestamps or override GPS/QR/session requirements.
- Employee cannot resubmit over an existing date's leave to turn approved leave back into pending. Admin can amend the retained date record.

### Payroll safeguards

- UI and PDF share `src/lib/payroll.ts`.
- Payroll inputs are loaded together through one database snapshot, rather than combining unrelated requests from different moments.
- Money is accumulated in integer minor units; rate/hour multiplication uses integer arithmetic with explicit half-up rounding to two currency decimals. Zero salary/rates are respected, not replaced by truthiness fallbacks.
- Overtime calculation: `max(0, CheckOut - max(DutyEnd, CheckIn))`, with date-aware PKT timestamps. Early arrival is not overtime. The reported 12:51–12:59 daytime case returns zero, not negative hours.
- **Manual overtime sets the final total for that date**, before or after check-out; it is not added to automatic overtime. Repeated saves do not double-credit it. The override remains explicit in `overtime_override_hours`. The API rejects ambiguous additive mode.
- Manual OT-only rows do not count as attended days.
- Duplicate/conflicting/invalid payroll inputs show **REVIEW REQUIRED** and block PDF export instead of silently producing a payment report.
- Salary/rate edits recorded **during or after a report month** hold that month's report for effective-date review. The app does not invent a mid-month proration policy. Future unaffected months can use the new rates.
- `public.payroll_change_log` records before/after changes to users, leaves and attendance, including cancellations. This is a database change log; its `database_role` is not a verified human operator identity, and it is not a tamper-proof external accounting ledger.
- Anonymous browser writes and unauthenticated Admin API access are rejected. The Auth profile trigger cannot grant admin using user-editable metadata. Existing role assignments are preserved.

## Payroll policy preserved — not invented

**Preview = monthly base − approved unpaid days × configured day rate − approved short hours × configured hourly rate + overtime total × configured OT rate, floored at zero.**

Paid leave has no deduction. This preserves the repository's explicit-leave model: unmarked days do **not** silently become unpaid absence. The app does not infer weekends, holidays, joining/leaving proration, tax, statutory overtime multipliers, or legally mandated leave entitlements. Confirm these policies with your payroll owner before using the preview for payment.

These reports are **reviewable payroll previews, not locked/finalized payslips**. There is no approved rate-effective-date allocation UI or immutable finalized payroll period. Historic rate/attendance errors that predate this installation cannot be reconstructed from a new audit log. Reconcile old data and rate-history gaps with original records; do not assume deployment repairs all old salary data.

The overtime helper covers overnight calculations. The existing attendance/session portal still keys daily records by PKT date; a full overnight check-in/check-out workflow across midnight needs separate acceptance testing and potentially a shift-date policy before overnight payroll is used.

## Local checks

```bash
npm ci --legacy-peer-deps
npm test
npx tsc --noEmit
npx @opennextjs/cloudflare build
```

Tests include an isolated embedded PostgreSQL instance; they do **not** connect to your Supabase database. Camera/GPS hardware, live Auth, RLS with your custom policies, two-device approval, and deployment secrets still require live acceptance tests.

## Research references

- Geolocation watch options and cleanup: [1](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API/Using_the_Geolocation_API).
- PostgreSQL statement snapshots and isolation: [1](https://www.postgresql.org/docs/current/transaction-iso.html).

`TEST_REPORT.md` documents the checks performed, build warning and remaining dependency audit findings. `CHANGED_FILES.md` lists modifications relative to the base commit.
