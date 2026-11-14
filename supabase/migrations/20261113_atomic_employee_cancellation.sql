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
