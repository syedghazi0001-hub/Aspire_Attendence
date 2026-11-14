"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let clientPromise: Promise<SupabaseClient> | undefined;
/** Browser-only singleton, initialized from safe runtime configuration, not build-time env. */
export function getBrowserSupabase(): Promise<SupabaseClient> {
  if (typeof window === "undefined") return Promise.reject(new Error("Browser auth is not available during server rendering."));
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch("/api/public-config", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.url || !data.anonKey) throw new Error(data.error || "Supabase public runtime configuration is unavailable.");
      return createClient(data.url, data.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "lab-attendance-persistent-auth" },
      });
    })().catch(error => { clientPromise = undefined; throw error; });
  }
  return clientPromise;
}
