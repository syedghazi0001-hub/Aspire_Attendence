# PulseHR Cloud v5.0 — Attendance, Device Lock & Payroll Portal

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
   UPDATE public.users SET role = 'admin' WHERE employee_id LIKE 'EMP-%';
   ```
   *(Any email login that is not an employee record is also automatically treated as an Admin).*

---

## 3. Push the Project to GitHub

Open a terminal inside the extracted project folder and run:

```bash
git init
git add .
git commit -m "Initial commit: PulseHR Cloud v5.0 Next.js 15 + Supabase + Cloudflare Workers"
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
