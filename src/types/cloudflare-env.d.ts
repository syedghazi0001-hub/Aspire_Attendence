import type { RuntimeEnv } from "../lib/supabaseRuntime";
declare global {
  /** Supabase bindings are supplied by the deployed Worker, not the browser build. */
  interface CloudflareEnv extends RuntimeEnv {}
}
export {};
