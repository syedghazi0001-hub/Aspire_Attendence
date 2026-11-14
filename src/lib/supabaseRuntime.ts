import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/** Only Worker bindings supplied by a request handler. Never process.env. */
export interface RuntimeEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  [key: string]: unknown;
}
export class SupabaseConfigurationError extends Error {
  constructor(public readonly invalidBindings: string[]) {
    super(`Missing or invalid Cloudflare Worker binding(s): ${invalidBindings.join(", ")}.`);
    this.name = "SupabaseConfigurationError";
  }
}
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
function jwtRole(key: string): string | undefined {
  try { return JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; }
  catch { return undefined; }
}
export function readSupabaseConfig(env: RuntimeEnv, options: { publicOnly?: boolean; requireAnon?: boolean } = {}) {
  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL) || clean(env.SUPABASE_URL);
  const anonKey = clean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || clean(env.SUPABASE_ANON_KEY) || clean(env.ANON_KEY) || clean(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) || clean(env.SUPABASE_PUBLISHABLE_KEY);
  const serviceRoleKey = clean(env.SUPABASE_SERVICE_ROLE_KEY) || clean(env.SUPABASE_SECRET_KEY);
  const invalid: string[] = [];
  let validUrl = false;
  try { const parsed = new URL(url); validUrl = ["http:", "https:"].includes(parsed.protocol) && !url.includes("your-project-id") && !url.includes("placeholder-project"); } catch { /* reported below */ }
  if (!validUrl) invalid.push("NEXT_PUBLIC_SUPABASE_URL");
  const badAnon = !anonKey || anonKey.includes("your-anon") || anonKey.startsWith("sb_secret_") || jwtRole(anonKey) === "service_role" || Boolean(serviceRoleKey && anonKey === serviceRoleKey);
  if ((options.publicOnly || options.requireAnon || anonKey) && badAnon) invalid.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!options.publicOnly && (!serviceRoleKey || serviceRoleKey.includes("your-service") || serviceRoleKey.startsWith("sb_publishable_") || jwtRole(serviceRoleKey) === "anon")) invalid.push("SUPABASE_SERVICE_ROLE_KEY");
  if (invalid.length) throw new SupabaseConfigurationError(invalid);
  return { url, anonKey, serviceRoleKey };
}
/** Call only inside a request handler. Clients/tokens are never cached globally. */
export function createRuntimeClients(env: RuntimeEnv, requireAnon = false) {
  const config = readSupabaseConfig(env, { requireAnon });
  const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
  const client = createClient(config.url, config.serviceRoleKey, options);
  const anonClient = config.anonKey ? createClient(config.url, config.anonKey, options) : client;
  return { client, anonClient };
}
export function runtimeConfigurationResponse(error: unknown) {
  return NextResponse.json({
    error: error instanceof SupabaseConfigurationError ? error.message : "Cloudflare request bindings are unavailable.",
    code: "SUPABASE_CONFIGURATION_ERROR",
    ...(error instanceof SupabaseConfigurationError ? { bindings: error.invalidBindings } : {}),
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
