/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { employeeIdToAuthEmail } from "@/lib/geo";
import { getPktTimeInfo } from "@/lib/pktTime";

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

export async function POST(req: NextRequest, context: any) {
  try {
    const { client, anonClient, isConfigured } = getSupabaseAdmin(req, context);
    if (!isConfigured || !client || !anonClient) {
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
    const deviceInfo = (body.device_info || "Browser Session").trim();

    if (!rawIdentifier || !password) {
      return NextResponse.json(
        { error: "Please enter your ID / Email and Password." },
        { status: 400 }
      );
    }

    const isEmailInput = rawIdentifier.includes("@");
    const normalizedEmpId = rawIdentifier.toUpperCase();
    const loginEmail = isEmailInput
      ? rawIdentifier.toLowerCase()
      : employeeIdToAuthEmail(normalizedEmpId);

    const { data: authData, error: authErr } =
      await anonClient.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

    if (authErr || !authData?.user) {
      return NextResponse.json(
        {
          error: "Invalid Employee ID / Email or Password.",
        },
        { status: 401 }
      );
    }

    let { data: userRecord } = await client
      .from("users")
      .select("*")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (!userRecord && !isEmailInput) {
      const { data: byEmpId } = await client
        .from("users")
        .select("*")
        .ilike("employee_id", normalizedEmpId)
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
        { error: "Device fingerprint could not be verified." },
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

    const approvedOtherDevice = activeSessionsList.find(
      (s) =>
        (s.approval_status === "approved" ||
          s.approval_status === "pending_logout") &&
        s.device_fingerprint !== deviceFingerprint
    );

    if (
      approvedOtherDevice ||
      (userRecord.device_id &&
        userRecord.device_id.trim() !== "" &&
        userRecord.device_id !== deviceFingerprint)
    ) {
      const existingPendingOnThisDevice = activeSessionsList.find(
        (s) =>
          s.device_fingerprint === deviceFingerprint &&
          s.approval_status === "pending_login"
      );

      let pendingToken = existingPendingOnThisDevice?.session_token;

      if (!existingPendingOnThisDevice) {
        pendingToken = generateSessionToken();
        await client.from("active_sessions").insert({
          user_id: userRecord.id,
          device_fingerprint: deviceFingerprint,
          device_info: deviceInfo,
          session_token: pendingToken,
          is_active: true,
          approval_status: "pending_login",
          created_at: pktNow.isoPkt,
          last_seen: pktNow.isoPkt,
        });

        await client.from("session_requests").insert({
          user_id: userRecord.id,
          request_type: "login",
          device_id: deviceFingerprint,
          device_info: deviceInfo,
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
          error:
            "Active session detected on another device. A Pending Login request has been sent to the Admin for approval.",
        },
        { status: 403 }
      );
    }

    const existingApprovedSameDevice = activeSessionsList.find(
      (s) =>
        s.device_fingerprint === deviceFingerprint &&
        (s.approval_status === "approved" ||
          s.approval_status === "pending_logout")
    );

    if (
      existingApprovedSameDevice ||
      (userRecord.device_id && userRecord.device_id === deviceFingerprint)
    ) {
      const sessionToken =
        existingApprovedSameDevice?.session_token || generateSessionToken();
      const currentStatus =
        existingApprovedSameDevice?.approval_status || "approved";

      if (existingApprovedSameDevice) {
        await client
          .from("active_sessions")
          .update({ last_seen: pktNow.isoPkt, is_active: true })
          .eq("id", existingApprovedSameDevice.id);
      } else {
        await client.from("active_sessions").insert({
          user_id: userRecord.id,
          device_fingerprint: deviceFingerprint,
          device_info: deviceInfo,
          session_token: sessionToken,
          is_active: true,
          approval_status: "approved",
          created_at: pktNow.isoPkt,
          last_seen: pktNow.isoPkt,
        });
      }

      return NextResponse.json({
        role: "employee",
        message: "Login verified on locked device.",
        session_token: sessionToken,
        approval_status: currentStatus,
        employee: userRecord,
      });
    }

    const existingPendingSameDevice = activeSessionsList.find(
      (s) =>
        s.device_fingerprint === deviceFingerprint &&
        s.approval_status === "pending_login"
    );

    const sessionToken =
      existingPendingSameDevice?.session_token || generateSessionToken();

    if (existingPendingSameDevice) {
      await client
        .from("active_sessions")
        .update({ last_seen: pktNow.isoPkt, device_info: deviceInfo })
        .eq("id", existingPendingSameDevice.id);
    } else {
      await client.from("active_sessions").insert({
        user_id: userRecord.id,
        device_fingerprint: deviceFingerprint,
        device_info: deviceInfo,
        session_token: sessionToken,
        is_active: true,
        approval_status: "pending_login",
        created_at: pktNow.isoPkt,
        last_seen: pktNow.isoPkt,
      });

      await client.from("session_requests").insert({
        user_id: userRecord.id,
        request_type: "login",
        device_id: deviceFingerprint,
        device_info: deviceInfo,
        status: "pending",
        created_at: pktNow.isoPkt,
      });
    }

    return NextResponse.json({
      role: "employee",
      message: "Waiting for Admin Approval",
      session_token: sessionToken,
      approval_status: "pending_login",
      employee: userRecord,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Login server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
