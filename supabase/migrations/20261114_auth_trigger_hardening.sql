-- Upgrade existing Auth trigger as well as RLS; preserves existing users.
BEGIN;
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


CREATE INDEX IF NOT EXISTS idx_payroll_change_lookup ON public.payroll_change_log(table_name,row_id,changed_at);
NOTIFY pgrst,'reload schema';

COMMIT;
