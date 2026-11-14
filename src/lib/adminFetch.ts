import { getBrowserSupabase } from "./supabaseClient";
/** Browser runtime config + persisted Admin bearer token; no service secret in browser. */
export async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const supabase = await getBrowserSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Unable to load Admin session. Sign in again.");
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Admin session missing. Sign in again.");
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...options, cache: "no-store", headers });
}
