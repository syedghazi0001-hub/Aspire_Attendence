# v6.2.1 verification report

## Passed

1. `npm test`: original 19 overtime/GPS/employee-ID assertions; shared-payroll cases; mocked GPS averaging/cleanup; embedded PostgreSQL full-schema re-runs; new Cloudflare runtime/handler tests.
2. `npx tsc --noEmit`: zero errors.
3. `npx @opennextjs/cloudflare build`: successful, Worker generated.
4. Local Wrangler/workerd runtime smoke test (Node 22, dummy Worker bindings only):
   - Public runtime configuration: HTTP 200, expected runtime URL/anonymous key only.
   - Admin settings without bearer: HTTP 401 `ADMIN_SESSION_REQUIRED`, proving runtime configuration was accepted and authorization was preserved.
   - Empty employee login: HTTP 400 input validation, not missing-key error.
   - Temporary local Worker was stopped after testing.

## New mocked-handler coverage

- Setting incorrect process-level URL/service values cannot override request bindings.
- Two requests with different Worker URLs create separate clients against the correct projects.
- Importing route modules creates no server Supabase clients.
- Public config works without requiring a service key and never returns one.
- Missing runtime bindings produce configuration errors, not wrong-password errors.
- Admin Auth access/refresh session returned only after successful password authentication.
- Employee ID can resolve a retained legacy Auth email for that same Auth UUID.
- Employee custom device-session creation and second-device pending approval retained.
- Auth wrong password, rejected API key and failed DB write paths remain distinct; failed writes do not return success tokens.
- Admin QR settings load with verified Admin identity; anonymous calls denied; token update persisted in mock settings.
- Approved full-day leave blocks attendance before any write.

## SQL coverage

The single schema was executed repeatedly in isolated PGlite PostgreSQL, including a re-run after records were present. Existing test leave IDs/statuses/hours were unchanged. Auth profile creation, strict IDs, metadata privilege escalation prevention, full-day block, cancellation retention, short checkout, override range, audit records, atomic employee cancellation, invalid-token denial, anonymous access denial and Auth/profile cascade behavior passed.

PGlite excludes pgcrypto installation and stubs random-byte generation. It does not prove Supabase Auth password encryption, live project permissions, custom pre-existing schema compatibility, or production network availability.

## Remaining limits

- Production credentials/domain were not supplied. Actual Admin/employee password login, deployed QR scanning, phone GPS, session approvals and payroll must still be verified against that environment.
- Source cannot create a missing Worker secret or correct a wrong-project/invalid key. The new errors identify this honestly.
- OpenNext build retains an existing non-fatal duplicate-case warning in dependency-generated PDF bundle code. Build exits successfully.
- Previous release dependency audit had 3 moderate OpenNext/glob/minimatch findings; this runtime fix does not claim a full security audit or a zero-advisory dependency tree.
- No payroll-policy expansion, historical salary reconstruction, mid-month proration policy or finalized payroll-period lock is claimed.


## v6.2.1 additional checks

- No production source occurrence of the build-process environment accessor; all existing API routes audited for request-level Cloudflare context use.
- Existing UI components and Admin/Employee pages have no source changes relative to base commit `19b8a2b`.
- `keep_vars = true` and deploy `--keep-vars` regression assertions pass.
- Health endpoint reports the new release and no credential values, without constructing a Supabase client.
- Local workerd with runtime bindings: health 200, public config 200, Admin without bearer 401 (authorization retained), empty employee login 400 (input validation reached).
- Local workerd without runtime bindings: health 503 with the three expected binding names.
- TypeScript initially traversed local Wrangler-generated artifacts after runtime testing; compiler includes/excludes were narrowed to actual source, root config types and Next route types. `npx tsc --noEmit` then passed, as did the final OpenNext build.
- Master schema is unchanged from the already-consolidated repository schema; full SQL regression suite passed. Superseded migration files are excluded from this source package. Existing test rows survived re-running the master schema.
- All temporary local Workers were stopped. No production deployment, real Supabase password validation, or dashboard variable-retention experiment was performed.
