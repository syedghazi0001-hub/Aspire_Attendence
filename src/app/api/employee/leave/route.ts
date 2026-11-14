import { createRuntimeClients, runtimeConfigurationResponse, type RuntimeEnv } from "@/lib/supabaseRuntime";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";



async function ownsApprovedSession(client: any, userId: string, token: string, fingerprint: string) {
  if (!userId || !token || !fingerprint) return false;
  const { data, error } = await client.from("active_sessions").select("user_id, device_fingerprint, approval_status").eq("session_token", token).eq("is_active", true).maybeSingle();
  return !error && data?.user_id === userId && data.device_fingerprint === fingerprint && ["approved", "pending_logout"].includes(data.approval_status);
}

export async function GET(req: NextRequest, _context: any) {
  let cfEnv: RuntimeEnv;
  let requestClients: ReturnType<typeof createRuntimeClients>;
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as RuntimeEnv;
    requestClients = createRuntimeClients(cfEnv, false);
  } catch (error) { return runtimeConfigurationResponse(error); }


  const client = requestClients.client;
  if (!client) {
    return NextResponse.json({ leaves: [] });
  }

  try {
    const { searchParams } = new URL(req.url);
    const userId = (searchParams.get("user_id") || "").trim();
    if (!await ownsApprovedSession(client, userId, searchParams.get("session_token") || "", searchParams.get("fp") || "")) return NextResponse.json({ error: "Approved device session required." }, { status: 401 });
    if (!userId) {
      return NextResponse.json({ leaves: [] });
    }

    const { data, error } = await client
      .from("leaves")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(500);

    if (error) {
      return NextResponse.json(
        { error: error.message, leaves: [] },
        { status: 500 }
      );
    }

    // A long future history must not hide today's full-day attendance block.
    const today = new Date(Date.now() + 18000000).toISOString().slice(0,10);
    const { data: todayLeave, error: todayError } = await client.from("leaves").select("*").eq("user_id", userId).eq("date", today).maybeSingle();
    if (todayError) return NextResponse.json({ error: todayError.message }, { status: 503 });
    const records = todayLeave && !data?.some(row => row.id === todayLeave.id) ? [todayLeave, ...(data || [])] : (data || []);
    const formatted = records.map((row: Record<string, any>) => {
      const rawReason = String(row.reason || "")
        .replace(/^\[MANUAL\]\s*/i, "")
        .trim();
      const catMatch = rawReason.match(/^\[([^\]]+)\]\s*(.*)$/);
      const leaveCategory = catMatch
        ? catMatch[1]
        : row.leave_type === "paid"
        ? "Paid Leave"
        : row.leave_type === "unpaid"
        ? "Unpaid Leave"
        : "Short Leave";
      const displayReason = catMatch ? catMatch[2].trim() : rawReason;

      return {
        ...row,
        leave_category: leaveCategory,
        reason: displayReason,
        is_paid: row.leave_type === "paid",
      };
    });

    return NextResponse.json({ leaves: formatted });
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


  const client = requestClients.client;
  if (!client) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const userId = String(body.user_id || "").trim();
    if (!await ownsApprovedSession(client, userId, String(body.session_token || ""), String(body.device_fingerprint || ""))) return NextResponse.json({ error: "Approved device session required." }, { status: 401 });
    const rawLeaveType = String(body.leave_type || "paid")
      .toLowerCase()
      .trim();
    const leaveCategory = String(body.leave_category || "").trim();
    const date = String(body.date || "").trim();
    // Reason is strictly OPTIONAL per user specification
    const optionalReason = String(body.reason || "").trim();

    if (!userId || !date) {
      return NextResponse.json(
        { error: "Please select a Leave Type and Date." },
        { status: 400 }
      );
    }

    // Map custom categories (Sick, Casual, Annual, Emergency) safely to Postgres ('paid' | 'unpaid' | 'short')
    let dbLeaveType: "paid" | "unpaid" | "short" = "paid";
    if (rawLeaveType === "unpaid") {
      dbLeaveType = "unpaid";
    } else if (rawLeaveType === "short") {
      dbLeaveType = "short";
    } else {
      dbLeaveType = "paid";
    }

    if (rawLeaveType === "short" && (!Number.isFinite(Number(body.hours_missed)) || Number(body.hours_missed) <= 0 || Number(body.hours_missed) > 24)) return NextResponse.json({ error: "Short-leave hours must be greater than zero and at most 24." }, { status: 400 });
    const hoursMissed =
      dbLeaveType === "short"
        ? Number(body.hours_missed)
        : 0;

    const categoryPrefix = leaveCategory ? `[${leaveCategory}]` : "";
    const combinedReason = [categoryPrefix, optionalReason]
      .filter(Boolean)
      .join(" ")
      .trim();

    const { data: prior, error: priorError } = await client.from("leaves").select("id,status").eq("user_id", userId).eq("date", date).maybeSingle();
    if (priorError) return NextResponse.json({ error: priorError.message }, { status: 500 });
    if (prior) return NextResponse.json({ error: "A leave record already exists for this date. Ask Admin to review or amend it; approved leave can be cancelled from history." }, { status: 409 });
    const { data, error } = await client
      .from("leaves")
      .insert(
        {
          user_id: userId,
          date,
          leave_type: dbLeaveType,
          hours_missed: hoursMissed,
          reason: combinedReason,
          status: "pending",
        }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Leave application submitted to Admin for review.",
      leave: data,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to submit leave application";
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

  const client = requestClients.client;
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  try {
    const body = await req.json();
    if (!await ownsApprovedSession(client, String(body.user_id || ""), String(body.session_token || ""), String(body.device_fingerprint || ""))) return NextResponse.json({ error: "Approved device session required." }, { status: 401 });
    if (!body.id) return NextResponse.json({ error: "Leave ID required." }, { status: 400 });
    const { data, error } = await client.rpc("cancel_employee_leave", { p_user_id: body.user_id, p_leave_id: body.id, p_token: body.session_token, p_fingerprint: body.device_fingerprint });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Only today's or future approved leave can be cancelled by an employee. Ask Admin for historical corrections." }, { status: 409 });
    return NextResponse.json({ leave: data, message: "Leave cancelled. Attendance is now available." });
  } catch { return NextResponse.json({ error: "Unable to cancel leave." }, { status: 500 }); }
}
