import { createRuntimeClients, runtimeConfigurationResponse, type RuntimeEnv } from "@/lib/supabaseRuntime";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { calculateDistanceInMeters } from "@/lib/geo";
import { getPktTimeInfo, calculateShiftMetricsPkt } from "@/lib/pktTime";



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
    const sessionToken = body.session_token || "";
    const deviceFingerprint = (
      body.device_fingerprint ||
      body.device_id ||
      ""
    ).trim();
    const qrData = String(body.qr_data || "").trim();
    const intent: "clock_in" | "clock_out" | "auto" =
      body.intent === "clock_in" || body.intent === "clock_out"
        ? body.intent
        : "auto";
    const rawLat = body.lat !== undefined ? body.lat : body.latitude;
    const rawLng = body.lng !== undefined ? body.lng : body.longitude;

    if (!sessionToken) {
      return NextResponse.json(
        { error: "Unauthorized session.", revoked: true },
        { status: 401 }
      );
    }

    const { data: sessionRow } = await client
      .from("active_sessions")
      .select("*")
      .eq("session_token", sessionToken)
      .eq("is_active", true)
      .maybeSingle();

    if (
      !sessionRow ||
      (sessionRow.approval_status !== "approved" &&
        sessionRow.approval_status !== "pending_logout")
    ) {
      return NextResponse.json(
        {
          error:
            "Your device session is not approved yet or was logged out by Admin.",
          revoked: true,
        },
        { status: 401 }
      );
    }

    if (
      deviceFingerprint &&
      sessionRow.device_fingerprint &&
      sessionRow.device_fingerprint !== deviceFingerprint
    ) {
      return NextResponse.json(
        {
          error:
            "Active session detected on another device. A request has been sent to the Admin for approval. Please wait.",
          revoked: true,
        },
        { status: 403 }
      );
    }

    const { data: userRow } = await client
      .from("users")
      .select("*")
      .eq("id", sessionRow.user_id)
      .maybeSingle();

    if (!userRow) {
      return NextResponse.json(
        { error: "Employee profile not found.", revoked: true },
        { status: 401 }
      );
    }

    if (!qrData) {
      return NextResponse.json(
        {
          error:
            "Invalid QR scan. Please scan the official workplace QR Code.",
        },
        { status: 400 }
      );
    }

    const empLat = Number(rawLat);
    const empLng = Number(rawLng);
    if (
      rawLat === undefined ||
      rawLng === undefined ||
      rawLat === null ||
      rawLng === null ||
      !Number.isFinite(empLat) ||
      !Number.isFinite(empLng)
    ) {
      return NextResponse.json(
        {
          error:
            "Unable to retrieve your GPS coordinates. Please enable High-Accuracy Location Services.",
        },
        { status: 400 }
      );
    }

    const { data: settingsRow, error: settingsError } = await client
      .from("settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    // =========================================================================
    // 1. DYNAMIC QR CODE VALIDATION (INSTANT INVALIDATION OF OLD QR CODES)
    // Whenever Admin clicks "Generate New QR Code", a new unique qr_secret is
    // saved to public.settings. Any old printed or photographed QR code string
    // no longer matches activeQrSecret and is immediately rejected here.
    // =========================================================================
    if (settingsError || !settingsRow?.qr_secret) return NextResponse.json({ error: "Workplace settings unavailable; attendance was not changed." }, { status: 503 });
    const activeQrSecret = String(
      settingsRow?.qr_secret ||
        settingsRow?.qr_code_string ||
        "LAB-DEFAULT-QR-SECRET-2026"
    ).trim();

    let qrMatches = qrData === activeQrSecret;
    if (!qrMatches && qrData.includes("qr=")) {
      try {
        const parsedUrl = new URL(qrData);
        const paramQr = (parsedUrl.searchParams.get("qr") || "").trim();
        if (paramQr && paramQr === activeQrSecret) {
          qrMatches = true;
        }
      } catch {
        // Not a URL
      }
    }

    if (!qrMatches) {
      return NextResponse.json(
        {
          error:
            "Invalid or expired QR Code! The Admin has generated a new workplace QR code, making old QR codes invalid. Please scan the latest QR code.",
        },
        { status: 403 }
      );
    }

    // =========================================================================
    // 2. HIGH-PRECISION HAVERSINE GPS DISTANCE ENFORCEMENT (IN METERS)
    // =========================================================================
    const officeLat = Number(settingsRow.office_lat);
    const officeLng = Number(settingsRow.office_lng);
    const allowedRadius = Number(settingsRow.radius_meters);
    if (settingsRow.office_lat == null || settingsRow.office_lng == null || !Number.isFinite(officeLat) || Math.abs(officeLat)>90 || !Number.isFinite(officeLng) || Math.abs(officeLng)>180 || !Number.isFinite(allowedRadius) || allowedRadius<1) return NextResponse.json({ error: "Invalid workplace GPS configuration. Ask Admin to correct settings." }, { status: 503 });

    const distanceMeters = calculateDistanceInMeters(
      empLat,
      empLng,
      officeLat,
      officeLng
    );

    if (!Number.isFinite(distanceMeters) || distanceMeters > allowedRadius) {
      return NextResponse.json(
        {
          error: `GPS Boundary Check Failed: You are ${
            Number.isFinite(distanceMeters)
              ? `${distanceMeters.toFixed(2)} meters`
              : "too far"
          } away from the workplace, which exceeds the Admin's ${allowedRadius}-meter radius limit.`,
          distance_meters: distanceMeters,
          allowed_radius_meters: allowedRadius,
          location_verified: false,
        },
        { status: 403 }
      );
    }

    const dutyStart = userRow.duty_start_time || "09:00:00";
    const dutyEnd = userRow.duty_end_time || "17:00:00";
    const pktNow = getPktTimeInfo(new Date());

    const { data: approvedLeave, error: leaveError } = await client.from("leaves").select("leave_type,hours_missed").eq("user_id", userRow.id).eq("date", pktNow.dateStr).eq("status", "approved").maybeSingle();
    if (leaveError) return NextResponse.json({ error: "Cannot verify leave status. Attendance was not changed. Please retry." }, { status: 503 });
    if (approvedLeave && ["paid", "unpaid"].includes(approvedLeave.leave_type)) return NextResponse.json({ error: "Approved full-day leave: cancel your leave before marking attendance.", leave_blocked: true }, { status: 409 });
    const shortMissedHours = approvedLeave?.leave_type === "short" ? Math.max(0, Number(approvedLeave.hours_missed || 0)) : 0;

    const { data: existingRecord, error: attendanceReadError } = await client
      .from("attendance")
      .select("*")
      .eq("user_id", userRow.id)
      .eq("date", pktNow.dateStr)
      .maybeSingle();

    if (attendanceReadError) return NextResponse.json({ error: attendanceReadError.message }, { status: 503 });
    const existingClockIn =
      existingRecord?.clock_in || existingRecord?.login_time || null;
    const existingClockOut =
      existingRecord?.clock_out || existingRecord?.logout_time || null;

    // Validate explicit Check-In / Check-Out button intent
    if (intent === "clock_in" && existingClockIn) {
      return NextResponse.json(
        {
          error:
            "You have already Checked In for today. Please use the 'Check-Out' button when ending your shift.",
          distance_meters: distanceMeters,
          record: existingRecord,
        },
        { status: 400 }
      );
    }

    if (intent === "clock_out" && !existingClockIn) {
      return NextResponse.json(
        {
          error:
            "You have not Checked In today yet. Please use the 'Check-In' button first.",
          distance_meters: distanceMeters,
        },
        { status: 400 }
      );
    }

    // =========================================================================
    // 3A. CHECK-IN FLOW
    // =========================================================================
    if (!existingRecord || !existingClockIn) {
      const preservedManualOtHours = Math.max(
        0,
        Number(existingRecord?.overtime_hours || 0)
      );
      const preservedManualOtMins = Math.max(
        0,
        Number(existingRecord?.overtime_minutes || 0)
      );

      const { data: inserted, error: insertErr } = await client
        .from("attendance")
        .upsert(
          {
            user_id: userRow.id,
            date: pktNow.dateStr,
            clock_in: pktNow.isoPkt,
            login_time: pktNow.isoPkt,
            status: "Present",
            overtime_hours: preservedManualOtHours,
            overtime_minutes: preservedManualOtMins,
            missed_hours: shortMissedHours,
          },
          { onConflict: "user_id,date" }
        )
        .select()
        .single();

      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }

      return NextResponse.json({
        action: "clock_in",
        message: `Check-In verified at ${pktNow.displayTime} (GPS Distance: ${distanceMeters.toFixed(
          2
        )}m / ${allowedRadius}m limit).`,
        distance_meters: distanceMeters,
        allowed_radius_meters: allowedRadius,
        record: {
          ...inserted,
          clock_in: inserted.clock_in || pktNow.isoPkt,
          login_time: inserted.login_time || pktNow.isoPkt,
          clock_out: null,
          logout_time: null,
          overtime_hours: Math.max(0, Number(inserted.overtime_hours || 0)),
        },
      });
    }

    // =========================================================================
    // 3B. CHECK-OUT FLOW
    // Overtime = max(0, CheckOutTime - max(DutyEndTime, CheckInTime))
    // =========================================================================
    if (!existingClockOut) {
      const { overtimeMinutes, overtimeHours } = calculateShiftMetricsPkt(
        existingClockIn,
        pktNow.isoPkt,
        dutyStart,
        dutyEnd
      );

      // A manual correction is an explicit final total, never an additive bonus.
      const finalOvertimeHours = existingRecord?.overtime_override_hours != null
        ? Math.max(0, Number(existingRecord.overtime_override_hours)) : overtimeHours;
      const finalOvertimeMinutes = Math.max(
        0,
        Math.round(finalOvertimeHours * 60)
      );

      const { data: updated, error: updateErr } = await client
        .from("attendance")
        .update({
          clock_out: pktNow.isoPkt,
          logout_time: pktNow.isoPkt,
          overtime_minutes: finalOvertimeMinutes,
          overtime_hours: finalOvertimeHours,
          missed_hours: shortMissedHours,
        })
        .eq("id", existingRecord.id)
        .is("clock_out", null)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      const summarySuffix =
        finalOvertimeHours > 0
          ? ` | Overtime: +${finalOvertimeHours.toFixed(2)} hrs (${overtimeMinutes} mins after duty end)`
          : " | Shift Completed (0.00 hrs Overtime)";

      return NextResponse.json({
        action: "clock_out",
        message: `Check-Out verified at ${pktNow.displayTime} (GPS: ${distanceMeters.toFixed(
          2
        )}m)${summarySuffix}.`,
        distance_meters: distanceMeters,
        allowed_radius_meters: allowedRadius,
        overtime_hours: finalOvertimeHours,
        missed_hours: shortMissedHours,
        record: {
          ...updated,
          clock_in: updated.clock_in || existingClockIn,
          login_time: updated.login_time || existingClockIn,
          clock_out: updated.clock_out || pktNow.isoPkt,
          logout_time: updated.logout_time || pktNow.isoPkt,
          overtime_hours: finalOvertimeHours,
          missed_hours: shortMissedHours,
        },
      });
    }

    return NextResponse.json(
      {
        action: "already_completed",
        error:
          "You have already completed both Check-In and Check-Out for today (PKT).",
        distance_meters: distanceMeters,
        record: {
          ...existingRecord,
          clock_in: existingClockIn,
          login_time: existingClockIn,
          clock_out: existingClockOut,
          logout_time: existingClockOut,
          overtime_hours: Math.max(
            0,
            Number(existingRecord.overtime_hours || 0)
          ),
        },
      },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to process attendance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
