import { createRuntimeClients, runtimeConfigurationResponse, type RuntimeEnv } from "@/lib/supabaseRuntime";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { selectAll } from "@/lib/selectAll";
import { requireAdmin } from "@/lib/requireAdmin";
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";



const MANUAL_TAG = "[MANUAL]";

function parseLeaveRow(
  row: Record<string, any>,
  userMap: Map<string, Record<string, any>>
) {
  const embeddedUser = Array.isArray(row.users) ? row.users[0] : row.users;
  const resolvedUser =
    embeddedUser || userMap.get(String(row.user_id || "")) || null;

  const empName = resolvedUser?.full_name || "Employee";
  const empCode = resolvedUser?.employee_id || "EMP --";

  const rawReason = String(row.reason || "").trim();
  const isManualSource =
    row.source === "manual" || rawReason.startsWith(MANUAL_TAG);
  const cleanReason = rawReason.replace(/^\[MANUAL\]\s*/i, "").trim();

  // Extract optional custom category prefix like "[Sick Leave] Feeling unwell"
  let categoryLabel =
    row.leave_type === "paid"
      ? "Paid Leave"
      : row.leave_type === "unpaid"
      ? "Unpaid Leave"
      : "Short Leave";
  let displayReason = cleanReason;

  const catMatch = cleanReason.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (catMatch) {
    categoryLabel = catMatch[1];
    displayReason = catMatch[2].trim();
  }

  const isPaid = row.leave_type === "paid";

  return {
    ...row,
    users: resolvedUser
      ? {
          id: resolvedUser.id,
          employee_id: empCode,
          full_name: empName,
          monthly_salary: Number(
            resolvedUser.monthly_salary || resolvedUser.basic_salary || 0
          ),
          per_day_deduction: Number(resolvedUser.per_day_deduction || 0),
          hourly_rate: Number(resolvedUser.hourly_rate || 0),
          duty_start_time: resolvedUser.duty_start_time || "09:00:00",
          duty_end_time: resolvedUser.duty_end_time || "17:00:00",
        }
      : {
          id: row.user_id,
          employee_id: empCode,
          full_name: empName,
          monthly_salary: 0,
          per_day_deduction: 0,
          hourly_rate: 0,
          duty_start_time: "09:00:00",
          duty_end_time: "17:00:00",
        },
    employee_name: empName,
    employee_code: empCode,
    leave_category: categoryLabel,
    reason: displayReason,
    is_paid: isPaid,
    source: isManualSource ? "manual" : "employee",
    request_summary: `Employee ${empName} (${empCode}) requested ${categoryLabel} for ${row.date}`,
  };
}

export async function GET(req: NextRequest, _context: any) {
  let cfEnv: RuntimeEnv;
  let requestClients: ReturnType<typeof createRuntimeClients>;
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as RuntimeEnv;
    requestClients = createRuntimeClients(cfEnv, false);
  } catch (error) { return runtimeConfigurationResponse(error); }

  const denied = await requireAdmin(req, requestClients.client);
  if (denied) return denied;

  const client = requestClients.client;
  if (!client) {
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
          basic_salary,
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
        .lt("date", new Date(Date.UTC(Number(monthFilter.slice(0, 4)), Number(monthFilter.slice(5, 7)), 1)).toISOString().slice(0, 10));
    }

    const [{ data: rawLeaves, error }, { data: allUsers }] = await Promise.all([
      selectAll(query.order("id", { ascending: true })),
      client
        .from("users")
        .select(
          "id, employee_id, full_name, monthly_salary, basic_salary, per_day_deduction, hourly_rate, duty_start_time, duty_end_time"
        ),
    ]);

    if (error) {
      return NextResponse.json(
        { error: error.message, leaves: [] },
        { status: 500 }
      );
    }

    const userMap = new Map<string, Record<string, any>>();
    (allUsers || []).forEach((u: Record<string, any>) => {
      if (u && u.id) userMap.set(String(u.id), u);
    });

    const enrichedLeaves = (rawLeaves || []).map((row: Record<string, any>) =>
      parseLeaveRow(row, userMap)
    );

    return NextResponse.json({ leaves: enrichedLeaves });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load leaves";
    return NextResponse.json({ error: msg, leaves: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest, _context: any) {
  let cfEnv: RuntimeEnv;
  let requestClients: ReturnType<typeof createRuntimeClients>;
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as RuntimeEnv;
    requestClients = createRuntimeClients(cfEnv, false);
  } catch (error) { return runtimeConfigurationResponse(error); }

  const denied = await requireAdmin(req, requestClients.client);
  if (denied) return denied;

  const client = requestClients.client;
  if (!client) {
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
      source = "manual",
    } = body;

    if (!user_id || !date || !leave_type) {
      return NextResponse.json(
        { error: "Employee, Date, and Leave Type are required." },
        { status: 400 }
      );
    }

    const normalizedType = ["paid", "unpaid", "short"].includes(
      String(leave_type).toLowerCase()
    )
      ? String(leave_type).toLowerCase()
      : "paid";

    const parsedHours =
      normalizedType === "short"
        ? Math.max(0.5, parseFloat(String(hours_missed || "2")) || 2)
        : 0;

    const cleanInputReason = String(reason || "")
      .trim()
      .replace(/^\[MANUAL\]\s*/i, "");
    const storedReason =
      source === "manual"
        ? `${MANUAL_TAG}${cleanInputReason ? ` ${cleanInputReason}` : ""}`
        : cleanInputReason;

    const { data, error } = await client
      .from("leaves")
      .upsert(
        {
          user_id,
          date,
          leave_type: normalizedType,
          hours_missed: parsedHours,
          reason: storedReason,
          status,
        },
        { onConflict: "user_id,date" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        {
          error: `Database error (${error.message}). Make sure you ran supabase/schema.sql in Supabase SQL Editor.`,
        },
        { status: 500 }
      );
    }

    const { data: empRow } = await client
      .from("users")
      .select(
        "id, employee_id, full_name, monthly_salary, basic_salary, per_day_deduction, hourly_rate, duty_start_time, duty_end_time"
      )
      .eq("id", user_id)
      .maybeSingle();

    const userMap = new Map<string, Record<string, any>>();
    if (empRow) userMap.set(String(empRow.id), empRow);

    return NextResponse.json({
      message: `Manual ${normalizedType.toUpperCase()} leave recorded for ${
        empRow?.full_name || "Employee"
      }.`,
      leave: parseLeaveRow(data, userMap),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create leave record";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, _context: any) {
  let cfEnv: RuntimeEnv;
  let requestClients: ReturnType<typeof createRuntimeClients>;
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as RuntimeEnv;
    requestClients = createRuntimeClients(cfEnv, false);
  } catch (error) { return runtimeConfigurationResponse(error); }

  const denied = await requireAdmin(req, requestClients.client);
  if (denied) return denied;

  const client = requestClients.client;
  if (!client) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { id, status, leave_type, is_paid, hours_missed } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Leave ID is required." },
        { status: 400 }
      );
    }

    if (hours_missed !== undefined && (!Number.isFinite(Number(hours_missed)) || Number(hours_missed) < 0 || Number(hours_missed) > 24)) return NextResponse.json({ error: "Missed hours must be between 0 and 24." }, { status: 400 });
    const updatePayload: Record<string, unknown> = {};
    if (status && !["pending", "approved", "rejected", "cancelled"].includes(status)) return NextResponse.json({ error: "Invalid leave status." }, { status: 400 });
    if (status) updatePayload.status = status;

    if (leave_type && ["paid", "unpaid", "short"].includes(leave_type)) {
      updatePayload.leave_type = leave_type;
    } else if (typeof is_paid === "boolean") {
      updatePayload.leave_type = is_paid ? "paid" : "unpaid";
    }

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
      message: "Leave decision saved.",
      leave: data,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update leave";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, _context: any) {
  let cfEnv: RuntimeEnv;
  let requestClients: ReturnType<typeof createRuntimeClients>;
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as RuntimeEnv;
    requestClients = createRuntimeClients(cfEnv, false);
  } catch (error) { return runtimeConfigurationResponse(error); }

  const denied = await requireAdmin(req, requestClients.client);
  if (denied) return denied;

  const client = requestClients.client;
  if (!client) {
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

  const { error } = await client.from("leaves").update({ status: "cancelled" }).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Leave cancelled; record retained." });
}
