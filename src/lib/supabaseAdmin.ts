import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createRuntimeClients, type RuntimeEnv } from "./supabaseRuntime";
export type { RuntimeEnv } from "./supabaseRuntime";
/** Compatibility function. Invoke only from a request handler, never module scope. */
export function getSupabaseAdmin(_req?: NextRequest) {
  const { env } = getCloudflareContext();
  const clients = createRuntimeClients(env as RuntimeEnv);
  return { ...clients, isConfigured: true, hasServiceRole: true };
}
