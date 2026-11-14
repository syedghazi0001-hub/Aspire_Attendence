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
