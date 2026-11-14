/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readSupabaseConfig, SupabaseConfigurationError, type RuntimeEnv } from "@/lib/supabaseRuntime";
import { APP_RELEASE } from "@/lib/release";
export const dynamic = "force-dynamic";
/** Configuration-only readiness: no keys/values, account details, or DB probes. */
export async function GET(_req: NextRequest, _context: any) {
  const headers = { "Cache-Control": "no-store", "X-Aspire-Release": APP_RELEASE };
  try {
    const { env } = getCloudflareContext();
    readSupabaseConfig(env as RuntimeEnv, { requireAnon: true });
    return NextResponse.json({ release: APP_RELEASE, configurationReady: true, liveSupabaseVerified: false }, { headers });
  } catch (error) {
    return NextResponse.json({ release: APP_RELEASE, configurationReady: false, liveSupabaseVerified: false,
      code: "SUPABASE_CONFIGURATION_ERROR",
      bindings: error instanceof SupabaseConfigurationError ? error.invalidBindings : [],
      error: error instanceof SupabaseConfigurationError ? error.message : "Cloudflare request bindings are unavailable.",
    }, { status: 503, headers });
  }
}
