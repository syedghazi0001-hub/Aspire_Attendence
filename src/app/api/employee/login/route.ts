import { createRuntimeClients, runtimeConfigurationResponse, type RuntimeEnv } from "@/lib/supabaseRuntime";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { employeeIdToAuthEmail, normalizeEmployeeIdFormat } from "@/lib/geo";
import { getPktTimeInfo } from "@/lib/pktTime";



async function checked(operation: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await operation;
  if (error) throw new Error(`Login session could not be saved: ${error.message}`);
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
  let cfEnv: RuntimeEnv;
  let requestClients: ReturnType<typeof createRuntimeClients>;
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as RuntimeEnv;
    requestClients = createRuntimeClients(cfEnv, true);
  } catch (error) { return runtimeConfigurationResponse(error); }


  try {
    const { client, anonClient } = requestClients;
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
    const rawIdentifier = String(body.identifier || body.employee_id || "").trim();
    const password = typeof body.password === "string" ? body.password : "";
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
      // Profiles may retain a legacy Auth email. Resolve only via the same employee's Auth UUID.
      const { data: assignedProfile, error: lookupError } = await client.from("users").select("id").in("employee_id", [canonicalEmpId, rawUpperEmpId]).limit(1).maybeSingle();
      if (lookupError) return NextResponse.json({ error: "Supabase profile lookup failed. Verify the Worker service key and database availability.", code: "SUPABASE_PROFILE_LOOKUP_FAILED" }, { status: 503 });
      if (assignedProfile) {
        const { data: assignedAuth, error: authLookupError } = await client.auth.admin.getUserById(assignedProfile.id);
        if (authLookupError) return NextResponse.json({ error: "Employee Auth record is unavailable. Contact Admin.", code: "AUTH_RECORD_UNAVAILABLE" }, { status: 503 });
        if (assignedAuth.user?.email) candidateEmails.push(assignedAuth.user.email);
      }
      candidateEmails.push(employeeIdToAuthEmail(canonicalEmpId), employeeIdToAuthEmail(rawUpperEmpId));
    }
    let authUser: any = null;
    let authenticatedSession: { access_token: string; refresh_token: string } | null = null;
    for (const emailCandidate of [...new Set(candidateEmails)]) {
      const { data: authData, error: authErr } = await anonClient.auth.signInWithPassword({ email: emailCandidate, password });
      if (!authErr && authData?.user && authData.session) {
        authUser = authData.user;
        authenticatedSession = { access_token: authData.session.access_token, refresh_token: authData.session.refresh_token };
        break;
      }
      if (authErr) {
        if (authErr.status === 429) return NextResponse.json({ error: "Too many login attempts. Please wait before trying again.", code: "AUTH_RATE_LIMITED" }, { status: 429 });
        if (authErr.code === "email_not_confirmed") return NextResponse.json({ error: "Account email is not confirmed. Contact Admin.", code: "EMAIL_NOT_CONFIRMED" }, { status: 403 });
        const invalidPassword = authErr.code === "invalid_credentials" || /invalid login credentials/i.test(authErr.message);
        if (!invalidPassword) return NextResponse.json({ error: "Supabase authentication is unavailable or the configured public key was rejected.", code: "SUPABASE_AUTH_UNAVAILABLE" }, { status: 503 });
      }
    }
    if (!authUser) return NextResponse.json({ error: "Invalid credentials. Please check your ID/Email and Password.", code: "INVALID_CREDENTIALS" }, { status: 401 });
    const { data: userRecord, error: profileError } = await client.from("users").select("*").eq("id", authUser.id).maybeSingle();
    if (profileError) return NextResponse.json({ error: "Authenticated, but the profile could not be loaded. Verify service key/database access.", code: "PROFILE_UNAVAILABLE" }, { status: 503 });
    if (!userRecord) return NextResponse.json({ error: "User profile missing. Contact Admin.", code: "PROFILE_MISSING" }, { status: 403 });
    if (userRecord.role === "admin") return NextResponse.json({ role: "admin", auth_session: authenticatedSession, message: "Admin login successful." }, { headers: { "Cache-Control": "no-store" } });
    if (userRecord.role !== "employee") return NextResponse.json({ error: "Account role is not enabled." }, { status: 403 });

    if (!deviceFingerprint) {
      return NextResponse.json(
        { error: "Could not verify device identity." },
        { status: 400 }
      );
    }

    const pktNow = getPktTimeInfo(new Date());

    const { data: userSessions, error: sessionsError } = await client
      .from("active_sessions")
      .select("*")
      .eq("user_id", userRecord.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (sessionsError) throw new Error("Unable to verify existing device sessions. Login was not granted.");
    const activeSessionsList = userSessions || [];

    const existingApprovedSameDevice = activeSessionsList.find(
      (s) =>
        s.device_fingerprint === deviceFingerprint &&
        (s.approval_status === "approved" ||
          s.approval_status === "pending_logout")
    );

    if (existingApprovedSameDevice) {
      await checked(client
        .from("active_sessions")
        .update({
          last_seen: pktNow.isoPkt,
          device_info: cleanDeviceInfo,
          is_active: true,
        })
        .eq("id", existingApprovedSameDevice.id));

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
        await checked(client
          .from("active_sessions")
          .update({
            device_info: cleanDeviceInfo,
            last_seen: pktNow.isoPkt,
            is_active: true,
          })
          .eq("id", existingPendingSession.id));
      } else {
        await checked(client.from("active_sessions").insert({
          user_id: userRecord.id,
          device_fingerprint: deviceFingerprint,
          device_info: cleanDeviceInfo,
          session_token: pendingToken,
          is_active: true,
          approval_status: "pending_login",
          created_at: pktNow.isoPkt,
          last_seen: pktNow.isoPkt,
        }));
      }

      const { data: existingPendingReq } = await client
        .from("session_requests")
        .select("id")
        .eq("user_id", userRecord.id)
        .eq("request_type", "login")
        .eq("status", "pending")
        .maybeSingle();

      if (existingPendingReq) {
        await checked(client
          .from("session_requests")
          .update({
            device_id: deviceFingerprint,
            device_info: cleanDeviceInfo,
            created_at: pktNow.isoPkt,
          })
          .eq("id", existingPendingReq.id));
      } else {
        await checked(client.from("session_requests").insert({
          user_id: userRecord.id,
          request_type: "login",
          device_id: deviceFingerprint,
          device_info: cleanDeviceInfo,
          status: "pending",
          created_at: pktNow.isoPkt,
        }));
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

    await checked(client.from("active_sessions").insert({
      user_id: userRecord.id,
      device_fingerprint: deviceFingerprint,
      device_info: cleanDeviceInfo,
      session_token: newSessionToken,
      is_active: true,
      approval_status: "approved",
      created_at: pktNow.isoPkt,
      last_seen: pktNow.isoPkt,
    }));

    await checked(client
      .from("users")
      .update({ device_id: deviceFingerprint })
      .eq("id", userRecord.id));

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
