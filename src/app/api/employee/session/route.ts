/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getPktTimeInfo } from "@/lib/pktTime";

function createAdminClientFromCloudflare(cfEnv: Record<string, any>) {

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

  return createClient(supabaseUrl, activeKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }

  const client = createAdminClientFromCloudflare(cfEnv);
  if (!client) {
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

  if (!sessionRow || !fp || sessionRow.device_fingerprint !== fp) return NextResponse.json({ valid: false, error: "Valid device-bound session token required." }, { status: 401 });
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
          error:
            "Active session detected on another device. A request has been sent to the Admin for approval. Please wait.",
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

  if (fp) {
    const { data: activeForFp } = await client
      .from("active_sessions")
      .select("*")
      .eq("user_id", userRow.id)
      .eq("device_fingerprint", fp)
      .eq("is_active", true)
      .maybeSingle();

    if (activeForFp) {
      const status = String(activeForFp.approval_status || "approved");
      return NextResponse.json({
        valid: true,
        active: status === "approved" || status === "pending_logout",
        approval_status: status,
        session_token: activeForFp.session_token,
        employee: userRow,
        today_attendance: todayAttendance,
        server_pkt: pktNow,
      });
    }

    const { data: latestReq } = await client
      .from("session_requests")
      .select("*")
      .eq("user_id", userRow.id)
      .eq("device_id", fp)
      .eq("request_type", "login")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestReq?.status === "pending") {
      return NextResponse.json({
        valid: true,
        active: false,
        approval_status: "pending_login",
        employee: userRow,
        today_attendance: todayAttendance,
        server_pkt: pktNow,
      });
    }

    if (latestReq?.status === "rejected") {
      return NextResponse.json(
        {
          valid: false,
          active: false,
          rejected_by_admin: true,
          approval_status: "rejected",
          error: "Your login request on this device was rejected by the Admin.",
        },
        { status: 403 }
      );
    }
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

export async function POST(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }

  const client = createAdminClientFromCloudflare(cfEnv);
  if (!client) {
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
    const deviceInfo = (body.device_info || "Web Browser").slice(0, 120);
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

    const { data: verifiedSession } = await client.from("active_sessions").select("user_id,device_fingerprint,approval_status").eq("session_token", sessionToken).eq("is_active", true).maybeSingle();
    if (!verifiedSession || !deviceFingerprint || verifiedSession.device_fingerprint !== deviceFingerprint || !["approved", "pending_logout"].includes(verifiedSession.approval_status)) return NextResponse.json({ error: "Approved device session required." }, { status: 401 });
    userId = verifiedSession.user_id;
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
