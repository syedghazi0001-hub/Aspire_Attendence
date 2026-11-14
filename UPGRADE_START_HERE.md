# v6.2.1 complete project

This is a source update to repository commit `19b8a2b`, not a new application.

- Full code is ready to replace; no line edits are required.
- Only database deliverable: `supabase/schema.sql` (complete, transactional, re-runnable; no row deletion/reset commands).
- Deploy configuration preserves dashboard-managed runtime variables with `keep_vars = true`; `npm run deploy` also passes `--keep-vars`.
- Existing runtime variables must still exist on your deployed Worker. Retention cannot recreate absent values. Never place the service key in a browser/public-key field or commit it.
- `GET /api/health` should report `6.2.1-runtime-bindings`. It reports missing binding names without key values. It does not verify actual passwords/database reachability.
- Existing UI, attendance, payroll, leave, QR and device-lock features remain included.
- Build, TypeScript, SQL, payroll, GPS, mocked route and local Worker checks are documented in `TEST_REPORT.md`.
