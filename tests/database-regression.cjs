// Embedded PostgreSQL tests; no connection to the production database.
// pgcrypto is not bundled in this test engine, so only randomness is stubbed.
// Auth sign-in/password hashing remains an integration test on real Supabase.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs'); const assert = require('node:assert/strict');
(async () => {
 const db = new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE supabase_auth_admin;
 CREATE SCHEMA auth; CREATE SCHEMA extensions;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE FUNCTION public.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS 'SELECT decode(repeat(''ab'', $1), ''hex'')';
 CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}');
 CREATE TABLE auth.identities(id uuid PRIMARY KEY);`);
 const schema = fs.readFileSync('supabase/schema.sql','utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- pgcrypto excluded in embedded test only');
 await db.exec(schema); await db.exec(schema); // idempotent complete schema
 const uid='11111111-1111-4111-8111-111111111111';
 await db.exec(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('${uid}','employee@example.com','{"full_name":"Test Employee","employee_id":"EMP 01","role":"admin"}');`);
 let profile = (await db.query(`SELECT * FROM public.users WHERE id='${uid}'`)).rows[0];
 const snapshot = (await db.query("SELECT public.get_payroll_inputs('2026-11') AS snapshot")).rows[0].snapshot; assert.equal(snapshot.employees.length,1); assert.ok(Array.isArray(snapshot.attendance));
 assert.equal(snapshot.employees[0].requires_rate_review,false);
 assert.equal(profile.employee_id,'EMP 01'); assert.equal(profile.role,'employee');
 await assert.rejects(db.exec(`UPDATE public.users SET employee_id='EMP 1' WHERE id='${uid}'`), /EMP 01/);
 await db.exec(`INSERT INTO public.leaves(user_id,date,leave_type,status) VALUES('${uid}','2026-11-10','paid','approved');`);
 await assert.rejects(db.exec(`INSERT INTO public.attendance(user_id,date,clock_in) VALUES('${uid}','2026-11-10','2026-11-10T09:00:00+05:00');`), /full-day leave/);
 await db.exec(`UPDATE public.leaves SET status='cancelled'; INSERT INTO public.attendance(user_id,date,clock_in) VALUES('${uid}','2026-11-10','2026-11-10T09:00:00+05:00');`);
 assert.equal((await db.query('SELECT status FROM public.leaves')).rows[0].status,'cancelled');
 await assert.rejects(db.exec(`UPDATE public.leaves SET status='approved'`), /Attendance or overtime exists/);
 await db.exec(`UPDATE public.leaves SET leave_type='short',hours_missed=2,status='approved'; UPDATE public.attendance SET clock_out='2026-11-10T17:00:00+05:00';`);
 await assert.rejects(db.exec(`UPDATE public.attendance SET clock_in='2026-11-10T10:00:00+05:00';`), /already recorded/);
 await assert.rejects(db.exec(`UPDATE public.attendance SET overtime_override_hours=-1;`), /constraint/);
 assert.ok(Number((await db.query('SELECT count(*) FROM public.payroll_change_log')).rows[0].count)>=5);
 const sessionToken = 'test-token-not-a-production-secret';
 await db.exec(`INSERT INTO public.active_sessions(user_id,device_fingerprint,session_token,approval_status) VALUES('${uid}','test-fp','${sessionToken}','approved');
 INSERT INTO public.leaves(user_id,date,leave_type,status) VALUES('${uid}',(now() AT TIME ZONE 'Asia/Karachi')::date+1,'paid','approved');`);
 const future=(await db.query(`SELECT id FROM public.leaves WHERE date=(now() AT TIME ZONE 'Asia/Karachi')::date+1`)).rows[0].id;
 await db.query(`SELECT public.cancel_employee_leave($1,$2,$3,$4)`,[uid,future,sessionToken,'test-fp']);
 assert.equal((await db.query(`SELECT status FROM public.leaves WHERE id=$1`,[future])).rows[0].status,'cancelled');
 await assert.rejects(db.query(`SELECT public.cancel_employee_leave($1,$2,$3,$4)`,[uid,future,'wrong-token','test-fp']), /session required/);
 await db.exec('SET ROLE anon');
 await assert.rejects(db.exec(`SELECT * FROM public.leaves`), /permission denied/);
 await db.exec('RESET ROLE');
 const beforeRerun = await db.query('SELECT id,status,hours_missed FROM public.leaves ORDER BY id');
 await db.exec(schema);
 assert.deepEqual((await db.query('SELECT id,status,hours_missed FROM public.leaves ORDER BY id')).rows,beforeRerun.rows);
 await db.exec(`DELETE FROM auth.users WHERE id='${uid}'`);
 assert.equal((await db.query(`SELECT count(*) FROM public.users`)).rows[0].count,0);
 assert.equal((await db.query(`SELECT count(*) FROM public.attendance`)).rows[0].count,0);
 console.log('PASS: full schema twice; Auth profile creation, strict IDs, no metadata privilege escalation, full-day blocking, cancellation retained, conflicts, short check-out, overrides, audit, anonymous access denied and cascade delete.');
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
