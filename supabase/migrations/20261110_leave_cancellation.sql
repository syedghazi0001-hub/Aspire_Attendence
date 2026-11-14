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
