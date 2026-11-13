/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest, context: any) {
  const { client, isConfigured } = getSupabaseAdmin(req, context);
  if (!isConfigured || !client) {
    return NextResponse.json({ leaves: [] });
  }

  try {
    const { searchParams } = new URL(req.url);
    const monthFilter = searchParams.get("month");

    let query = client
      .from("leaves")
      .select(
        `
        *,
        users (
          id,
          employee_id,
          full_name,
          monthly_salary,
          per_day_deduction,
          hourly_rate,
          duty_start_time,
          duty_end_time
        )
      `
      )
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (monthFilter && /^\d{4}-\d{2}$/.test(monthFilter)) {
      query = query
        .gte("date", `${monthFilter}-01`)
        .lte("date", `${monthFilter}-31`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message, leaves: [] },
        { status: 500 }
      );
    }

    return NextResponse.json({ leaves: data || [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load leaves";
    return NextResponse.json({ error: msg, leaves: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: any) {
  const { client, isConfigured } = getSupabaseAdmin(req, context);
  if (!isConfigured || !client) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const {
      user_id,
      date,
      leave_type = "paid",
      hours_missed = 0,
      reason = "",
      status = "approved",
    } = body;

    if (!user_id || !date || !leave_type) {
      return NextResponse.json(
        { error: "Employee, Date, and Leave Type are required." },
        { status: 400 }
      );
    }

    const parsedHours =
      leave_type === "short"
        ? Math.max(0, parseFloat(String(hours_missed || "0")) || 0)
        : 0;

    const { data, error } = await client
      .from("leaves")
      .upsert(
        {
          user_id,
          date,
          leave_type,
          hours_missed: parsedHours,
          reason: (reason || "").trim(),
          status,
        },
        { onConflict: "user_id,date" }
      )
      .select(
        `
        *,
        users (
          id,
          employee_id,
          full_name
        )
      `
      )
      .single();

    if (error) {
      return NextResponse.json(
        {
          error: `Database error (${error.message}). Make sure you ran supabase/schema.sql in Supabase SQL Editor.`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `${leave_type.toUpperCase()} leave recorded successfully.`,
      leave: data,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create leave record";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: any) {
  const { client, isConfigured } = getSupabaseAdmin(req, context);
  if (!isConfigured || !client) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { id, status, leave_type, hours_missed } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Leave ID is required." },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, unknown> = {};
    if (status) updatePayload.status = status;
    if (leave_type) updatePayload.leave_type = leave_type;
    if (hours_missed !== undefined) {
      updatePayload.hours_missed = parseFloat(String(hours_missed)) || 0;
    }

    const { data, error } = await client
      .from("leaves")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Leave record updated.",
      leave: data,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update leave";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: any) {
  const { client, isConfigured } = getSupabaseAdmin(req, context);
  if (!isConfigured || !client) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Leave ID is required." },
      { status: 400 }
    );
  }

  const { error } = await client.from("leaves").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Leave record deleted." });
}
