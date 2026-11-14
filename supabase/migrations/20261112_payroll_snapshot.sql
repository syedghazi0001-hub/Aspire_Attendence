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
