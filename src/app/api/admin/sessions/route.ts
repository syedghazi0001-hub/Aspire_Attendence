import { createClient } from "@supabase/supabase-js";
import { readSupabaseConfig, runtimeConfigurationResponse, type RequestSupabaseClients } from "@/lib/supabaseRuntime";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireAdmin } from "@/lib/requireAdmin";
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getPktTimeInfo } from "@/lib/pktTime";



function cleanDeviceLabel(raw?: string | null): string {
  const val = (raw || "").trim();
  if (!val) return "Web Browser";
  return (
    val
      .replace(/\s*\[ID:[^\]]+\]/gi, "")
      .replace(/\s*\(\d+x\d+\)/g, "")
      .trim() || "Web Browser"
  );
}

export async function GET(req: NextRequest, _context: any) {
  let requestClients: RequestSupabaseClients;
  try {
    const { env } = getCloudflareContext();
    const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "").trim();
    const supabaseAnonKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? env.ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY ?? "").trim();
    readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey }, { requireAnon: false });
    const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
    const client = createClient(supabaseUrl, serviceRoleKey, options);
    const anonClient = client; // This operation uses service privileges; no password sign-in here.
    requestClients = { client, anonClient };
  } catch (error) { return runtimeConfigurationResponse(error); }

  const denied = await requireAdmin(req, requestClients.client);
  if (denied) return denied;

  const { client } = requestClients;
  if (!client) {
    return NextResponse.json({
      session_requests: [],
      active_locked_users: [],
      sessions: [],
    });
  }

  try {
    const { data: pendingReqs } = await client
      .from("session_requests")
      .select(
        `
        id,
        user_id,
        request_type,
        device_id,
        device_info,
        status,
        created_at,
        users (
          id,
          employee_id,
          full_name,
          role,
          device_id
        )
      `
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });

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
    const formattedRequests: any[] = (pendingReqs || []).map((r: any) => ({
      ...r,
      device_info: cleanDeviceLabel(r.device_info),
    }));

    const existingReqKeys = new Set(
      formattedRequests.map((r) => `${r.user_id}:${r.request_type}`)
    );

    for (const s of allSessions) {
      if (
        s.approval_status === "pending_login" ||
        s.approval_status === "pending_logout"
      ) {
        const rType =
          s.approval_status === "pending_logout" ? "logout" : "login";
        const key = `${s.user_id}:${rType}`;
        if (!existingReqKeys.has(key)) {
          existingReqKeys.add(key);
          formattedRequests.push({
            id: s.id,
            user_id: s.user_id,
            request_type: rType,
            device_id: s.device_fingerprint,
            device_info: cleanDeviceLabel(s.device_info),
            status: "pending",
            created_at: s.created_at,
            users: s.users,
          });
        }
      }
    }

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
        device_info: string;
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
          device_info: cleanDeviceLabel(s.device_info),
          created_at: s.created_at,
        });
      }
    }

    return NextResponse.json({
      session_requests: formattedRequests,
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

async function handleSessionDecision(req: NextRequest, requestClients: RequestSupabaseClients) {
  const { client } = requestClients;
  const hasServiceRole = true;
  if (!client) {
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

    let reqRecord: {
      id: string;
      user_id: string;
      request_type: string;
      device_id: string;
      device_info: string;
      status: string;
    } | null = null;

    if (requestId) {
      const { data: foundReq } = await client
        .from("session_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();
      if (foundReq) {
        reqRecord = foundReq;
      }
    }

    let sessionRecord: {
      id: string;
      user_id: string;
      device_fingerprint: string;
      device_info: string;
      approval_status: string;
    } | null = null;

    if (!reqRecord && requestId) {
      const { data: foundSess } = await client
        .from("active_sessions")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();
      if (foundSess) {
        sessionRecord = foundSess;
      }
    }

    const uid =
      reqRecord?.user_id || sessionRecord?.user_id || targetUserId;
    const newDeviceFp =
      reqRecord?.device_id ||
      sessionRecord?.device_fingerprint ||
      body.device_id ||
      "";
    const newDeviceInfo = cleanDeviceLabel(
      reqRecord?.device_info || sessionRecord?.device_info || "Web Browser"
    );

    if (rawAction === "approve_login") {
      if (!uid) {
        return NextResponse.json(
          { error: "Employee user_id not found for login approval." },
          { status: 404 }
        );
      }

      if (newDeviceFp) {
        await client
          .from("active_sessions")
          .delete()
          .eq("user_id", uid)
          .neq("device_fingerprint", newDeviceFp);

        const { data: updatedNewSess } = await client
          .from("active_sessions")
          .update({
            is_active: true,
            approval_status: "approved",
            device_info: newDeviceInfo,
            last_seen: pktNow.isoPkt,
          })
          .eq("user_id", uid)
          .eq("device_fingerprint", newDeviceFp)
          .select();

        if (!updatedNewSess || updatedNewSess.length === 0) {
          await client.from("active_sessions").insert({
            user_id: uid,
            device_fingerprint: newDeviceFp,
            device_info: newDeviceInfo,
            is_active: true,
            approval_status: "approved",
            created_at: pktNow.isoPkt,
            last_seen: pktNow.isoPkt,
          });
        }

        await client
          .from("users")
          .update({ device_id: newDeviceFp })
          .eq("id", uid);
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

      if (reqRecord) {
        await client
          .from("session_requests")
          .update({ status: "approved" })
          .eq("id", reqRecord.id);
      } else {
        await client
          .from("session_requests")
          .update({ status: "approved" })
          .eq("user_id", uid)
          .eq("request_type", "login")
          .eq("status", "pending");
      }

      return NextResponse.json({
        message:
          "New login approved! Previous device session was logged out and the new device is now active.",
      });
    }

    if (rawAction === "reject_login") {
      if (reqRecord) {
        await client
          .from("session_requests")
          .update({ status: "rejected" })
          .eq("id", reqRecord.id);
      } else if (uid) {
        await client
          .from("session_requests")
          .update({ status: "rejected" })
          .eq("user_id", uid)
          .eq("request_type", "login")
          .eq("status", "pending");
      }

      if (uid && newDeviceFp) {
        await client
          .from("active_sessions")
          .delete()
          .eq("user_id", uid)
          .eq("device_fingerprint", newDeviceFp)
          .eq("approval_status", "pending_login");
      } else if (sessionRecord) {
        await client
          .from("active_sessions")
          .delete()
          .eq("id", sessionRecord.id);
      }

      return NextResponse.json({
        message: "New login request rejected. The new device remains blocked.",
      });
    }

    if (
      rawAction === "approve_logout" ||
      rawAction === "force_logout" ||
      rawAction === "revoke"
    ) {
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
            ? "Logout request approved! Active session has been cleared."
            : "Session ended successfully.",
      });
    }

    if (rawAction === "reject_logout") {
      if (reqRecord) {
        await client
          .from("session_requests")
          .update({ status: "rejected" })
          .eq("id", reqRecord.id);
      } else if (uid) {
        await client
          .from("session_requests")
          .update({ status: "rejected" })
          .eq("user_id", uid)
          .eq("request_type", "logout")
          .eq("status", "pending");
      }

      if (uid) {
        await client
          .from("active_sessions")
          .update({
            is_active: true,
            approval_status: "approved",
            last_seen: pktNow.isoPkt,
          })
          .eq("user_id", uid);
      }

      return NextResponse.json({
        message: "Logout request rejected. Employee remains logged in.",
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

export async function PUT(req: NextRequest, _context: any) {
  let requestClients: RequestSupabaseClients;
  try {
    const { env } = getCloudflareContext();
    const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "").trim();
    const supabaseAnonKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? env.ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY ?? "").trim();
    readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey }, { requireAnon: false });
    const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
    const client = createClient(supabaseUrl, serviceRoleKey, options);
    const anonClient = client; // This operation uses service privileges; no password sign-in here.
    requestClients = { client, anonClient };
  } catch (error) { return runtimeConfigurationResponse(error); }

  const denied = await requireAdmin(req, requestClients.client);
  if (denied) return denied;

  return handleSessionDecision(req, requestClients);
}

export async function POST(req: NextRequest, _context: any) {
  let requestClients: RequestSupabaseClients;
  try {
    const { env } = getCloudflareContext();
    const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "").trim();
    const supabaseAnonKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? env.ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY ?? "").trim();
    readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey }, { requireAnon: false });
    const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
    const client = createClient(supabaseUrl, serviceRoleKey, options);
    const anonClient = client; // This operation uses service privileges; no password sign-in here.
    requestClients = { client, anonClient };
  } catch (error) { return runtimeConfigurationResponse(error); }

  const denied = await requireAdmin(req, requestClients.client);
  if (denied) return denied;

  return handleSessionDecision(req, requestClients);
}
