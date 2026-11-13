import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, RuntimeEnv } from "@/lib/supabaseAdmin";

// Custom interface ka naam badal diya hai taake Next.js ke type se clash na ho
interface EnvContext {
  env?: RuntimeEnv;
}

// Yahan 'context: any' kar diya hai taake woh 'undefined' wala error khatam ho jaye
export async function GET(req: NextRequest, context: any) {
  const { client, isConfigured } = getSupabaseAdmin(req, context);
  if (!isConfigured || !client) {
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
        .lte("date", `${monthFilter}-31`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message, attendance: [], records: [] },
        { status: 500 }
      );
    }

    const normalized = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      clock_in: row.clock_in || row.login_time || null,
      clock_out: row.clock_out || row.logout_time || null,
      login_time: row.login_time || row.clock_in || null,
      logout_time: row.logout_time || row.clock_out || null,
      overtime_hours: Number(row.overtime_hours || 0),
      missed_hours: Number(row.missed_hours || 0),
    }));

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