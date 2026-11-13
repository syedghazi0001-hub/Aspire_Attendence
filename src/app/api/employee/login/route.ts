/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { employeeIdToAuthEmail, normalizeEmployeeIdFormat } from "@/lib/geo";
import { getPktTimeInfo } from "@/lib/pktTime";

function createClientsFromCloudflare(cfEnv: Record<string, any>) {

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
  if (!supabaseUrl || !activeKey) {
    return { client: null, anonClient: null };
  }

  const client = createClient(supabaseUrl, activeKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const anonClient = createClient(supabaseUrl, anonKey || activeKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { client, anonClient };
}

function generateSessionToken(): string {
  const bytes = new Uint8Array(24);
  if (
    typeof globalThis.crypto !== "undefined" &&
    globalThis.crypto.getRandomValues
  ) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function formatCleanDeviceInfo(rawInfo: string, userAgent: string): string {
  const trimmed = (rawInfo || "").trim();
  if (
    trimmed &&
    !trimmed.includes("[ID:") &&
    !trimmed.includes("FP-") &&
    trimmed.length <= 60
  ) {
    return trimmed;
  }

  const ua = userAgent || trimmed;
  const browser = /Edg/i.test(ua)
    ? "Edge"
    : /OPR|Opera/i.test(ua)
    ? "Opera"
    : /Chrome|CriOS/i.test(ua)
    ? "Chrome"
    : /Firefox|FxiOS/i.test(ua)
    ? "Firefox"
    : /Safari/i.test(ua)
    ? "Safari"
    : "Browser";

  const os = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
    ? "iPad"
    : /Android/i.test(ua)
    ? "Android"
    : /Windows/i.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/i.test(ua)
    ? "macOS"
    : /Linux/i.test(ua)
    ? "Linux"
    : "Device";

  return `${browser} on ${os}`;
}

export async function POST(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }

  try {
    const { client, anonClient } = createClientsFromCloudflare(cfEnv);
    if (!client || !anonClient) {
      return NextResponse.json(
        {
          error:
            "Supabase is not configured. Please check NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 503 }
      );
    }

    const body = await req.json();
    const rawIdentifier = (body.identifier || body.employee_id || "").trim();
    const password = (body.password || "").trim();
    const deviceFingerprint = (
      body.device_fingerprint ||
      body.device_id ||
      ""
    ).trim();
    const cleanDeviceInfo = formatCleanDeviceInfo(
      body.device_info || "",
      req.headers.get("user-agent") || ""
    );

    if (!rawIdentifier || !password) {
      return NextResponse.json(
        { error: "Please enter your ID / Email and Password." },
        { status: 400 }
      );
    }

    const isEmailInput = rawIdentifier.includes("@");
    const canonicalEmpId = normalizeEmployeeIdFormat(rawIdentifier);
    const rawUpperEmpId = rawIdentifier.toUpperCase();

    const candidateEmails: string[] = [];
    if (isEmailInput) {
      candidateEmails.push(rawIdentifier.toLowerCase());
    } else {
      candidateEmails.push(employeeIdToAuthEmail(canonicalEmpId));
      const rawEmail = employeeIdToAuthEmail(rawUpperEmpId);
      if (!candidateEmails.includes(rawEmail)) {
        candidateEmails.push(rawEmail);
      }
    }

    let authUser: any = null;
    for (const emailCandidate of candidateEmails) {
      const { data: authData, error: authErr } =
        await anonClient.auth.signInWithPassword({
          email: emailCandidate,
          password,
        });
      if (!authErr && authData?.user) {
        authUser = authData.user;
        break;
      }
    }

    if (!authUser) {
      return NextResponse.json(
        {
          error: "Invalid credentials. Please check your ID/Email and Password.",
        },
        { status: 401 }
      );
    }

    let { data: userRecord } = await client
      .from("users")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();

    if (!userRecord && !isEmailInput) {
      const { data: byEmpId } = await client
        .from("users")
        .select("*")
        .or(
          `employee_id.ilike.${canonicalEmpId},employee_id.ilike.${rawUpperEmpId}`
        )
        .limit(1)
        .maybeSingle();
      userRecord = byEmpId;
    }

    if (!userRecord || userRecord.role === "admin") {
      return NextResponse.json({
        role: "admin",
        message: "Admin login successful.",
      });
    }

    if (!deviceFingerprint) {
      return NextResponse.json(
        { error: "Could not verify device identity." },
        { status: 400 }
      );
    }

    const pktNow = getPktTimeInfo(new Date());

    const { data: userSessions } = await client
      .from("active_sessions")
      .select("*")
      .eq("user_id", userRecord.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    const activeSessionsList = userSessions || [];

    const existingApprovedSameDevice = activeSessionsList.find(
      (s) =>
        s.device_fingerprint === deviceFingerprint &&
        (s.approval_status === "approved" ||
          s.approval_status === "pending_logout")
    );

    if (existingApprovedSameDevice) {
      await client
        .from("active_sessions")
        .update({
          last_seen: pktNow.isoPkt,
          device_info: cleanDeviceInfo,
          is_active: true,
        })
        .eq("id", existingApprovedSameDevice.id);

      return NextResponse.json({
        role: "employee",
        message: "Login successful.",
        session_token: existingApprovedSameDevice.session_token,
        approval_status: existingApprovedSameDevice.approval_status || "approved",
        employee: userRecord,
      });
    }

    const activeSessionOnOtherDevice = activeSessionsList.find(
      (s) =>
        (s.approval_status === "approved" ||
          s.approval_status === "pending_logout") &&
        s.device_fingerprint !== deviceFingerprint
    );

    const hasOtherDeviceLock =
      Boolean(activeSessionOnOtherDevice) ||
      Boolean(
        userRecord.device_id &&
          userRecord.device_id.trim() !== "" &&
          userRecord.device_id !== deviceFingerprint
      );

    if (hasOtherDeviceLock) {
      const existingPendingSession = activeSessionsList.find(
        (s) =>
          s.device_fingerprint === deviceFingerprint &&
          s.approval_status === "pending_login"
      );

      const pendingToken =
        existingPendingSession?.session_token || generateSessionToken();

      if (existingPendingSession) {
        await client
          .from("active_sessions")
          .update({
            device_info: cleanDeviceInfo,
            last_seen: pktNow.isoPkt,
            is_active: true,
          })
          .eq("id", existingPendingSession.id);
      } else {
        await client.from("active_sessions").insert({
          user_id: userRecord.id,
          device_fingerprint: deviceFingerprint,
          device_info: cleanDeviceInfo,
          session_token: pendingToken,
          is_active: true,
          approval_status: "pending_login",
          created_at: pktNow.isoPkt,
          last_seen: pktNow.isoPkt,
        });
      }

      const { data: existingPendingReq } = await client
        .from("session_requests")
        .select("id")
        .eq("user_id", userRecord.id)
        .eq("request_type", "login")
        .eq("status", "pending")
        .maybeSingle();

      if (existingPendingReq) {
        await client
          .from("session_requests")
          .update({
            device_id: deviceFingerprint,
            device_info: cleanDeviceInfo,
            created_at: pktNow.isoPkt,
          })
          .eq("id", existingPendingReq.id);
      } else {
        await client.from("session_requests").insert({
          user_id: userRecord.id,
          request_type: "login",
          device_id: deviceFingerprint,
          device_info: cleanDeviceInfo,
          status: "pending",
          created_at: pktNow.isoPkt,
        });
      }

      return NextResponse.json(
        {
          role: "employee",
          blocked_other_device: true,
          approval_status: "pending_login",
          session_token: pendingToken,
          employee: userRecord,
          message:
            "Active session detected on another device. A request has been sent to the Admin for approval. Please wait.",
          error:
            "Active session detected on another device. A request has been sent to the Admin for approval. Please wait.",
        },
        { status: 403 }
      );
    }

    const newSessionToken = generateSessionToken();

    await client.from("active_sessions").insert({
      user_id: userRecord.id,
      device_fingerprint: deviceFingerprint,
      device_info: cleanDeviceInfo,
      session_token: newSessionToken,
      is_active: true,
      approval_status: "approved",
      created_at: pktNow.isoPkt,
      last_seen: pktNow.isoPkt,
    });

    await client
      .from("users")
      .update({ device_id: deviceFingerprint })
      .eq("id", userRecord.id);

    return NextResponse.json({
      role: "employee",
      message: "Login successful.",
      session_token: newSessionToken,
      approval_status: "approved",
      employee: {
        ...userRecord,
        device_id: deviceFingerprint,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Login server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
