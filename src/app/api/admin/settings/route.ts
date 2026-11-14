/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireAdmin } from "@/lib/requireAdmin";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";

function createAdminClientFromCloudflare(req: NextRequest, cfEnv: Record<string, any>) {

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

  const authHeader = req.headers.get("authorization") || "";
  return createClient(supabaseUrl, activeKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(!serviceRoleKey && authHeader
      ? { global: { headers: { Authorization: authHeader } } }
      : {}),
  });
}

const DEFAULT_SETTINGS = {
  id: 1,
  office_lat: 32.64,
  office_lng: 74.18,
  lab_lat: 32.64,
  lab_lng: 74.18,
  radius_meters: 100,
  qr_secret: "LAB-DEFAULT-QR-SECRET-2026",
  qr_code_string: "LAB-DEFAULT-QR-SECRET-2026",
};

export async function GET(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  const client = createAdminClientFromCloudflare(req, cfEnv);
  if (!client) {
    return NextResponse.json({ error: "Settings unavailable." }, { status: 503 });
  }

  const { data, error } = await client
    .from("settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Settings row missing. Run the schema setup." }, { status: 503 });
  }

  const lat = Number(
    data.office_lat ?? data.lab_lat ?? data.lab_latitude ?? 32.64
  );
  const lng = Number(
    data.office_lng ?? data.lab_lng ?? data.lab_longitude ?? 74.18
  );
  const radius = Number(
    data.radius_meters ?? data.allowed_radius_meters ?? 100
  );
  const qrSecret = String(
    data.qr_secret ||
      data.qr_code_string ||
      data.portal_qr_url ||
      "LAB-DEFAULT-QR-SECRET-2026"
  );

  return NextResponse.json({
    settings: {
      id: 1,
      office_lat: lat,
      office_lng: lng,
      lab_lat: lat,
      lab_lng: lng,
      radius_meters: radius,
      qr_secret: qrSecret,
      qr_code_string: qrSecret,
    },
  });
}

async function handleSaveSettings(req: NextRequest, cfEnv: Record<string, any>) {
  const client = createAdminClientFromCloudflare(req, cfEnv);
  if (!client) {
    return NextResponse.json(
      { error: "Supabase credentials missing." },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const latRaw = body.office_lat ?? body.lab_lat ?? body.lab_latitude;
    const lngRaw = body.office_lng ?? body.lab_lng ?? body.lab_longitude;
    const radiusRaw = body.radius_meters ?? body.allowed_radius_meters;
    const qrRaw = body.qr_secret ?? body.qr_code_string;
    if (latRaw !== undefined) { const lat = Number(latRaw); if (!Number.isFinite(lat) || Math.abs(lat) > 90) return NextResponse.json({ error: "Invalid latitude." }, { status: 400 }); patch.office_lat = lat; }
    if (lngRaw !== undefined) { const lng = Number(lngRaw); if (!Number.isFinite(lng) || Math.abs(lng) > 180) return NextResponse.json({ error: "Invalid longitude." }, { status: 400 }); patch.office_lng = lng; }
    if (radiusRaw !== undefined) { const radius = Number(radiusRaw); if (!Number.isFinite(radius) || radius < 1) return NextResponse.json({ error: "Radius must be at least 1 meter." }, { status: 400 }); patch.radius_meters = radius; }
    if (qrRaw !== undefined) { const qr = String(qrRaw).trim(); if (!qr) return NextResponse.json({ error: "QR token cannot be empty." }, { status: 400 }); patch.qr_secret = qr; }
    const { data, error } = await client.from("settings").update(patch).eq("id", 1).select().single();

    if (error) {
      return NextResponse.json(
        { error: `Failed to save settings: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "GPS Geofence & QR settings saved successfully.",
      settings: {
        ...data,
        lab_lat: data.office_lat,
        lab_lng: data.office_lng,
        qr_code_string: data.qr_secret,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to save GPS settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  return handleSaveSettings(req, cfEnv);
}

export async function POST(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  return handleSaveSettings(req, cfEnv);
}
