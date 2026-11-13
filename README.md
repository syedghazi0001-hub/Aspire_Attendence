# PulseHR Cloud v6.0 — Attendance, Device Lock & Payroll Portal

**Tech Stack:** Next.js 15 (App Router) • Supabase (PostgreSQL + Auth) • Cloudflare Workers (`@opennextjs/cloudflare`) • Tailwind CSS • Framer Motion (Apple Keynote 3D Glassmorphism UI)

---

## 1. Run the SQL Schema in Supabase (`supabase/schema.sql`)

1. Log in to your [Supabase Dashboard](https://supabase.com/dashboard) and open your project.
2. Navigate to **SQL Editor** → click **New Query**.
3. Copy the entire contents of **`supabase/schema.sql`** and click **Run**.

### What `supabase/schema.sql` Sets Up (100% Non-Destructive):
- **`public.users`**: Linked to `auth.users(id)` with `ON DELETE CASCADE`. Includes `full_name`, `employee_id` (unique), `role`, `monthly_salary`, `per_day_deduction`, `hourly_rate`, `overtime_rate`, `duty_start_time`, and `duty_end_time`.
- **`public.handle_new_user()` Trigger on `auth.users`**: Automatically inserts newly created Auth users (`supabase.auth.admin.createUser`) into `public.users` using `NEW.raw_user_meta_data` **without any Foreign Key errors**.
- **`public.attendance`**: Stores `user_id`, `date`, `clock_in`, `clock_out`, `status`, `overtime_hours`, and `missed_hours`.
- **`public.leaves`**: Stores `user_id`, `date`, `leave_type` (`paid`/`unpaid`/`short`), `hours_missed`, and `status` (`pending`/`approved`/`rejected`).
- **`public.active_sessions`**: Tracks strict single-device logins with `user_id`, `device_fingerprint`, `is_active`, and `approval_status` (`pending_login`, `approved`, `pending_logout`).
- **`public.settings`**: Stores workplace GPS coordinates (`office_lat`, `office_lng`, `radius_meters`, `qr_secret`).
- **RLS Policies**: Grants full `SELECT, INSERT, UPDATE, DELETE` access for Admin operations.

---

## 2. Create Your First Admin Account in Supabase

1. In your Supabase Dashboard, go to **Authentication → Users** → click **Add User → Create New User**.
2. Enter your Admin Email (e.g., `admin@company.com`), Password, check **Auto Confirm User**, and click **Create User**.
3. If you want to explicitly mark your account as `admin` in `public.users`, run this in the **SQL Editor**:
   ```sql
   UPDATE public.users SET role = 'admin' WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@company.com');
   ```
   Use your own administrator email in the SQL above.

---

## 3. Push the Project to GitHub

Open a terminal inside the extracted project folder and run:

```bash
git init
git add .
git commit -m "Initial commit: PulseHR Cloud v6.0 Next.js 15 + Supabase + Cloudflare Workers"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

---

## 4. Connect to Cloudflare Workers & Configure Environment Variables

This project includes `wrangler.toml`, `open-next.config.ts`, and `@opennextjs/cloudflare` out of the box. All API routes resolve environment variables from Cloudflare's `context.env` / `getCloudflareContext().env` with fallback to `process.env`.

### Option A: Deploy via Cloudflare Dashboard (GitHub Integration)
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Workers** → **Import a repository**.
2. Select your GitHub repository.
3. Configure the build settings:
   - **Build command:** `npx @opennextjs/cloudflare build`
   - **Deploy command:** `npx wrangler deploy`
4. Under **Settings → Variables and Secrets** (and **Build Variables**), add these **3 Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://your-project-id.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `your-supabase-anon-public-key`
   - `SUPABASE_SERVICE_ROLE_KEY` = `your-supabase-service-role-secret-key` *(Required for `supabase.auth.admin.createUser` when adding employees)*
5. Click **Save and Deploy**.

### Option B: Deploy via Wrangler CLI
```bash
npm install --legacy-peer-deps
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

---

## 5. Local Development

1. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```
2. Copy `.env.example` to `.env.local` and fill in your keys:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-public-key
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret-key
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000).


## v6 changes and verification

- Employee tabs: Check-In, Check-Out, Apply for Leave, optional Reason, and live leave-history status.
- Admin: named/identified leave review cards on the dashboard and four leave-ledger tabs; approve Paid/Unpaid or Reject.
- Manual overtime: dashboard modal accepts Employee, PKT Date, Hours. Saving **sets/replaces** that date's stored overtime total. If entered before check-out, those hours are treated as a manual adjustment and added to the automatic overtime at check-out. For a final total correction, save after check-out.
- Overtime uses max(0, CheckOut - max(DutyEnd, CheckIn)); negative historical values are clamped in the API and payroll. Early arrival adds no overtime. Overnight scheduled shifts are supported by the calculation helper.
- GPS uses unrounded Haversine meters (mean Earth radius 6,371,008.8m), with an exact distance <= radius test and no extra tolerance. Radius accepts 1m, 10m, 100m, etc. GPS device accuracy is not guaranteed: a strict 1m geofence can reject legitimate users whose phone location is imprecise.
- Generate New QR Code rotates the saved settings token; subsequent scans of older tokens are rejected. Static-vs-dynamic architecture is documented in QrGeneratorCard.tsx. QR rotation is manual, not timed auto-rotation.
- IDs use EMP 01, EMP 02, through EMP 100 and beyond. The next ID is suggested; duplicate names (case/whitespace-insensitive) and IDs are rejected. Existing legacy IDs/profiles are not bulk-renamed.
- Glass/crystal UI, lightweight typography, dark neutral surfaces, and Framer Motion transitions/modal animations.

### Upgrade
1. Back up your database and run the entire `supabase/schema.sql` in SQL Editor.
2. Configure public Supabase URL/key for the frontend build and Worker runtime. Keep the service-role key as a **server-only Worker secret**, never a NEXT_PUBLIC variable.
3. Install with `npm ci --legacy-peer-deps`, then run `npx @opennextjs/cloudflare build` and deploy with Wrangler.
4. Existing data is not deleted by the schema. Legacy orphan profiles are retained; repair them before validating the added Auth FK. Duplicate legacy identities are preserved, but new duplicate writes are rejected.

### Checks included
- `node tests/regression.cjs`: 19 assertions for daytime/overnight overtime, the reported 12:51–12:59 case, strict sub-meter radius boundaries, invalid coordinates, and employee IDs.
- `npx tsc --noEmit`: TypeScript check.
- `npx @opennextjs/cloudflare build`: Next.js compilation plus Cloudflare Worker packaging.

These are local build/regression checks, not a live Supabase/phone acceptance test. Before production, verify QR rotation, leave approval, employee creation/deletion, and two-device session approval using your own configured database. Review inherited broad RLS policies/API authorization before exposing the application publicly; this feature update is not a security audit.
