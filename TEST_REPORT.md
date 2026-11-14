# Verification report

## Executed successfully

- `npx tsc --noEmit` — zero TypeScript errors. Next.js route handlers keep their second argument typed as required `context: any` / `_context: any`, not custom RouteContext.
- `npx @opennextjs/cloudflare build` — completed successfully; Worker generated.
- `npm test`:
  - Original **19 assertions**: daytime/overnight overtime, reported 12:51–12:59 case, reversed timestamps, strict 1m numerical boundary, invalid coordinates, employee ID patterns and next ID.
  - Shared payroll tests: paid/unpaid/short/cancelled states, one-time deduction, negative historical OT review, OT-only rows, duplicate dates, leave/attendance overlap, zero rates, wrong-month exclusion, fractional currency, rate-change review, and after-midnight calculation.
  - Mock GPS tests: rejects >30m accuracy, averages five valid readings, exact watch options, abort cleanup, permission-denied cleanup.
  - Embedded PostgreSQL: complete schema run twice, Auth profile creation, strict IDs, denial of metadata-based privilege escalation, consistent payroll input function, full-day attendance block, retained cancellation record, reapproval overlap rejection, short-leave check-out, timestamp duplicate protection, negative override constraint, audit creation, atomic employee cancellation, wrong-token denial, anonymous table-access denial and Auth cascade-delete.

## Test limitations / warnings

- Embedded PostgreSQL is **PGlite**, not the live Supabase service. The test substitutes `gen_random_bytes` and omits the `pgcrypto` extension installation. It does not test real password encryption, Auth sign-in, deployed Worker secrets or real device behavior.
- Build emits a **non-fatal duplicate-case warning** in bundled dependency code associated with the employees/PDF bundle. It is not a TypeScript error; build exit status was 0. Do not interpret this as a warning-free build.
- jsPDF upgraded to 4.2.1-compatible range and PostCSS to patched 8.5.33-compatible range, including transitive PostCSS override. Final dependency audit still reported **3 moderate findings** in the OpenNext/glob/minimatch chain. No critical/high findings remained in that check. No blanket `npm audit fix --force` or framework-major downgrade was applied.
- Real concurrent multi-client requests, schema variations in the existing live database, camera scanning, phone accuracy and session approvals must be tested on staging. Database guards are exercised sequentially by regression tests; concurrent stress/load testing has not been performed.
- Salary/rate-effective-date allocation, statutory policy, period finalization and historical reconstruction are not implemented. Ambiguous known rate changes block report export for review; that is intentional, not an automatic proration calculation.

## Before authorizing real salary

1. Back up and migrate a staging copy, then explicitly verify Admin role and Worker secrets.
2. Use test accounts: approve each Paid/Unpaid/Short type; verify blocking vs permitted checkout; cancel from employee/Admin and verify ledger/history/deduction change.
3. Verify a short-leave cancellation after check-in is denied to the employee but available to Admin review.
4. Rotate QR, reject old code, accept new code with proper GPS. Save GPS and ensure QR token is unchanged.
5. Test same-device login and second-device request approval/rejection. Test Request Logout approval and employee add/delete.
6. Compare payroll table and PDF using independently calculated examples, including configured zero rates and manual OT repeated saves.
7. Review any historical negatives, incomplete records and leave/work overlaps. Do not authorize REVIEW REQUIRED rows. Reconcile rate changes using original payroll records.
8. Confirm your actual attendance, weekend/holiday, joining/leaving, overtime and statutory deduction policy matches this explicit-leave preview model.
