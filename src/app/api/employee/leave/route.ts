/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";

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
    const userId = (body.user_id || "").trim();
    const rawLeaveType = String(body.leave_type || "paid")
      .toLowerCase()
      .trim();
    const date = (body.date || "").trim();
    const reason = (body.reason || "").trim();
    const hoursMissed =
      rawLeaveType === "short"
        ? Math.max(0.5, parseFloat(String(body.hours_missed || "2")) || 2)
        : 0;

    if (!userId || !date) {
      return NextResponse.json(
        { error: "Please select a valid Leave Type and Date." },
        { status: 400 }
      );
    }

    const leaveType = ["paid", "unpaid", "short"].includes(rawLeaveType)
      ? rawLeaveType
      : "paid";

    const { data, error } = await client
      .from("leaves")
      .upsert(
        {
          user_id: userId,
          date,
          leave_type: leaveType,
          hours_missed: hoursMissed,
          reason,
          status: "pending",
        },
        { onConflict: "user_id,date" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Leave application submitted to Admin.",
      leave: data,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to submit leave application";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
