-- =================================================================================
-- PULSEHR CLOUD v5.1: NON-DESTRUCTIVE SUPABASE SCHEMA & AUTH TRIGGER ARCHITECTURE
-- Run this entire script in the Supabase SQL Editor. Safe to re-run at any time.
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
    -- Preserve existing profiles; NOT VALID below allows legacy orphans to be repaired manually.

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
          AND table_name = 'users'
          AND constraint_name = 'users_id_fkey'
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT users_id_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_employee_id ON public.users (employee_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);

-- =================================================================================
-- 2. CRITICAL POSTGRES TRIGGER: public.handle_new_user() ON auth.users
-- Uses SECURITY DEFINER SET search_path = public so RLS never blocks insertion.
-- =================================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
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
    v_full_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        SPLIT_PART(COALESCE(NEW.email, 'User'), '@', 1)
    );

    PERFORM pg_advisory_xact_lock(724601);
    v_employee_id := UPPER(COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'employee_id'), ''),
        (SELECT 'EMP ' || lpad((COALESCE(MAX(substring(employee_id from '[0-9]+$')::bigint), 0) + 1)::text, GREATEST(2, length((COALESCE(MAX(substring(employee_id from '[0-9]+$')::bigint), 0) + 1)::text)), '0') FROM public.users WHERE employee_id ~ '^EMP [0-9]+$')
    ));

    v_role := LOWER(COALESCE(
        NULLIF(TRIM(NEW.raw_app_meta_data->>'role'), ''),
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
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- =================================================================================
-- 2B. ATOMIC RPC FALLBACK: public.admin_create_employee()
-- Allows creating & confirming an employee in auth.users + public.users atomically.
-- =================================================================================
CREATE OR REPLACE FUNCTION public.admin_create_employee(
    p_email TEXT,
    p_password TEXT,
    p_employee_id TEXT,
    p_full_name TEXT,
    p_basic_salary NUMERIC DEFAULT 0,
    p_per_day_deduction NUMERIC DEFAULT 0,
    p_hourly_rate NUMERIC DEFAULT 0,
    p_overtime_rate NUMERIC DEFAULT 0,
    p_duty_start_time TIME DEFAULT '09:00:00',
    p_duty_end_time TIME DEFAULT '17:00:00',
    p_existing_auth_id UUID DEFAULT NULL
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, auth, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_encrypted_pw TEXT;
    v_result public.users;
BEGIN
    IF p_existing_auth_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users WHERE id = p_existing_auth_id) THEN
        v_user_id := p_existing_auth_id;
    ELSE
        SELECT id INTO v_user_id
        FROM auth.users
        WHERE LOWER(email) = LOWER(TRIM(p_email))
        LIMIT 1;
    END IF;

    v_encrypted_pw := crypt(p_password, gen_salt('bf'));

    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid();

        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at,
            confirmation_token,
            email_change,
            email_change_token_new,
            recovery_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            v_user_id,
            'authenticated',
            'authenticated',
            LOWER(TRIM(p_email)),
            v_encrypted_pw,
            NOW(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object(
                'full_name', TRIM(p_full_name),
                'employee_id', UPPER(TRIM(p_employee_id)),
                'role', 'employee',
                'monthly_salary', COALESCE(p_basic_salary, 0),
                'per_day_deduction', COALESCE(p_per_day_deduction, 0),
                'hourly_rate', COALESCE(p_hourly_rate, 0),
                'overtime_rate', COALESCE(p_overtime_rate, 0),
                'duty_start_time', p_duty_start_time::TEXT,
                'duty_end_time', p_duty_end_time::TEXT
            ),
            NOW(),
            NOW(),
            '',
            '',
            '',
            ''
        );

        INSERT INTO auth.identities (
            id,
            user_id,
            provider_id,
            identity_data,
            provider,
            last_sign_in_at,
            created_at,
            updated_at
        ) VALUES (
            gen_random_uuid(),
            v_user_id,
            v_user_id::text,
            jsonb_build_object(
                'sub', v_user_id::text,
                'email', LOWER(TRIM(p_email)),
                'email_verified', true,
                'phone_verified', false
            ),
            'email',
            NOW(),
            NOW(),
            NOW()
        ) ON CONFLICT DO NOTHING;
    ELSE
        UPDATE auth.users
        SET encrypted_password = v_encrypted_pw,
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            updated_at = NOW()
        WHERE id = v_user_id;
    END IF;

    INSERT INTO public.users (
        id,
        employee_id,
        full_name,
        role,
        device_id,
        basic_salary,
        monthly_salary,
        per_day_deduction,
        hourly_rate,
        overtime_rate,
        duty_start_time,
        duty_end_time
    ) VALUES (
        v_user_id,
        UPPER(TRIM(p_employee_id)),
        TRIM(p_full_name),
        'employee',
        NULL,
        COALESCE(p_basic_salary, 0),
        COALESCE(p_basic_salary, 0),
        COALESCE(p_per_day_deduction, 0),
        COALESCE(p_hourly_rate, 0),
        COALESCE(p_overtime_rate, 0),
        p_duty_start_time,
        p_duty_end_time
    )
    ON CONFLICT (id) DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        full_name = EXCLUDED.full_name,
        role = 'employee',
        basic_salary = EXCLUDED.basic_salary,
        monthly_salary = EXCLUDED.monthly_salary,
        per_day_deduction = EXCLUDED.per_day_deduction,
        hourly_rate = EXCLUDED.hourly_rate,
        overtime_rate = EXCLUDED.overtime_rate,
        duty_start_time = EXCLUDED.duty_start_time,
        duty_end_time = EXCLUDED.duty_end_time
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

ALTER FUNCTION public.admin_create_employee(TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIME, TIME, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_create_employee(TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TIME, TIME, UUID) TO anon, authenticated, service_role;

-- =================================================================================
-- 3. TABLE: public.attendance
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
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    leave_type TEXT NOT NULL CHECK (leave_type IN ('paid', 'unpaid', 'short')),
    hours_missed NUMERIC(6, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
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
-- 5. TABLE: public.active_sessions & public.session_requests
-- =================================================================================
CREATE TABLE IF NOT EXISTS public.active_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_fingerprint TEXT NOT NULL,
    device_info TEXT DEFAULT 'Web Browser',
    session_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
    is_active BOOLEAN NOT NULL DEFAULT true,
    approval_status TEXT NOT NULL DEFAULT 'pending_login' CHECK (approval_status IN ('pending_login', 'approved', 'pending_logout', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS device_info TEXT DEFAULT 'Web Browser';
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending_login';
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON public.active_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_token ON public.active_sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_active_sessions_status ON public.active_sessions (approval_status);

CREATE TABLE IF NOT EXISTS public.session_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL CHECK (request_type IN ('login', 'logout')),
    device_id TEXT NOT NULL,
    device_info TEXT DEFAULT 'Web Browser',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =================================================================================
-- 6. TABLE: public.settings
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
TO postgres, anon, authenticated, service_role, supabase_auth_admin
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_attendance" ON public.attendance;
CREATE POLICY "full_access_attendance"
ON public.attendance FOR ALL
TO postgres, anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_leaves" ON public.leaves;
CREATE POLICY "full_access_leaves"
ON public.leaves FOR ALL
TO postgres, anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_active_sessions" ON public.active_sessions;
CREATE POLICY "full_access_active_sessions"
ON public.active_sessions FOR ALL
TO postgres, anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_session_requests" ON public.session_requests;
CREATE POLICY "full_access_session_requests"
ON public.session_requests FOR ALL
TO postgres, anon, authenticated, service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "full_access_settings" ON public.settings;
CREATE POLICY "full_access_settings"
ON public.settings FOR ALL
TO postgres, anon, authenticated, service_role
USING (true)
WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role, supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role, supabase_auth_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role, supabase_auth_admin;

NOTIFY pgrst, 'reload schema';

-- v6 upgrade: future writes cannot create negative overtime. Existing records remain
-- untouched; API and payroll clamp historical negative values for display/payment.
CREATE OR REPLACE FUNCTION public.guard_attendance_overtime()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.overtime_hours := GREATEST(0, COALESCE(NEW.overtime_hours, 0));
  NEW.overtime_minutes := GREATEST(0, COALESCE(NEW.overtime_minutes, 0));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_overtime ON public.attendance;
CREATE TRIGGER guard_overtime BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_overtime();

-- Serialize employee identity writes to reject concurrent duplicate names/IDs.
-- Legacy profiles are preserved; validation applies only to new/changed identities.
CREATE OR REPLACE FUNCTION public.guard_employee_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(724601);
  IF NEW.role = 'employee' AND (TG_OP = 'INSERT' OR NEW.employee_id IS DISTINCT FROM OLD.employee_id) THEN
    IF NEW.employee_id !~ '^EMP (0[1-9]|[1-9][0-9]+)$' THEN
      RAISE EXCEPTION 'Employee ID must follow EMP 01 format' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.full_name IS DISTINCT FROM OLD.full_name OR NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id <> NEW.id AND
      (lower(regexp_replace(trim(u.full_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(NEW.full_name), '\s+', ' ', 'g')) OR upper(trim(u.employee_id)) = upper(trim(NEW.employee_id)))) THEN
      RAISE EXCEPTION 'Duplicate Full Name or Employee ID' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_employee_identity ON public.users;
CREATE TRIGGER guard_employee_identity BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_employee_identity();
NOTIFY pgrst, 'reload schema';

-- Run once in Supabase SQL Editor BEFORE deploying the application.
-- Transactional, preserves records; only expands leave status validation.
BEGIN;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.leaves'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
    EXECUTE format('ALTER TABLE public.leaves DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;
ALTER TABLE public.leaves ADD CONSTRAINT leaves_status_check CHECK (status IN ('pending','approved','rejected','cancelled')) NOT VALID;
ALTER TABLE public.leaves VALIDATE CONSTRAINT leaves_status_check;
COMMIT;
NOTIFY pgrst, 'reload schema';

-- Upgrade after 20261110_leave_cancellation.sql. Back up database first.
BEGIN;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS overtime_override_hours NUMERIC(8,2);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.attendance'::regclass AND conname='attendance_override_range') THEN
    ALTER TABLE public.attendance ADD CONSTRAINT attendance_override_range CHECK (overtime_override_hours IS NULL OR overtime_override_hours BETWEEN 0 AND 24) NOT VALID;
  END IF;
END $$;

-- Consistent lock key for simultaneous leave/attendance writes. Does not alter old records.
CREATE OR REPLACE FUNCTION public.guard_leave_attendance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Lock profile first: serializes writes even when no attendance/leave row exists.
  PERFORM 1 FROM public.users WHERE id=NEW.user_id FOR UPDATE;
  IF TG_TABLE_NAME = 'leaves' THEN
    IF NEW.status IN ('pending','approved') AND (NEW.hours_missed < 0 OR NEW.hours_missed > 24 OR (NEW.leave_type='short' AND NEW.hours_missed <= 0)) THEN
      RAISE EXCEPTION 'Short leave requires valid hours greater than zero (maximum 24)' USING ERRCODE='23514';
    END IF;
    IF NEW.status = 'approved' AND NEW.leave_type IN ('paid','unpaid') AND EXISTS
      (SELECT 1 FROM public.attendance WHERE user_id=NEW.user_id AND date=NEW.date AND (COALESCE(clock_in,login_time) IS NOT NULL OR overtime_hours>0)) THEN
      RAISE EXCEPTION 'Attendance or overtime exists on this date. Reconcile it before approving full-day leave.' USING ERRCODE='23514';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.leaves WHERE user_id=NEW.user_id AND date=NEW.date AND status='approved' AND leave_type IN ('paid','unpaid')) THEN
      RAISE EXCEPTION 'Approved full-day leave blocks attendance and overtime. Cancel leave first.' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' THEN
      IF COALESCE(OLD.clock_in,OLD.login_time) IS NOT NULL AND COALESCE(NEW.clock_in,NEW.login_time) IS DISTINCT FROM COALESCE(OLD.clock_in,OLD.login_time) THEN
        RAISE EXCEPTION 'Check-in already recorded; duplicate scan ignored.' USING ERRCODE='23514';
      END IF;
      IF COALESCE(OLD.clock_out,OLD.logout_time) IS NOT NULL AND COALESCE(NEW.clock_out,NEW.logout_time) IS DISTINCT FROM COALESCE(OLD.clock_out,OLD.logout_time) THEN
        RAISE EXCEPTION 'Check-out already recorded.' USING ERRCODE='23514';
      END IF;
    END IF;
    IF COALESCE(NEW.clock_out,NEW.logout_time) < COALESCE(NEW.clock_in,NEW.login_time) THEN
      RAISE EXCEPTION 'Check-out cannot precede check-in' USING ERRCODE='23514';
    END IF;
    IF NEW.overtime_hours < 0 OR NEW.overtime_hours > 24 THEN RAISE EXCEPTION 'Overtime must be between 0 and 24 hours' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_leave_attendance ON public.leaves;
CREATE TRIGGER guard_leave_attendance BEFORE INSERT OR UPDATE ON public.leaves FOR EACH ROW EXECUTE FUNCTION public.guard_leave_attendance();
DROP TRIGGER IF EXISTS guard_leave_attendance ON public.attendance;
CREATE TRIGGER guard_leave_attendance BEFORE INSERT OR UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.guard_leave_attendance();

CREATE TABLE IF NOT EXISTS public.payroll_change_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name TEXT NOT NULL, operation TEXT NOT NULL,
  row_id TEXT, old_record JSONB, new_record JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  database_role TEXT NOT NULL DEFAULT current_user
);
ALTER TABLE public.payroll_change_log ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.log_payroll_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
  INSERT INTO public.payroll_change_log(table_name,operation,row_id,old_record,new_record)
  VALUES (TG_TABLE_NAME,TG_OP,COALESCE(NEW.id::text,OLD.id::text),CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN COALESCE(NEW,OLD);
END; $$;
DROP TRIGGER IF EXISTS log_payroll_change ON public.leaves;
CREATE TRIGGER log_payroll_change AFTER INSERT OR UPDATE OR DELETE ON public.leaves FOR EACH ROW EXECUTE FUNCTION public.log_payroll_change();
DROP TRIGGER IF EXISTS log_payroll_change ON public.attendance;
CREATE TRIGGER log_payroll_change AFTER INSERT OR UPDATE OR DELETE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.log_payroll_change();
DROP TRIGGER IF EXISTS log_payroll_change ON public.users;
CREATE TRIGGER log_payroll_change AFTER INSERT OR UPDATE OR DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.log_payroll_change();

-- Browser clients must not bypass device/leave/financial validation with direct writes.
DROP POLICY IF EXISTS "full_access_users" ON public.users;
DROP POLICY IF EXISTS "full_access_attendance" ON public.attendance;
DROP POLICY IF EXISTS "full_access_leaves" ON public.leaves;
DROP POLICY IF EXISTS "full_access_active_sessions" ON public.active_sessions;
DROP POLICY IF EXISTS "full_access_session_requests" ON public.session_requests;
DROP POLICY IF EXISTS "full_access_settings" ON public.settings;
DROP POLICY IF EXISTS "read_own_profile" ON public.users;
CREATE POLICY "read_own_profile" ON public.users FOR SELECT TO authenticated USING (id=auth.uid());
REVOKE ALL ON public.users,public.attendance,public.leaves,public.active_sessions,public.session_requests,public.settings,public.payroll_change_log FROM anon,authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT ALL ON public.users,public.attendance,public.leaves,public.active_sessions,public.session_requests,public.settings,public.payroll_change_log TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_create_employee(TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TIME,TIME,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_employee(TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TIME,TIME,UUID) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';

BEGIN;
CREATE OR REPLACE FUNCTION public.sync_short_leave_hours()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.attendance SET missed_hours = CASE WHEN NEW.status='approved' AND NEW.leave_type='short' THEN NEW.hours_missed ELSE 0 END
  WHERE user_id=NEW.user_id AND date=NEW.date;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS sync_short_leave_hours ON public.leaves;
CREATE TRIGGER sync_short_leave_hours AFTER INSERT OR UPDATE ON public.leaves FOR EACH ROW EXECUTE FUNCTION public.sync_short_leave_hours();
COMMIT;

-- Single statement / consistent PostgreSQL snapshot for payroll inputs.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_payroll_inputs(p_month TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE start_date DATE; end_date DATE;
BEGIN
  IF p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid payroll month'; END IF;
  start_date := (p_month || '-01')::DATE;
  end_date := (start_date + INTERVAL '1 month')::DATE;
  RETURN (SELECT jsonb_build_object(
    'employees', COALESCE((SELECT jsonb_agg(to_jsonb(u) || jsonb_build_object('requires_rate_review', EXISTS (
      SELECT 1 FROM public.payroll_change_log c WHERE c.table_name='users' AND c.row_id=u.id::text AND c.operation='UPDATE'
      AND (c.changed_at AT TIME ZONE 'Asia/Karachi')::date >= start_date
      AND (c.old_record->'basic_salary' IS DISTINCT FROM c.new_record->'basic_salary'
        OR c.old_record->'monthly_salary' IS DISTINCT FROM c.new_record->'monthly_salary'
        OR c.old_record->'per_day_deduction' IS DISTINCT FROM c.new_record->'per_day_deduction'
        OR c.old_record->'hourly_rate' IS DISTINCT FROM c.new_record->'hourly_rate'
        OR c.old_record->'overtime_rate' IS DISTINCT FROM c.new_record->'overtime_rate')
    )) ORDER BY u.employee_id) FROM public.users u WHERE u.role='employee'), '[]'::jsonb),
    'attendance', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.date,a.id) FROM public.attendance a WHERE a.date>=start_date AND a.date<end_date), '[]'::jsonb),
    'leaves', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.date,l.id) FROM public.leaves l WHERE l.date>=start_date AND l.date<end_date), '[]'::jsonb),
    'snapshot_at', statement_timestamp()
  ));
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_payroll_inputs(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payroll_inputs(TEXT) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

BEGIN;
CREATE OR REPLACE FUNCTION public.cancel_employee_leave(p_user_id UUID,p_leave_id UUID,p_token TEXT,p_fingerprint TEXT)
RETURNS public.leaves LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE verified_user UUID; item public.leaves;
BEGIN
  SELECT user_id INTO verified_user FROM public.active_sessions WHERE session_token=p_token AND device_fingerprint=p_fingerprint AND is_active=true AND approval_status IN ('approved','pending_logout') FOR SHARE;
  IF verified_user IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Approved device session required'; END IF;
  PERFORM 1 FROM public.users WHERE id=verified_user FOR UPDATE;
  SELECT * INTO item FROM public.leaves WHERE id=p_leave_id AND user_id=verified_user AND status='approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved leave not found'; END IF;
  IF item.date < (now() AT TIME ZONE 'Asia/Karachi')::DATE THEN RAISE EXCEPTION 'Historical cancellation requires Admin review'; END IF;
  IF item.leave_type='short' AND EXISTS (SELECT 1 FROM public.attendance WHERE user_id=verified_user AND date=item.date AND COALESCE(clock_in,login_time) IS NOT NULL) THEN
    RAISE EXCEPTION 'Short leave after check-in requires Admin review to protect payroll';
  END IF;
  UPDATE public.leaves SET status='cancelled' WHERE id=item.id RETURNING * INTO item;
  RETURN item;
END; $$;
REVOKE EXECUTE ON FUNCTION public.cancel_employee_leave(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_employee_leave(UUID,UUID,TEXT,TEXT) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';

CREATE INDEX IF NOT EXISTS idx_payroll_change_lookup ON public.payroll_change_log(table_name,row_id,changed_at);
