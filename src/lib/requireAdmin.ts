import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Uses the request's service client; never resolves env or constructs another client. */
export async function requireAdmin(req: NextRequest, client: SupabaseClient): Promise<NextResponse | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) return NextResponse.json({ error: "Admin sign-in required.", code: "ADMIN_SESSION_REQUIRED" }, { status: 401 });
  try {
    const { data, error } = await client.auth.getUser(bearer);
    if (error && /invalid api key|invalid apikey/i.test(error.message)) return NextResponse.json({ error: "Supabase rejected the configured Worker service key.", code: "SUPABASE_KEY_REJECTED" }, { status: 503 });
    if (error || !data.user) return NextResponse.json({ error: "Invalid or expired admin session. Sign in again.", code: "ADMIN_SESSION_INVALID" }, { status: 401 });
    const { data: profile, error: profileError } = await client.from("users").select("role").eq("id", data.user.id).maybeSingle();
    if (profileError) return NextResponse.json({ error: "Admin profile could not be verified.", code: "ADMIN_PROFILE_UNAVAILABLE" }, { status: 503 });
    if (profile?.role !== "admin") return NextResponse.json({ error: "Administrator role required.", code: "ADMIN_ROLE_REQUIRED" }, { status: 403 });
    return null;
  } catch { return NextResponse.json({ error: "Unable to contact Supabase to verify this session." }, { status: 503 }); }
}
