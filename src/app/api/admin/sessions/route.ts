import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, RuntimeEnv } from "@/lib/supabaseAdmin";
import { getPktTimeInfo } from "@/lib/pktTime";

interface RouteContext {
  env?: RuntimeEnv;
}

export async function GET(req: NextRequest, context?: RouteContext) {
  const { client, isConfigured } = getSupabaseAdmin(req, context);
  if (!isConfigured || !client) {
    return NextResponse.json({
      session_requests: [],
      active_locked_users: [],
      sessions: [],
    });
  }

  try {
    // 1. Fetch active_sessions joined with public.users
    const { data: activeSess } = await client
      .from("active_sessions")
      .select(
        `
        id,
        user_id,
        session_token,
        device_info,
        device_fingerprint,
        is_active,
        approval_status,
        created_at,
        last_seen,
        users (
          id,
          employee_id,
          full_name,
          role,
          device_id
        )
      `
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    const allSessions = activeSess || [];

    // Build pending login/logout requests from `active_sessions`
    const pendingRequests = allSessions
      .filter(
        (s) =>
          s.approval_status === "pending_login" ||
          s.approval_status === "pending_logout"
      )
      .map((s) => ({
        id: s.id,
        user_id: s.user_id,
        request_type:
          s.approval_status === "pending_logout" ? "logout" : "login",
        device_id: s.device_fingerprint,
        device_info: s.device_info || "Browser Session",
        status: "pending",
        created_at: s.created_at,
        users: s.users,
      }));

    // Build active locked users list
    const approvedSessions = allSessions.filter(
      (s) =>
        s.approval_status === "approved" ||
        s.approval_status === "pending_logout"
    );

    const lockedUsersMap = new Map<
      string,
      {
        id: string;
        employee_id: string;
        full_name: string;
        role: string;
        device_id: string;
        created_at: string;
      }
    >();

    for (const s of approvedSessions) {
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      if (u && !lockedUsersMap.has(s.user_id)) {
        lockedUsersMap.set(s.user_id, {
          id: s.user_id,
          employee_id: u.employee_id,
          full_name: u.full_name,
          role: u.role,
          device_id: s.device_fingerprint,
          created_at: s.created_at,
        });
      }
    }

    return NextResponse.json({
      session_requests: pendingRequests,
      active_locked_users: Array.from(lockedUsersMap.values()),
      sessions: allSessions,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load session requests";
    return NextResponse.json(
      {
        error: message,
        session_requests: [],
        active_locked_users: [],
        sessions: [],
      },
      { status: 500 }
    );
  }
}

async function handleSessionDecision(req: NextRequest, context?: RouteContext) {
  const { client, isConfigured, hasServiceRole } = getSupabaseAdmin(
    req,
    context
  );
  if (!isConfigured || !client) {
    return NextResponse.json(
      { error: "Supabase credentials missing." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const requestId = body.request_id || body.session_id || "";
    const targetUserId = body.user_id || "";
    const rawAction = String(body.action || "").toLowerCase();
    const pktNow = getPktTimeInfo(new Date());

    // Look up the session row in `active_sessions` if requestId is given
    let sessionRecord: {
      id: string;
      user_id: string;
      device_fingerprint: string;
      approval_status: string;
    } | null = null;

    if (requestId) {
      const { data: foundSess } = await client
        .from("active_sessions")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();
      if (foundSess) {
        sessionRecord = foundSess;
      }
    }

    const uid = sessionRecord?.user_id || targetUserId;
    const deviceFp =
      sessionRecord?.device_fingerprint || body.device_id || "";

    // 1. APPROVE LOGIN -> Approve this device in `active_sessions`, clear any old device sessions, and set `users.device_id`
    if (rawAction === "approve_login") {
      if (!uid) {
        return NextResponse.json(
          { error: "Employee user_id not found for login approval." },
          { status: 404 }
        );
      }

      // Remove any older sessions for this employee on other devices
      if (sessionRecord) {
        await client
          .from("active_sessions")
          .delete()
          .eq("user_id", uid)
          .neq("id", sessionRecord.id);

        await client
          .from("active_sessions")
          .update({
            is_active: true,
            approval_status: "approved",
            last_seen: pktNow.isoPkt,
          })
          .eq("id", sessionRecord.id);
      } else {
        await client
          .from("active_sessions")
          .update({
            is_active: true,
            approval_status: "approved",
            last_seen: pktNow.isoPkt,
          })
          .eq("user_id", uid);
      }

      if (deviceFp) {
        await client
          .from("users")
          .update({ device_id: deviceFp })
          .eq("id", uid);
      }

      await client
        .from("session_requests")
        .update({ status: "approved" })
        .eq("user_id", uid)
        .eq("request_type", "login")
        .eq("status", "pending");

      return NextResponse.json({
        message:
          "Login request approved! Employee's device fingerprint is now locked in active_sessions.",
      });
    }

    // 2. REJECT LOGIN
    if (rawAction === "reject_login") {
      if (sessionRecord) {
        await client
          .from("active_sessions")
          .delete()
          .eq("id", sessionRecord.id);
      } else if (uid) {
        await client
          .from("active_sessions")
          .delete()
          .eq("user_id", uid)
          .eq("approval_status", "pending_login");
      }

      if (uid) {
        await client
          .from("session_requests")
          .update({ status: "rejected" })
          .eq("user_id", uid)
          .eq("request_type", "login")
          .eq("status", "pending");
      }

      return NextResponse.json({
        message: "Login request rejected and removed.",
      });
    }

    // 3. APPROVE LOGOUT -> Clear `active_sessions` record and `users.device_id` so employee can log in on a new device
    if (rawAction === "approve_logout" || rawAction === "force_logout" || rawAction === "revoke") {
      if (!uid) {
        return NextResponse.json(
          { error: "Employee user_id is required to clear active session." },
          { status: 400 }
        );
      }

      await client.from("active_sessions").delete().eq("user_id", uid);
      await client.from("users").update({ device_id: null }).eq("id", uid);
      await client
        .from("session_requests")
        .update({ status: "approved" })
        .eq("user_id", uid)
        .eq("status", "pending");

      if (hasServiceRole) {
        await client.auth.admin.signOut(uid, "global").catch(() => null);
      }

      return NextResponse.json({
        message:
          rawAction === "approve_logout"
            ? "Logout request approved! Active session cleared — employee can now log in on a new device."
            : "Force Logout completed! Active session cleared.",
      });
    }

    // 4. REJECT LOGOUT -> Keep employee's active session `approved`
    if (rawAction === "reject_logout") {
      if (uid) {
        await client
          .from("active_sessions")
          .update({
            is_active: true,
            approval_status: "approved",
            last_seen: pktNow.isoPkt,
          })
          .eq("user_id", uid);

        await client
          .from("session_requests")
          .update({ status: "rejected" })
          .eq("user_id", uid)
          .eq("request_type", "logout")
          .eq("status", "pending");
      }

      return NextResponse.json({
        message:
          "Logout request rejected. Employee remains logged in on their locked device.",
      });
    }

    return NextResponse.json(
      { error: `Unsupported session action: ${rawAction}` },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context?: RouteContext) {
  return handleSessionDecision(req, context);
}

export async function POST(req: NextRequest, context?: RouteContext) {
  return handleSessionDecision(req, context);
}
