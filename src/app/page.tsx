"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { generateDeviceFingerprint } from "@/lib/fingerprint";
import ThemeToggle from "@/components/ThemeToggle";
import {
  Lock,
  UserCheck,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Sparkles,
  Hourglass,
} from "lucide-react";

const SESSION_TOKEN_KEY = "lab_employee_session_token";
const EMPLOYEE_PROFILE_KEY = "lab_employee_profile";
const EMPLOYEE_FP_KEY = "lab_employee_fingerprint";

export default function UnifiedLoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [pendingApprovalMsg, setPendingApprovalMsg] = useState("");
  const [deviceSummary, setDeviceSummary] = useState("Detecting device...");

  useEffect(() => {
    generateDeviceFingerprint().then(({ fingerprint: fp, deviceSummary: ds }) => {
      setDeviceSummary(ds);
      localStorage.setItem(EMPLOYEE_FP_KEY, fp);
    });
  }, []);

  const handleUnifiedLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setPendingApprovalMsg("");

    const trimmedId = identifier.trim();
    const trimmedPassword = password.trim();

    if (!trimmedId || !trimmedPassword) {
      setErrorMsg("Please enter your ID / Email and Password.");
      return;
    }

    setLoading(true);
    try {
      const { fingerprint: currentFp, deviceSummary: currentSummary } =
        await generateDeviceFingerprint();
      localStorage.setItem(EMPLOYEE_FP_KEY, currentFp);

      // 1. If Email input, check Admin login first
      if (trimmedId.includes("@") && isSupabaseConfigured) {
        const { data: directAuth, error: directErr } =
          await supabase.auth.signInWithPassword({
            email: trimmedId.toLowerCase(),
            password: trimmedPassword,
          });

        if (!directErr && directAuth?.user) {
          const { data: userRow } = await supabase
            .from("users")
            .select("role")
            .eq("id", directAuth.user.id)
            .maybeSingle();

          if (userRow?.role === "admin") {
            router.push("/admin");
            return;
          }
        }
      }

      // 2. Call Unified Login API (/api/employee/login)
      const res = await fetch("/api/employee/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: trimmedId,
          password: trimmedPassword,
          device_id: currentFp,
          device_fingerprint: currentFp,
          device_info: currentSummary,
        }),
      });

      const data = await res.json();

      // If second-device login is detected (403 blocked_other_device with pending session_token)
      if (res.status === 403 && data.blocked_other_device) {
        if (data.session_token && data.employee) {
          localStorage.setItem(SESSION_TOKEN_KEY, data.session_token);
          localStorage.setItem(
            EMPLOYEE_PROFILE_KEY,
            JSON.stringify(data.employee)
          );
          router.push("/employee");
          return;
        }
        setPendingApprovalMsg(
          "Active session detected on another device. A request has been sent to the Admin for approval. Please wait."
        );
        return;
      }

      if (!res.ok) {
        setErrorMsg(
          data.error ||
            "Invalid credentials. Please verify your ID/Email and password."
        );
        return;
      }

      if (data.role === "admin") {
        if (isSupabaseConfigured && trimmedId.includes("@")) {
          await supabase.auth.signInWithPassword({
            email: trimmedId.toLowerCase(),
            password: trimmedPassword,
          });
        }
        router.push("/admin");
        return;
      }

      if (data.session_token && data.employee) {
        localStorage.setItem(SESSION_TOKEN_KEY, data.session_token);
        localStorage.setItem(
          EMPLOYEE_PROFILE_KEY,
          JSON.stringify(data.employee)
        );
        router.push("/employee");
        return;
      }

      setErrorMsg("Unexpected server response. Please try again.");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Network error during sign in";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between p-4 sm:p-6 overflow-hidden">
      {/* Ambient 3D Keynote Floating Light Orbs */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="animate-orb-slow absolute -top-20 left-1/4 w-96 h-96 rounded-full bg-indigo-500/20 dark:bg-indigo-500/15 blur-3xl" />
        <div className="animate-orb-reverse absolute top-1/3 right-1/4 w-[28rem] h-[28rem] rounded-full bg-sky-400/20 dark:bg-sky-500/15 blur-3xl" />
        <div className="animate-orb-slow absolute -bottom-24 left-1/3 w-96 h-96 rounded-full bg-emerald-400/15 dark:bg-emerald-500/10 blur-3xl" />
      </div>

      {/* Top Bar */}
      <header className="relative z-10 w-full max-w-5xl mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-2xl glass-card-3d">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-placeholder.svg"
              alt="Company Logo"
              className="w-9 h-9 rounded-xl object-contain"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm tracking-tight text-slate-800 dark:text-white">
                PulseHR Cloud
              </span>
              <Sparkles className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
            </div>
            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              Attendance &amp; Payroll Portal
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      {/* Main 3D Glass Login Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center py-6">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md"
        >
          <div className="glass-panel rounded-3xl p-7 sm:p-9">
            <div className="flex flex-col items-center text-center mb-7">
              <div className="relative mb-4 p-3 rounded-3xl glass-card-3d">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-placeholder.svg"
                  alt="Company Logo"
                  className="w-14 h-14 rounded-2xl object-contain"
                />
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium uppercase tracking-wider bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 border border-indigo-400/30 mb-2.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Secure Workspace Sign In
              </span>
              <h1 className="text-2xl font-medium text-slate-800 dark:text-white tracking-tight">
                Welcome Back
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
                Sign in with your Employee ID or Admin Email
              </p>
            </div>

            <AnimatePresence mode="wait">
              {pendingApprovalMsg && (
                <motion.div
                  key="pending-approval"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  role="alert"
                  className="mb-5 rounded-2xl bg-amber-500/15 border border-amber-400/40 p-4 text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-start gap-2.5"
                >
                  <Hourglass className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5 animate-pulse" />
                  <span className="leading-relaxed">{pendingApprovalMsg}</span>
                </motion.div>
              )}

              {errorMsg && (
                <motion.div
                  key="login-error"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  role="alert"
                  className="mb-5 rounded-2xl bg-rose-500/15 border border-rose-400/40 p-4 text-xs font-medium text-rose-800 dark:text-rose-200 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-300 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{errorMsg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleUnifiedLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                  Employee ID or Email
                </label>
                <div className="relative">
                  <UserCheck className="w-4 h-4 text-slate-500 dark:text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Enter your ID or Email"
                    className="w-full rounded-2xl glass-input pl-10 pr-4 py-3 text-sm font-medium focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 dark:text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-2xl glass-input pl-10 pr-4 py-3 text-sm font-medium focus:outline-none"
                  />
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl btn-3d-primary py-3.5 px-5 text-sm font-medium flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <span>Sign In</span>
                )}
              </motion.button>
            </form>

            {/* Clean Device Indicator (No technical hashes) */}
            <div className="mt-6 pt-5 border-t border-white/40 dark:border-slate-600/40 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Single-Device Protection
              </span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {deviceSummary}
              </span>
            </div>
          </div>
        </motion.div>
      </main>

      <footer className="relative z-10 text-center text-xs font-medium text-slate-600 dark:text-slate-400 py-2">
        PulseHR Cloud &bull; Secure Attendance &amp; Payroll
      </footer>
    </div>
  );
}
