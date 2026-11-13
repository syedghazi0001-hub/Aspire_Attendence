/* eslint-disable @typescript-eslint/no-explicit-any */
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
 * Retrieves `getCloudflareContext().env` on Cloudflare Workers
 * and falls back to `process.env` during local development/build.
 */
export function resolveRuntimeEnv(routeContext?: any): RuntimeEnv {
  let cfEnv: RuntimeEnv = {};
  try {
    const { env } = getCloudflareContext();
    if (env) {
      cfEnv = env as unknown as RuntimeEnv;
    }
  } catch {
    // Fallback when called outside an active Cloudflare Worker request context
  }

  const passedEnv: RuntimeEnv = routeContext?.env || {};

  return {
    NEXT_PUBLIC_SUPABASE_URL:
      (cfEnv.NEXT_PUBLIC_SUPABASE_URL as string) ||
      (cfEnv.SUPABASE_URL as string) ||
      (passedEnv.NEXT_PUBLIC_SUPABASE_URL as string) ||
      (passedEnv.SUPABASE_URL as string) ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      (cfEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) ||
      (cfEnv.SUPABASE_ANON_KEY as string) ||
      (passedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) ||
      (passedEnv.SUPABASE_ANON_KEY as string) ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "",
    SUPABASE_SERVICE_ROLE_KEY:
      (cfEnv.SUPABASE_SERVICE_ROLE_KEY as string) ||
      (passedEnv.SUPABASE_SERVICE_ROLE_KEY as string) ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  };
}

/**
 * Creates a fresh Supabase Admin client per request using `getCloudflareContext().env`.
 */
export function getSupabaseAdmin(req?: NextRequest, routeContext?: any) {
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

  // New Supabase Admin client created per request
  const client = createClient(supabaseUrl, activeKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(!hasValidServiceRole && authHeader
      ? { global: { headers: { Authorization: authHeader } } }
      : {}),
  });

  // New Supabase Anon client created per request
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
