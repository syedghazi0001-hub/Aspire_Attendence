/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";

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

async function ownsApprovedSession(client: any, userId: string, token: string, fingerprint: string) {
  if (!userId || !token || !fingerprint) return false;
  const { data, error } = await client.from("active_sessions").select("user_id, device_fingerprint, approval_status").eq("session_token", token).eq("is_active", true).maybeSingle();
  return !error && data?.user_id === userId && data.device_fingerprint === fingerprint && ["approved", "pending_logout"].includes(data.approval_status);
}

export async function GET(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }

  const client = createAdminClientFromCloudflare(cfEnv);
  if (!client) {
    return NextResponse.json({ leaves: [] });
  }

  try {
    const { searchParams } = new URL(req.url);
    const userId = (searchParams.get("user_id") || "").trim();
    if (!await ownsApprovedSession(client, userId, searchParams.get("session_token") || "", searchParams.get("fp") || "")) return NextResponse.json({ error: "Approved device session required." }, { status: 401 });
    if (!userId) {
      return NextResponse.json({ leaves: [] });
    }

    const { data, error } = await client
      .from("leaves")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(
        { error: error.message, leaves: [] },
        { status: 500 }
      );
    }

    const formatted = (data || []).map((row: Record<string, any>) => {
      const rawReason = String(row.reason || "")
        .replace(/^\[MANUAL\]\s*/i, "")
        .trim();
      const catMatch = rawReason.match(/^\[([^\]]+)\]\s*(.*)$/);
      const leaveCategory = catMatch
        ? catMatch[1]
        : row.leave_type === "paid"
        ? "Paid Leave"
        : row.leave_type === "unpaid"
        ? "Unpaid Leave"
        : "Short Leave";
      const displayReason = catMatch ? catMatch[2].trim() : rawReason;

      return {
        ...row,
        leave_category: leaveCategory,
        reason: displayReason,
        is_paid: row.leave_type === "paid",
      };
    });

    return NextResponse.json({ leaves: formatted });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load leaves";
    return NextResponse.json({ error: msg, leaves: [] }, { status: 500 });
  }
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
    const userId = String(body.user_id || "").trim();
    if (!await ownsApprovedSession(client, userId, String(body.session_token || ""), String(body.device_fingerprint || ""))) return NextResponse.json({ error: "Approved device session required." }, { status: 401 });
    const rawLeaveType = String(body.leave_type || "paid")
      .toLowerCase()
      .trim();
    const leaveCategory = String(body.leave_category || "").trim();
    const date = String(body.date || "").trim();
    // Reason is strictly OPTIONAL per user specification
    const optionalReason = String(body.reason || "").trim();

    if (!userId || !date) {
      return NextResponse.json(
        { error: "Please select a Leave Type and Date." },
        { status: 400 }
      );
    }

    // Map custom categories (Sick, Casual, Annual, Emergency) safely to Postgres ('paid' | 'unpaid' | 'short')
    let dbLeaveType: "paid" | "unpaid" | "short" = "paid";
    if (rawLeaveType === "unpaid") {
      dbLeaveType = "unpaid";
    } else if (rawLeaveType === "short") {
      dbLeaveType = "short";
    } else {
      dbLeaveType = "paid";
    }

    const hoursMissed =
      dbLeaveType === "short"
        ? Math.max(0.5, parseFloat(String(body.hours_missed || "2")) || 2)
        : 0;

    const categoryPrefix = leaveCategory ? `[${leaveCategory}]` : "";
    const combinedReason = [categoryPrefix, optionalReason]
      .filter(Boolean)
      .join(" ")
      .trim();

    const { data, error } = await client
      .from("leaves")
      .upsert(
        {
          user_id: userId,
          date,
          leave_type: dbLeaveType,
          hours_missed: hoursMissed,
          reason: combinedReason,
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
      message: "Leave application submitted to Admin for review.",
      leave: data,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to submit leave application";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
