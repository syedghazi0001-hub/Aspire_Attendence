/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getPktTimeInfo } from "@/lib/pktTime";

export async function GET(req: NextRequest, context: any) {
  const { client, isConfigured } = getSupabaseAdmin(req, context);
  if (!isConfigured || !client) {
    return NextResponse.json(
      {
        valid: false,
        active: false,
        approval_status: "logged_out",
        reason: "SUPABASE_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token") || "";
  const fp = (searchParams.get("fp") || "").trim();
  const queryUserId = searchParams.get("user_id") || "";

  let userId = queryUserId;
  let sessionRow: Record<string, unknown> | null = null;

  if (token) {
    const { data: sRow } = await client
      .from("active_sessions")
      .select("*")
      .eq("session_token", token)
      .maybeSingle();
    if (sRow) {
      sessionRow = sRow;
      userId = String(sRow.user_id || userId);
    }
  }

  if (!userId) {
    return NextResponse.json(
      {
        valid: false,
        active: false,
        approval_status: "logged_out",
        reason: "MISSING_SESSION",
      },
      { status: 401 }
    );
  }

  const { data: userRow } = await client
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (!userRow) {
    return NextResponse.json(
      {
        valid: false,
        active: false,
        approval_status: "logged_out",
        reason: "USER_DELETED",
      },
      { status: 401 }
    );
  }

  const pktNow = getPktTimeInfo(new Date());

  const { data: rawTodayAttendance } = await client
    .from("attendance")
    .select("*")
    .eq("user_id", userRow.id)
    .eq("date", pktNow.dateStr)
    .maybeSingle();

  const todayAttendance = rawTodayAttendance
    ? {
        ...rawTodayAttendance,
        clock_in:
          rawTodayAttendance.clock_in || rawTodayAttendance.login_time || null,
        clock_out:
          rawTodayAttendance.clock_out ||
          rawTodayAttendance.logout_time ||
          null,
        login_time:
          rawTodayAttendance.login_time || rawTodayAttendance.clock_in || null,
        logout_time:
          rawTodayAttendance.logout_time ||
          rawTodayAttendance.clock_out ||
          null,
      }
    : null;

  if (sessionRow) {
    if (!sessionRow.is_active || sessionRow.approval_status === "rejected") {
      return NextResponse.json(
        {
          valid: false,
          active: false,
          approval_status: "logged_out",
          reason: "SESSION_REVOKED",
        },
        { status: 401 }
      );
    }

    if (
      sessionRow.device_fingerprint &&
      fp &&
      sessionRow.device_fingerprint !== fp
    ) {
      return NextResponse.json(
        {
          valid: false,
          active: false,
          blocked_other_device: true,
          approval_status: "blocked_other_device",
          error: "Already logged in on another device. Please contact Admin.",
        },
        { status: 403 }
      );
    }

    const status = String(sessionRow.approval_status || "pending_login");
    return NextResponse.json({
      valid: true,
      active: status === "approved" || status === "pending_logout",
      approval_status: status,
      employee: userRow,
      today_attendance: todayAttendance,
      server_pkt: pktNow,
    });
  }

  if (userRow.device_id && fp && userRow.device_id !== fp) {
    return NextResponse.json(
      {
        valid: false,
        active: false,
        blocked_other_device: true,
        approval_status: "blocked_other_device",
        error: "Already logged in on another device. Please contact Admin.",
      },
      { status: 403 }
    );
  }

  if (userRow.device_id && (!fp || userRow.device_id === fp)) {
    return NextResponse.json({
      valid: true,
      active: true,
      approval_status: "approved",
      employee: userRow,
      today_attendance: todayAttendance,
      server_pkt: pktNow,
    });
  }

  return NextResponse.json(
    {
      valid: false,
      active: false,
      approval_status: "logged_out",
      reason: "LOGGED_OUT_BY_ADMIN",
    },
    { status: 401 }
  );
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
    const sessionToken = body.session_token || "";
    const deviceFingerprint = (
      body.device_fingerprint ||
      body.device_id ||
      ""
    ).trim();
    const deviceInfo = (body.device_info || "Browser Session").slice(0, 180);
    let userId = body.user_id || "";

    if (sessionToken) {
      const { data: sRow } = await client
        .from("active_sessions")
        .select("*")
        .eq("session_token", sessionToken)
        .maybeSingle();
      if (sRow) {
        userId = String(sRow.user_id || userId);
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: "Active employee session not found." },
        { status: 404 }
      );
    }

    const pktNow = getPktTimeInfo(new Date());

    if (sessionToken) {
      await client
        .from("active_sessions")
        .update({
          approval_status: "pending_logout",
          last_seen: pktNow.isoPkt,
        })
        .eq("session_token", sessionToken);
    } else {
      await client
        .from("active_sessions")
        .update({
          approval_status: "pending_logout",
          last_seen: pktNow.isoPkt,
        })
        .eq("user_id", userId)
        .eq("is_active", true);
    }

    const { data: existingLogoutReq } = await client
      .from("session_requests")
      .select("id")
      .eq("user_id", userId)
      .eq("request_type", "logout")
      .eq("status", "pending")
      .maybeSingle();

    if (!existingLogoutReq) {
      await client.from("session_requests").insert({
        user_id: userId,
        request_type: "logout",
        device_id: deviceFingerprint || "LOCKED_DEVICE",
        device_info: deviceInfo,
        status: "pending",
        created_at: pktNow.isoPkt,
      });
    }

    return NextResponse.json({
      message:
        "Logout request sent to Admin! You remain logged in until the Admin approves your request.",
      approval_status: "pending_logout",
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to request logout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
