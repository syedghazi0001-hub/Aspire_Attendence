import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readSupabaseConfig } from "./supabaseRuntime";
export type { RuntimeEnv } from "./supabaseRuntime";
/** Compatibility helper; call from a request handler only. No module-level client. */
export function getSupabaseAdmin(_req?: NextRequest) {
  const { env } = getCloudflareContext();
  const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "").trim();
  const supabaseAnonKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? env.ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY ?? "").trim();
  readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey });
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const client = createClient(supabaseUrl, serviceRoleKey, options);
  // A public auth client is optional here; password login requires it in its own route.
  const anonClient = supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, options) : client;
  return { client, anonClient, isConfigured: true, hasServiceRole: true };
}
