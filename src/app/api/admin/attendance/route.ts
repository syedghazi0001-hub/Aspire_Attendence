/* eslint-disable @typescript-eslint/no-explicit-any */
import { selectAll } from "@/lib/selectAll";
import { requireAdmin } from "@/lib/requireAdmin";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";

function createAdminClientFromCloudflare(req: NextRequest, cfEnv: Record<string, any>) {

  const supabaseUrl = String(
    cfEnv.NEXT_PUBLIC_SUPABASE_URL ||
      cfEnv.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      ""
  ).trim();

  const anonKey = String(
    cfEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      cfEnv.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ""
  ).trim();

  const serviceRoleKey = String(
    cfEnv.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
  ).trim();

  const activeKey = serviceRoleKey || anonKey;
  if (!supabaseUrl || !activeKey) return null;

  const authHeader = req.headers.get("authorization") || "";
  return createClient(supabaseUrl, activeKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(!serviceRoleKey && authHeader
      ? { global: { headers: { Authorization: authHeader } } }
      : {}),
  });
}

export async function GET(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  const client = createAdminClientFromCloudflare(req, cfEnv);
  if (!client) {
    return NextResponse.json({ attendance: [], records: [] });
  }

  try {
    const { searchParams } = new URL(req.url);
    const dateFilter = searchParams.get("date");
    const monthFilter = searchParams.get("month");

    let query = client
      .from("attendance")
      .select(
        `
        *,
        users (
          id,
          employee_id,
          full_name,
          monthly_salary,
          basic_salary,
          per_day_deduction,
          hourly_rate,
          overtime_rate,
          duty_start_time,
          duty_end_time
        )
      `
      )
      .order("date", { ascending: false });

    if (dateFilter) {
      query = query.eq("date", dateFilter);
    } else if (monthFilter && /^\d{4}-\d{2}$/.test(monthFilter)) {
      query = query
        .gte("date", `${monthFilter}-01`)
        .lt("date", new Date(Date.UTC(Number(monthFilter.slice(0, 4)), Number(monthFilter.slice(5, 7)), 1)).toISOString().slice(0, 10));
    }

    const [{ data, error }, { data: allUsers }] = await Promise.all([
      selectAll(query.order("id", { ascending: true })),
      client
        .from("users")
        .select(
          "id, employee_id, full_name, monthly_salary, basic_salary, per_day_deduction, hourly_rate, overtime_rate, duty_start_time, duty_end_time"
        ),
    ]);

    if (error) {
      return NextResponse.json(
        { error: error.message, attendance: [], records: [] },
        { status: 500 }
      );
    }

    const userMap = new Map<string, Record<string, any>>();
    (allUsers || []).forEach((u: Record<string, any>) => {
      if (u && u.id) userMap.set(String(u.id), u);
    });

    const normalized = (data || []).map((row: Record<string, any>) => {
      const joinedUser = Array.isArray(row.users) ? row.users[0] : row.users;
      const resolvedUser =
        joinedUser || userMap.get(String(row.user_id || "")) || null;

      return {
        ...row,
        users: resolvedUser,
        clock_in: row.clock_in || row.login_time || null,
        clock_out: row.clock_out || row.logout_time || null,
        login_time: row.login_time || row.clock_in || null,
        logout_time: row.logout_time || row.clock_out || null,
        overtime_hours: Math.max(0, Number(row.overtime_hours || 0)),
        missed_hours: Math.max(0, Number(row.missed_hours || 0)),
      };
    });

    return NextResponse.json({
      attendance: normalized,
      records: normalized,
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to fetch attendance";
    return NextResponse.json(
      { error: msg, attendance: [], records: [] },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/attendance
 * Allows Admin to manually add or set Overtime Hours for a specific Employee on a specific Date.
 * Input: { user_id: string, date: string, overtime_hours: number, mode?: 'set' | 'add' }
 */
export async function POST(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  const client = createAdminClientFromCloudflare(req, cfEnv);
  if (!client) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const userId = String(body.user_id || "").trim();
    const date = String(body.date || "").trim();
    const inputHours = Number(
      String(body.overtime_hours ?? body.hours ?? "0")
    );
    if (body.mode === "add") return NextResponse.json({ error: "Use mode set with the final overtime total; additive requests are not supported to prevent double credit." }, { status: 400 });

    if (!userId || !date) {
      return NextResponse.json(
        { error: "Please select an Employee and a Date." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(inputHours) || inputHours < 0 || inputHours > 24) {
      return NextResponse.json(
        {
          error:
            "Please enter valid Overtime Hours between 0 and 24 (e.g., 2 or 2.5).",
        },
        { status: 400 }
      );
    }

    const { data: existingRow, error: existingError } = await client
      .from("attendance")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();

    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    const currentOt = Math.max(0, Number(existingRow?.overtime_hours || 0));
    const finalOtHours = Math.max(
      0,
      Math.round(
        ((inputHours) +
          Number.EPSILON) *
          100
      ) / 100
    );
    if (finalOtHours > 24) return NextResponse.json({ error: "Total overtime must not exceed 24 hours." }, { status: 400 });
    const finalOtMinutes = Math.round(finalOtHours * 60);

    let savedRecord: Record<string, any> | null = null;

    if (existingRow) {
      const { data: updated, error: updateErr } = await client
        .from("attendance")
        .update({
          overtime_hours: finalOtHours,
          overtime_override_hours: finalOtHours,
          overtime_minutes: finalOtMinutes,
        })
        .eq("id", existingRow.id)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }
      savedRecord = updated;
    } else {
      const { data: inserted, error: insertErr } = await client
        .from("attendance")
        .upsert(
          {
            user_id: userId,
            date,
            status: "Present",
            overtime_hours: finalOtHours,
          overtime_override_hours: finalOtHours,
            overtime_minutes: finalOtMinutes,
            missed_hours: 0,
          },
          { onConflict: "user_id,date" }
        )
        .select()
        .single();

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
      savedRecord = inserted;
    }

    const { data: empRow } = await client
      .from("users")
      .select("full_name, employee_id")
      .eq("id", userId)
      .maybeSingle();

    const empLabel = empRow
      ? `${empRow.full_name} (${empRow.employee_id})`
      : "Employee";

    return NextResponse.json({
      message: `Manual Overtime of ${finalOtHours.toFixed(
        2
      )} hrs saved for ${empLabel} on ${date}.`,
      record: savedRecord,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to save manual overtime";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  return POST(req, context);
}
