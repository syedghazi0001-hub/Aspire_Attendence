# v6.2.1 changes

Base commit: `19b8a2be68b152ccaec022fa39ec9601dae7a3f5`.

## Modified/new
- `README.md`
- `TEST_REPORT.md`
- `UPGRADE_START_HERE.md`
- `package-lock.json`
- `package.json`
- `src/app/api/health/route.ts`
- `src/app/api/public-config/route.ts`
- `src/lib/release.ts`
- `src/lib/supabaseRuntime.ts`
- `tests/cloudflare-runtime.cjs`
- `tsconfig.json`
- `wrangler.toml`

All other API routes were audited and retained. The complete-code document also supplies those routes for convenience. Existing UI pages/components were not altered.

The package contains only `supabase/schema.sql`; superseded migration files are omitted. It does not modify the remote GitHub repository or deployed Worker.
