import { createClient } from "@supabase/supabase-js";
import { readSupabaseConfig, runtimeConfigurationResponse, type RequestSupabaseClients } from "@/lib/supabaseRuntime";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/requireAdmin";
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

  const denied = await requireAdmin(req, requestClients.client); if (denied) return denied;
  const month = new URL(req.url).searchParams.get("month") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Invalid payroll month." }, { status: 400 });
  try {
    const { client } = requestClients;
    const { data, error } = await client.rpc("get_payroll_inputs", { p_month: month });
    if (error) return NextResponse.json({ error: `Payroll snapshot unavailable: ${error.message}. Confirm all migrations were applied.` }, { status: 503 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Payroll data unavailable. No report should be authorized." }, { status: 503 }); }
}
