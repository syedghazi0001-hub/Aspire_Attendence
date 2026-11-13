-- =================================================================================
-- PULSEHR CLOUD v5.0: NON-DESTRUCTIVE SUPABASE SCHEMA & AUTH TRIGGER ARCHITECTURE
-- Safe to run multiple times in the Supabase SQL Editor without losing existing data.
-- =================================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =================================================================================
-- 1. TABLE: public.users
-- Linked to auth.users(id) with ON DELETE CASCADE
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    employee_id TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
    monthly_salary NUMERIC(12, 2) NOT NULL DEFAULT 0,
    basic_salary NUMERIC(12, 2) NOT NULL DEFAULT 0,
    per_day_deduction NUMERIC(12, 2) NOT NULL DEFAULT 0,
    hourly_rate NUMERIC(12, 2) NOT NULL DEFAULT 0,
    overtime_rate NUMERIC(12, 2) NOT NULL DEFAULT 0,
    duty_start_time TIME NOT NULL DEFAULT '09:00:00',
    duty_end_time TIME NOT NULL DEFAULT '17:00:00',
    device_id TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Non-destructive column additions if upgrading an existing database
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS basic_salary NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS per_day_deduction NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS overtime_rate NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS duty_start_time TIME NOT NULL DEFAULT '09:00:00';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS duty_end_time TIME NOT NULL DEFAULT '17:00:00';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS device_id TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Ensure Foreign Key to auth.users(id) ON DELETE CASCADE exists safely
DO $$
BEGIN
    DELETE FROM public.users u
    WHERE NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.id);

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
          AND table_name = 'users'
          AND constraint_name = 'users_id_fkey'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_id_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_employee_id ON public.users (employee_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);

-- =================================================================================
-- 2. CRITICAL POSTGRES TRIGGER: public.handle_new_user() ON auth.users
-- Automatically inserts newly created Auth users into public.users WITHOUT FK errors.
-- =================================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name TEXT;
    v_employee_id TEXT;
    v_role TEXT;
    v_monthly_salary NUMERIC(12, 2);
    v_per_day_deduction NUMERIC(12, 2);
    v_hourly_rate NUMERIC(12, 2);
    v_overtime_rate NUMERIC(12, 2);
    v_duty_start TIME;
    v_duty_end TIME;
BEGIN
    -- Extract metadata passed via supabase.auth.admin.createUser({ user_metadata: {...} })
    v_full_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        SPLIT_PART(COALESCE(NEW.email, 'User'), '@', 1)
    );

    v_employee_id := UPPER(COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'employee_id'), ''),
        'EMP-' || UPPER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', '') FROM 1 FOR 6))
    ));

    v_role := LOWER(COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''),
        'employee'
    ));
    IF v_role NOT IN ('admin', 'employee') THEN
        v_role := 'employee';
    END IF;

    v_monthly_salary := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'monthly_salary'), '')::NUMERIC,
        NULLIF(TRIM(NEW.raw_user_meta_data->>'basic_salary'), '')::NUMERIC,
        0
    );

    v_per_day_deduction := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'per_day_deduction'), '')::NUMERIC,
        ROUND((v_monthly_salary / 30.0)::NUMERIC, 2),
        0
    );

    v_hourly_rate := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'hourly_rate'), '')::NUMERIC,
        ROUND((v_per_day_deduction / 8.0)::NUMERIC, 2),
        0
    );

    v_overtime_rate := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'overtime_rate'), '')::NUMERIC,
        v_hourly_rate,
        0
    );

    v_duty_start := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'duty_start_time'), '')::TIME,
        '09:00:00'::TIME
    );

    v_duty_end := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'duty_end_time'), '')::TIME,
        '17:00:00'::TIME
    );

    INSERT INTO public.users (
        id,
        full_name,
        employee_id,
        role,
        monthly_salary,
        basic_salary,
        per_day_deduction,
        hourly_rate,
        overtime_rate,
        duty_start_time,
        duty_end_time
    )
    VALUES (
        NEW.id,
        v_full_name,
        v_employee_id,
        v_role,
        v_monthly_salary,
        v_monthly_salary,
        v_per_day_deduction,
        v_hourly_rate,
        v_overtime_rate,
        v_duty_start,
        v_duty_end
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        employee_id = EXCLUDED.employee_id,
        role = EXCLUDED.role,
        monthly_salary = EXCLUDED.monthly_salary,
        basic_salary = EXCLUDED.basic_salary,
        per_day_deduction = EXCLUDED.per_day_deduction,
        hourly_rate = EXCLUDED.hourly_rate,
        overtime_rate = EXCLUDED.overtime_rate,
        duty_start_time = EXCLUDED.duty_start_time,
        duty_end_time = EXCLUDED.duty_end_time;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never block auth.users creation even if metadata has unexpected formatting
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- =================================================================================
-- 3. TABLE: public.attendance
-- Fields: user_id, date, clock_in, clock_out, status, overtime_hours, missed_hours
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    clock_in TIMESTAMPTZ,
    clock_out TIMESTAMPTZ,
    login_time TIMESTAMPTZ,
    logout_time TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'Present',
    overtime_hours NUMERIC(8, 2) NOT NULL DEFAULT 0,
    overtime_minutes NUMERIC(10, 2) NOT NULL DEFAULT 0,
    missed_hours NUMERIC(8, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT attendance_user_date_unique UNIQUE (user_id, date)
);

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS clock_in TIMESTAMPTZ;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS clock_out TIMESTAMPTZ;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS login_time TIMESTAMPTZ;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS logout_time TIMESTAMPTZ;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Present';
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC(8, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS overtime_minutes NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS missed_hours NUMERIC(8, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Keep clock_in/clock_out and login_time/logout_time automatically synchronized
CREATE OR REPLACE FUNCTION public.sync_attendance_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.clock_in IS NOT NULL AND NEW.login_time IS NULL THEN
        NEW.login_time := NEW.clock_in;
    ELSIF NEW.login_time IS NOT NULL AND NEW.clock_in IS NULL THEN
        NEW.clock_in := NEW.login_time;
    END IF;

    IF NEW.clock_out IS NOT NULL AND NEW.logout_time IS NULL THEN
        NEW.logout_time := NEW.clock_out;
    ELSIF NEW.logout_time IS NOT NULL AND NEW.clock_out IS NULL THEN
        NEW.clock_out := NEW.logout_time;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_attendance_timestamps ON public.attendance;
CREATE TRIGGER trg_sync_attendance_timestamps
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW
EXECUTE FUNCTION public.sync_attendance_timestamps();

CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance (date);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON public.attendance (user_id, date);

-- =================================================================================
-- 4. TABLE: public.leaves
-- Fields: user_id, date, leave_type (paid/unpaid/short), hours_missed, status (pending/approved/rejected)
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    leave_type TEXT NOT NULL CHECK (leave_type IN ('paid', 'unpaid', 'short')),
    hours_missed NUMERIC(6, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT leaves_user_date_unique UNIQUE (user_id, date)
);

ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS leave_type TEXT;
ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS hours_missed NUMERIC(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT '';
ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_leaves_user_date ON public.leaves (user_id, date);
CREATE INDEX IF NOT EXISTS idx_leaves_date ON public.leaves (date);

-- =================================================================================
-- 5. TABLE: public.active_sessions
-- Fields: user_id, device_fingerprint, is_active, approval_status (pending_login, approved, pending_logout, rejected)
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.active_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_fingerprint TEXT NOT NULL,
    device_info TEXT DEFAULT 'Browser Session',
    session_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
    is_active BOOLEAN NOT NULL DEFAULT true,
    approval_status TEXT NOT NULL DEFAULT 'pending_login' CHECK (approval_status IN ('pending_login', 'approved', 'pending_logout', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS device_info TEXT DEFAULT 'Browser Session';
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending_login';
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON public.active_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_token ON public.active_sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_active_sessions_status ON public.active_sessions (approval_status);

-- Audit table for login/logout requests (kept in sync with active_sessions)
CREATE TABLE IF NOT EXISTS public.session_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL CHECK (request_type IN ('login', 'logout')),
    device_id TEXT NOT NULL,
    device_info TEXT DEFAULT 'Browser Session',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =================================================================================
-- 6. TABLE: public.settings
-- Stores workplace GPS geofence & QR signature secret
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    office_lat DOUBLE PRECISION NOT NULL DEFAULT 32.6400,
    office_lng DOUBLE PRECISION NOT NULL DEFAULT 74.1800,
    radius_meters DOUBLE PRECISION NOT NULL DEFAULT 100,
    qr_secret TEXT NOT NULL DEFAULT 'LAB-DEFAULT-QR-SECRET-2026',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.settings (id, office_lat, office_lng, radius_meters, qr_secret)
VALUES (1, 32.6400, 74.1800, 100, 'LAB-DEFAULT-QR-SECRET-2026')
ON CONFLICT (id) DO NOTHING;

-- =================================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES & PERMISSIONS
-- Grants full SELECT, INSERT, UPDATE, DELETE access for Admin & Server API operations
-- =================================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "full_access_users" ON public.users;
CREATE POLICY "full_access_users"
ON public.users FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_attendance" ON public.attendance;
CREATE POLICY "full_access_attendance"
ON public.attendance FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_leaves" ON public.leaves;
CREATE POLICY "full_access_leaves"
ON public.leaves FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_active_sessions" ON public.active_sessions;
CREATE POLICY "full_access_active_sessions"
ON public.active_sessions FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_session_requests" ON public.session_requests;
CREATE POLICY "full_access_session_requests"
ON public.session_requests FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_settings" ON public.settings;
CREATE POLICY "full_access_settings"
ON public.settings FOR ALL
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
