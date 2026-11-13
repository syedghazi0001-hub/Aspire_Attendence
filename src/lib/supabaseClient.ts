import { createClient, SupabaseClient } from "@supabase/supabase-js";

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const rawAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(
  rawUrl &&
    rawAnonKey &&
    !rawUrl.includes("your-project-id.supabase.co") &&
    !rawAnonKey.includes("your-anon-public-key-here")
);

// Use safe fallback values only so build/prerender doesn't crash before .env.local is added
const safeUrl = isSupabaseConfigured
  ? rawUrl
  : "https://placeholder-project.supabase.co";
const safeAnonKey = isSupabaseConfigured
  ? rawAnonKey
  : "placeholder-anon-key";

export const supabase: SupabaseClient = createClient(safeUrl, safeAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "lab-attendance-persistent-auth",
  },
});
