/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/requireAdmin";
export async function GET(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try { const { env } = getCloudflareContext(); cfEnv = env as Record<string, any>; } catch { /* local environment */ }
  const denied = await requireAdmin(req, cfEnv); if (denied) return denied;
  const month = new URL(req.url).searchParams.get("month") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Invalid payroll month." }, { status: 400 });
  try {
    const client = createClient(String(cfEnv.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL), String(cfEnv.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc("get_payroll_inputs", { p_month: month });
    if (error) return NextResponse.json({ error: `Payroll snapshot unavailable: ${error.message}. Confirm all migrations were applied.` }, { status: 503 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Payroll data unavailable. No report should be authorized." }, { status: 503 }); }
}
