import { APP_RELEASE } from "./release";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/** Only Worker bindings supplied by a request handler. No build-time fallback. */
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
  if ((options.publicOnly || options.requireAnon) && badAnon) invalid.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!options.publicOnly && (!serviceRoleKey || serviceRoleKey.includes("your-service") || serviceRoleKey.startsWith("sb_publishable_") || jwtRole(serviceRoleKey) === "anon")) invalid.push("SUPABASE_SERVICE_ROLE_KEY");
  if (invalid.length) throw new SupabaseConfigurationError(invalid);
  return { url, anonKey, serviceRoleKey };
}
/** Types only: routes own their per-request client creation. */
export interface RequestSupabaseClients { client: SupabaseClient; anonClient: SupabaseClient }
export function runtimeConfigurationResponse(error: unknown) {
  return NextResponse.json({
    error: error instanceof SupabaseConfigurationError ? error.message : "Cloudflare request bindings are unavailable.",
    code: "SUPABASE_CONFIGURATION_ERROR",
    release: APP_RELEASE,
    ...(error instanceof SupabaseConfigurationError ? { bindings: error.invalidBindings } : {}),
  }, { status: 503, headers: { "Cache-Control": "no-store", "X-Aspire-Release": APP_RELEASE } });
}
