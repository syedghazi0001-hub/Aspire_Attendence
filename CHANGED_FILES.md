# Full replacement files — Cloudflare runtime fix v6.2

Base commit: `200d8072bee309b87372cde0e7635b2169641d1b`.

- `.dev.vars.example`
- `.env.example`
- `README.md`
- `TEST_REPORT.md`
- `UPGRADE_START_HERE.md`
- `next.config.mjs`
- `package-lock.json`
- `package.json`
- `src/app/api/admin/attendance/route.ts`
- `src/app/api/admin/employees/route.ts`
- `src/app/api/admin/leaves/route.ts`
- `src/app/api/admin/payroll/route.ts`
- `src/app/api/admin/sessions/route.ts`
- `src/app/api/admin/settings/route.ts`
- `src/app/api/employee/attendance/route.ts`
- `src/app/api/employee/leave/route.ts`
- `src/app/api/employee/login/route.ts`
- `src/app/api/employee/session/route.ts`
- `src/app/api/public-config/route.ts`
- `src/app/employee/page.tsx`
- `src/app/page.tsx`
- `src/components/AdminShell.tsx`
- `src/lib/adminFetch.ts`
- `src/lib/requireAdmin.ts`
- `src/lib/supabaseAdmin.ts`
- `src/lib/supabaseClient.ts`
- `src/lib/supabaseRuntime.ts`
- `supabase/schema.sql`
- `tests/cloudflare-runtime.cjs`
- `tests/database-regression.cjs`

The old `supabase/migrations/` folder is not part of the new release. Only `supabase/schema.sql` is needed. No production repository or database was modified.
