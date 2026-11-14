/* eslint-disable @typescript-eslint/no-explicit-any */
import { APP_RELEASE } from "@/lib/release";
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readSupabaseConfig, runtimeConfigurationResponse, type RuntimeEnv } from "@/lib/supabaseRuntime";
export const dynamic = "force-dynamic";
/** Only public values may leave this endpoint. No service key and no env object serialization. */
export async function GET(_req: NextRequest, _context: any) {
  try {
    const { env } = getCloudflareContext();
    const { url, anonKey } = readSupabaseConfig(env as RuntimeEnv, { publicOnly: true });
    return NextResponse.json({ url, anonKey }, { headers: { "Cache-Control": "no-store", "X-Aspire-Release": APP_RELEASE } });
  } catch (error) { return runtimeConfigurationResponse(error); }
}
