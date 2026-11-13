/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { calculateDistanceInMeters } from "@/lib/geo";
import { getPktTimeInfo, calculateShiftMetricsPkt } from "@/lib/pktTime";

function createAdminClientFromCloudflare() {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    if (env) cfEnv = env as Record<string, any>;
  } catch {
    // Fallback for local dev
  }

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

export async function POST(req: NextRequest, _context: any) {
  const client = createAdminClientFromCloudflare();
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
    const qrData = body.qr_data || "";
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

    if (!qrData || typeof qrData !== "string" || !qrData.trim()) {
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
      Number.isNaN(empLat) ||
      Number.isNaN(empLng)
    ) {
      return NextResponse.json(
        {
          error:
            "Unable to retrieve your mobile GPS coordinates. Please enable Location Services.",
        },
        { status: 400 }
      );
    }

    const { data: settingsRow } = await client
      .from("settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    const officeLat = Number(
      settingsRow?.office_lat ??
        settingsRow?.lab_lat ??
        settingsRow?.lab_latitude ??
        32.64
    );
    const officeLng = Number(
      settingsRow?.office_lng ??
        settingsRow?.lab_lng ??
        settingsRow?.lab_longitude ??
        74.18
    );
    const allowedRadius = Number(
      settingsRow?.radius_meters ?? settingsRow?.allowed_radius_meters ?? 100
    );

    const distanceMeters = calculateDistanceInMeters(
      empLat,
      empLng,
      officeLat,
      officeLng
    );

    if (distanceMeters > allowedRadius) {
      return NextResponse.json(
        {
          error: `You are outside the ${allowedRadius}-meter radius of the workplace (Your distance: ${distanceMeters.toFixed(
            1
          )}m). Attendance rejected.`,
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

    const { data: existingRecord } = await client
      .from("attendance")
      .select("*")
      .eq("user_id", userRow.id)
      .eq("date", pktNow.dateStr)
      .maybeSingle();

    const existingClockIn =
      existingRecord?.clock_in || existingRecord?.login_time || null;
    const existingClockOut =
      existingRecord?.clock_out || existingRecord?.logout_time || null;

    if (!existingRecord || !existingClockIn) {
      const { data: inserted, error: insertErr } = await client
        .from("attendance")
        .upsert(
          {
            user_id: userRow.id,
            date: pktNow.dateStr,
            clock_in: pktNow.isoPkt,
            login_time: pktNow.isoPkt,
            status: "Present",
            overtime_hours: 0,
            missed_hours: 0,
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
        message: `Clock In recorded at ${pktNow.displayTime} PKT (Distance: ${distanceMeters.toFixed(
          1
        )}m <= ${allowedRadius}m).`,
        distance_meters: distanceMeters,
        allowed_radius_meters: allowedRadius,
        record: {
          ...inserted,
          clock_in: inserted.clock_in || pktNow.isoPkt,
          login_time: inserted.login_time || pktNow.isoPkt,
          clock_out: null,
          logout_time: null,
        },
      });
    }

    if (!existingClockOut) {
      const { overtimeMinutes, overtimeHours, missedHours } =
        calculateShiftMetricsPkt(
          existingClockIn,
          pktNow.isoPkt,
          dutyStart,
          dutyEnd
        );

      const { data: updated, error: updateErr } = await client
        .from("attendance")
        .update({
          clock_out: pktNow.isoPkt,
          logout_time: pktNow.isoPkt,
          overtime_minutes: overtimeMinutes,
          overtime_hours: overtimeHours,
          missed_hours: missedHours,
        })
        .eq("id", existingRecord.id)
        .select()
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      if (missedHours > 0) {
        await client.from("leaves").upsert(
          {
            user_id: userRow.id,
            date: pktNow.dateStr,
            leave_type: "short",
            hours_missed: missedHours,
            reason: "Early clock-out before duty end time (auto-recorded)",
            status: "approved",
          },
          { onConflict: "user_id,date" }
        );
      }

      let summarySuffix = " | Shift Completed";
      if (overtimeHours > 0) {
        summarySuffix = ` | Overtime: ${overtimeHours} hrs (${overtimeMinutes} mins)`;
      } else if (missedHours > 0) {
        summarySuffix = ` | Short Leave: ${missedHours} hrs missed`;
      }

      return NextResponse.json({
        action: "clock_out",
        message: `Clock Out recorded at ${pktNow.displayTime} PKT${summarySuffix}.`,
        distance_meters: distanceMeters,
        allowed_radius_meters: allowedRadius,
        overtime_hours: overtimeHours,
        missed_hours: missedHours,
        record: {
          ...updated,
          clock_in: updated.clock_in || existingClockIn,
          login_time: updated.login_time || existingClockIn,
          clock_out: updated.clock_out || pktNow.isoPkt,
          logout_time: updated.logout_time || pktNow.isoPkt,
        },
      });
    }

    return NextResponse.json(
      {
        action: "already_completed",
        error:
          "You have already completed both Clock In and Clock Out for today (PKT).",
        distance_meters: distanceMeters,
        record: {
          ...existingRecord,
          clock_in: existingClockIn,
          login_time: existingClockIn,
          clock_out: existingClockOut,
          logout_time: existingClockOut,
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
