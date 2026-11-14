import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export async function requireAdmin(req: NextRequest, env: Record<string, unknown>): Promise<NextResponse | null> {
  const url = String(env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url || !key) return NextResponse.json({ error: "Server Supabase service credentials required." }, { status: 503 });
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(bearer);
    if (error || !data.user) return NextResponse.json({ error: "Invalid admin session." }, { status: 401 });
    const { data: profile, error: profileError } = await client.from("users").select("role").eq("id", data.user.id).single();
    if (profileError || profile?.role !== "admin") return NextResponse.json({ error: "Administrator role required." }, { status: 403 });
    return null;
  } catch { return NextResponse.json({ error: "Unable to verify admin authorization." }, { status: 503 }); }
}
