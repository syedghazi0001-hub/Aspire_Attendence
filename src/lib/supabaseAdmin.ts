import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface RuntimeEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  [key: string]: unknown;
}

/**
 * Resolves environment variables on Cloudflare Workers (OpenNext `getCloudflareContext().env`
 * or route `context.env`) with seamless fallback to `process.env` for local development.
 */
export function resolveRuntimeEnv(routeContext?: { env?: RuntimeEnv }): RuntimeEnv {
  let cfEnv: RuntimeEnv = {};
  try {
    const cfContext = getCloudflareContext();
    if (cfContext?.env) {
      cfEnv = cfContext.env as unknown as RuntimeEnv;
    }
  } catch {
    // Not running inside OpenNext Cloudflare Worker request context (e.g., standard `next dev`)
  }

  const passedEnv = routeContext?.env || {};

  return {
    NEXT_PUBLIC_SUPABASE_URL:
      (passedEnv.NEXT_PUBLIC_SUPABASE_URL as string) ||
      (cfEnv.NEXT_PUBLIC_SUPABASE_URL as string) ||
      (passedEnv.SUPABASE_URL as string) ||
      (cfEnv.SUPABASE_URL as string) ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      (passedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) ||
      (cfEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) ||
      (passedEnv.SUPABASE_ANON_KEY as string) ||
      (cfEnv.SUPABASE_ANON_KEY as string) ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "",
    SUPABASE_SERVICE_ROLE_KEY:
      (passedEnv.SUPABASE_SERVICE_ROLE_KEY as string) ||
      (cfEnv.SUPABASE_SERVICE_ROLE_KEY as string) ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  };
}

export function getSupabaseAdmin(
  req?: NextRequest,
  routeContext?: { env?: RuntimeEnv }
) {
  const env = resolveRuntimeEnv(routeContext);

  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  const hasValidUrl = Boolean(
    supabaseUrl && !supabaseUrl.includes("your-project-id.supabase.co")
  );

  const hasValidServiceRole = Boolean(
    serviceRoleKey &&
      !serviceRoleKey.includes("your-service-role-secret-key-here") &&
      serviceRoleKey !== anonKey
  );

  const activeKey = hasValidServiceRole ? serviceRoleKey : anonKey;

  const isConfigured = Boolean(
    hasValidUrl &&
      activeKey &&
      !activeKey.includes("your-anon-public-key-here")
  );

  if (!isConfigured) {
    return {
      client: null,
      anonClient: null,
      isConfigured: false,
      hasServiceRole: false,
      supabaseUrl,
      anonKey,
      serviceRoleKey,
    };
  }

  const authHeader = req?.headers.get("authorization") || "";

  // Main client: uses service_role key if available; otherwise uses anonKey + Admin's Bearer token
  const client = createClient(supabaseUrl, activeKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(!hasValidServiceRole && authHeader
      ? { global: { headers: { Authorization: authHeader } } }
      : {}),
  });

  // Dedicated anon client for standard Auth signIn / signUp fallbacks
  const anonClient = createClient(supabaseUrl, anonKey || activeKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return {
    client,
    anonClient,
    isConfigured: true,
    hasServiceRole: hasValidServiceRole,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
  };
}
