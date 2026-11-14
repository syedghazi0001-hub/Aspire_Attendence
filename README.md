# Aspire Attendance v6.2 — Cloudflare runtime repair

Based on repository commit `200d8072bee309b87372cde0e7635b2169641d1b` from https://github.com/syedghazi0001-hub/Aspire_Attendence. This is the deployed-source update, not a new template. No live GitHub push or production database operation was performed.

## Implemented

- Every API route obtains `const { env } = getCloudflareContext()` inside its request handler. Server clients are constructed per request from those Worker bindings. No server/client Supabase initialization reads build-process environment values.
- `src/lib/supabaseRuntime.ts` centralizes binding validation and client construction. No global server client, no global access token, no fallback to anonymous privileges for database writes.
- `src/lib/requireAdmin.ts` validates the bearer token and explicit `public.users.role = 'admin'` using the request's service client. The credential fix does not remove authorization checks.
- `/api/public-config` returns only Supabase URL and anonymous/publishable key, with `Cache-Control: no-store`. A service/secret key is never returned. It rejects accidental service-role/secret keys configured in the public-key field.
- Browser auth is initialized from this runtime endpoint rather than build-time `NEXT_PUBLIC_*` substitution or placeholder-project credentials.
- Unified login authenticates on the server. An Admin gets an authenticated access/refresh session that is persisted in the browser before navigating to protected pages. Employee device-session flow remains separate.
- Employee ID login resolves that profile's Auth UUID and actual email, handling legacy Auth-email mappings without binding one employee to somebody else's profile. Password whitespace is preserved.
- Missing bindings, rejected Supabase keys/auth availability, wrong credentials, unconfirmed accounts and rate limits have distinct responses. Failed session writes cannot return a successful login token.
- QR settings use the corrected runtime client and Admin token flow. Existing QR rotation, GPS averaging, paid/unpaid leave blocking, short-leave payroll and cancellation safeguards are retained.

## Single database deliverable

**`supabase/schema.sql` is the only SQL file needed.** There is no migration directory in this release. The complete final-state script is one transaction with re-runnable table/column additions, Auth trigger, leave statuses, financial guards, audit log, cancellation RPC, payroll snapshot RPC and final least-privilege grants.

No existing employee, attendance, leave or salary rows are deleted or reset by the script. Existing settings are inserted only if absent. Existing application triggers/functions and the application's known permissive policies are replaced with the final definitions; this is intentional access/logic hardening, not data deletion. Legacy orphan profiles remain in place through a NOT VALID foreign key addition. If an existing database has incompatible custom constraints/types/data, a validation error rolls the transaction back rather than discarding records. Back up production before applying schema changes.

Do not execute old release migration files in addition to this master schema. The SQL is ready to run, not a list of manual code edits.

## Actual Worker bindings are still required

The runtime must supply matching-project values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or public/publishable alias supported by the resolver)
- **`SUPABASE_SERVICE_ROLE_KEY` — server-only Worker secret**

Aliases are normalized from Worker bindings only: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. Service and public keys are never interchangeable.

For local OpenNext development, Wrangler reads `.dev.vars` (template included); the application deliberately does not rely on `process.env`. For deployment, these are Worker runtime bindings, not just build variables. The runtime public-config endpoint means browser login no longer needs Supabase values baked into the build.

Source code cannot create missing Cloudflare secrets, repair a wrong-project key, confirm an actual password, or automatically promote an account to Admin. A missing profile or non-Admin role is reported explicitly rather than bypassed. Live credentials were not supplied and end-to-end production sign-in was not claimed.

## Verification commands

```sh
npm ci --legacy-peer-deps
npm test
npx tsc --noEmit
npx @opennextjs/cloudflare build
```

Use Node 22.12+ for the current Wrangler toolchain. Deploy the resulting Worker with your existing working workflow (`npx wrangler deploy`). Secrets and generated bundles are not included in the source ZIP.

## Verification completed

- TypeScript check passed.
- OpenNext Cloudflare build passed (existing non-fatal dependency duplicate-case warning remains).
- All existing GPS, overtime, payroll and embedded PostgreSQL tests passed.
- Master schema re-run with existing test leave records preserved those records.
- New mocked handler tests passed: runtime-only bindings despite conflicting process values; no module-global service clients; request project isolation; Admin session handoff; no public service-key leak; employee/legacy-ID login; second-device approval; auth error classification; failed-write handling; protected QR settings/rotation; approved-leave attendance blocking.
- Actual **local Wrangler/workerd** smoke test with dummy runtime-only bindings passed: `/api/public-config` returned the runtime URL/public key, Admin settings returned the expected 401 without a bearer (not a credentials error), and empty employee login reached validation and returned 400 (not a configuration error). No live Supabase authentication was attempted with dummy keys.

## Payroll scope preserved

Monthly base minus explicit approved unpaid/short leave deductions plus overtime. No unmarked-day, holiday, tax or statutory policy has been invented. Manual overtime remains a final-total override. Ambiguous known salary/rate changes hold PDF export for review. Reports are previews, not locked/finalized payroll periods. Historical records predating the audit log and overnight portal shift-date policy still require owner review.

`TEST_REPORT.md` records verification scope and limitations. `CHANGED_FILES.md` lists full replacement paths. The supplied complete-code document contains entire files, not diffs or instructions to edit individual lines.
