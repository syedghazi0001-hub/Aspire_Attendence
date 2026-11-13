"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import QrScannerModal from "@/components/QrScannerModal";
import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/lib/supabaseClient";
import { generateDeviceFingerprint } from "@/lib/fingerprint";
import { formatPktTime12h, formatTime24to12 } from "@/lib/pktTime";
import {
  QrCode,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  ShieldAlert,
  Hourglass,
  Smartphone,
} from "lucide-react";

const SESSION_TOKEN_KEY = "lab_employee_session_token";
const EMPLOYEE_PROFILE_KEY = "lab_employee_profile";
const EMPLOYEE_FP_KEY = "lab_employee_fingerprint";

interface EmployeeProfile {
  id: string;
  employee_id: string;
  full_name: string;
  role: string;
  device_id?: string | null;
  duty_start_time?: string;
  duty_end_time?: string;
}

interface AttendanceRecord {
  id: string;
  date: string;
  clock_in?: string | null;
  clock_out?: string | null;
  login_time: string | null;
  logout_time: string | null;
  status: string;
  overtime_hours?: number;
  missed_hours?: number;
}

export default function EmployeePortalPage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [deviceSummary, setDeviceSummary] = useState<string>("Browser Session");
  const [approvalStatus, setApprovalStatus] = useState<
    | "pending_login"
    | "approved"
    | "pending_logout"
    | "blocked_other_device"
    | "checking"
  >("checking");
  const [blockedMessage, setBlockedMessage] = useState<string>(
    "Already logged in on another device. Please contact Admin."
  );

  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [processingScan, setProcessingScan] = useState<boolean>(false);
  const [requestingLogout, setRequestingLogout] = useState<boolean>(false);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const clearLocalSessionAndRedirect = useCallback(async () => {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(EMPLOYEE_PROFILE_KEY);
    await supabase.auth.signOut().catch(() => null);
    router.replace("/");
  }, [router]);

  const verifySessionStatus = useCallback(
    async (token: string, fp: string, empId?: string) => {
      try {
        const res = await fetch(
          `/api/employee/session?token=${encodeURIComponent(
            token
          )}&fp=${encodeURIComponent(fp)}&user_id=${encodeURIComponent(
            empId || ""
          )}`
        );
        const data = await res.json();

        if (res.status === 403 || data.blocked_other_device) {
          setBlockedMessage(
            data.error ||
              "Already logged in on another device. Please contact Admin."
          );
          setApprovalStatus("blocked_other_device");
          return;
        }

        if (!res.ok || !data.valid) {
          await clearLocalSessionAndRedirect();
          return;
        }

        if (data.employee) {
          setEmployee(data.employee);
          localStorage.setItem(
            EMPLOYEE_PROFILE_KEY,
            JSON.stringify(data.employee)
          );
        }

        setApprovalStatus(data.approval_status || "approved");
        if (data.today_attendance !== undefined) {
          setTodayRecord(data.today_attendance || null);
        }
      } catch {
        // Ignore transient network errors
      }
    },
    [clearLocalSessionAndRedirect]
  );

  useEffect(() => {
    const init = async () => {
      const savedToken = localStorage.getItem(SESSION_TOKEN_KEY);
      const savedProfile = localStorage.getItem(EMPLOYEE_PROFILE_KEY);

      if (!savedToken || !savedProfile) {
        router.replace("/");
        return;
      }

      let parsedEmp: EmployeeProfile | null = null;
      try {
        parsedEmp = JSON.parse(savedProfile);
        setEmployee(parsedEmp);
      } catch {
        router.replace("/");
        return;
      }

      setSessionToken(savedToken);
      const { fingerprint: fp, deviceSummary: summary } =
        await generateDeviceFingerprint();
      localStorage.setItem(EMPLOYEE_FP_KEY, fp);
      setFingerprint(fp);
      setDeviceSummary(summary);

      await verifySessionStatus(savedToken, fp, parsedEmp?.id);
    };

    init();
  }, [router, verifySessionStatus]);

  useEffect(() => {
    if (!sessionToken || !fingerprint) return;
    const interval = setInterval(() => {
      verifySessionStatus(sessionToken, fingerprint, employee?.id);
    }, 4000);
    return () => clearInterval(interval);
  }, [sessionToken, fingerprint, employee?.id, verifySessionStatus]);

  const handleRequestLogout = async () => {
    if (!sessionToken || !employee) return;
    setRequestingLogout(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/employee/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: sessionToken,
          user_id: employee.id,
          device_id: fingerprint,
          device_fingerprint: fingerprint,
          device_info: deviceSummary,
          action: "request_logout",
        }),
      });
      const data = await res.json();

      if (res.status === 403 || data.blocked_other_device) {
        setBlockedMessage(
          data.error ||
            "Already logged in on another device. Please contact Admin."
        );
        setApprovalStatus("blocked_other_device");
        return;
      }

      if (!res.ok) {
        setFeedback({
          type: "error",
          title: "Logout Request Failed",
          message: data.error || "Unable to submit logout request.",
        });
        return;
      }

      setApprovalStatus("pending_logout");
      setFeedback({
        type: "success",
        title: "Logout Request Sent to Admin",
        message:
          data.message ||
          "Your logout request has been sent to the Admin. You remain logged in until the Admin approves it.",
      });
    } catch {
      setFeedback({
        type: "error",
        title: "Network Error",
        message: "Failed to contact server.",
      });
    } finally {
      setRequestingLogout(false);
    }
  };

  const handleQrDecoded = useCallback(
    async (decodedQrText: string) => {
      setScannerOpen(false);
      if (!sessionToken || !employee) return;

      setProcessingScan(true);
      setFeedback(null);

      if (!navigator.geolocation) {
        setProcessingScan(false);
        setFeedback({
          type: "error",
          title: "GPS Not Supported",
          message: "Your browser does not support HTML5 GPS Geolocation.",
        });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const response = await fetch("/api/employee/attendance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                session_token: sessionToken,
                device_id: fingerprint,
                device_fingerprint: fingerprint,
                qr_data: decodedQrText,
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              }),
            });

            const result = await response.json();

            if (response.status === 401) {
              await clearLocalSessionAndRedirect();
              return;
            }

            if (response.status === 403 && result.revoked) {
              setBlockedMessage(
                result.error ||
                  "Already logged in on another device. Please contact Admin."
              );
              setApprovalStatus("blocked_other_device");
              return;
            }

            if (!response.ok) {
              setFeedback({
                type: "error",
                title: "Attendance Rejected",
                message: result.error || "Could not record attendance.",
              });
              return;
            }

            setTodayRecord(result.record || null);
            setFeedback({
              type: "success",
              title:
                result.action === "clock_in"
                  ? "Clock-In Recorded (PKT)"
                  : "Clock-Out Recorded (PKT)",
              message: result.message,
            });
          } catch {
            setFeedback({
              type: "error",
              title: "Network Error",
              message: "Could not reach attendance server. Please try again.",
            });
          } finally {
            setProcessingScan(false);
          }
        },
        (geoErr) => {
          setProcessingScan(false);
          let reason =
            "Location permission is required to verify you are at the workplace.";
          if (geoErr.code === geoErr.PERMISSION_DENIED) {
            reason =
              "GPS Location Permission Denied. Please enable Location access in your browser settings.";
          } else if (geoErr.code === geoErr.TIMEOUT) {
            reason =
              "GPS signal timed out. Please step near a window and try scanning again.";
          }
          setFeedback({
            type: "error",
            title: "GPS Verification Failed",
            message: reason,
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        }
      );
    },
    [sessionToken, employee, fingerprint, clearLocalSessionAndRedirect]
  );

  if (approvalStatus === "checking" || !employee) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel rounded-3xl px-8 py-6 flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200"
        >
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span>Validating device lock...</span>
        </motion.div>
      </div>
    );
  }

  const clockInVal = todayRecord?.clock_in || todayRecord?.login_time || null;
  const clockOutVal = todayRecord?.clock_out || todayRecord?.logout_time || null;

  return (
    <div className="relative min-h-screen flex flex-col justify-between overflow-hidden">
      {/* Ambient 3D Keynote Orbs */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="animate-orb-slow absolute -top-24 left-1/4 w-96 h-96 rounded-full bg-indigo-500/20 dark:bg-indigo-500/15 blur-3xl" />
        <div className="animate-orb-reverse absolute bottom-10 right-1/4 w-[26rem] h-[26rem] rounded-full bg-sky-400/20 dark:bg-sky-500/15 blur-3xl" />
      </div>

      {/* Top 3D Frosted Glass Navbar */}
      <header className="relative z-10 w-full glass-panel px-4 sm:px-6 py-4">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-2xl glass-card-3d shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-placeholder.svg"
                alt="Company Logo"
                className="w-9 h-9 rounded-xl object-contain"
              />
            </div>
            <div>
              <h1 className="text-sm font-extrabold text-slate-800 dark:text-white leading-tight">
                {employee.full_name}
              </h1>
              <p className="text-xs font-mono font-bold text-indigo-700 dark:text-indigo-300">
                ID: {employee.employee_id}
                {employee.duty_start_time && employee.duty_end_time
                  ? ` • Shift: ${formatTime24to12(
                      employee.duty_start_time
                    )} - ${formatTime24to12(employee.duty_end_time)}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            {/* Strict Logout: NO direct Logout button. Only "Request Logout" */}
            {(approvalStatus === "approved" ||
              approvalStatus === "pending_logout") && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleRequestLogout}
                disabled={
                  requestingLogout || approvalStatus === "pending_logout"
                }
                className={`rounded-xl px-3.5 py-2 text-xs font-extrabold inline-flex items-center gap-1.5 ${
                  approvalStatus === "pending_logout"
                    ? "btn-3d-glass opacity-75 cursor-not-allowed"
                    : "btn-3d-amber"
                }`}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>
                  {requestingLogout
                    ? "Sending..."
                    : approvalStatus === "pending_logout"
                    ? "Logout Requested"
                    : "Request Logout"}
                </span>
              </motion.button>
            )}
          </div>
        </div>
      </header>

      {/* Center Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md space-y-5"
        >
          {/* Blocked on a Different Browser or Device */}
          {approvalStatus === "blocked_other_device" && (
            <div className="glass-panel rounded-3xl p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl btn-3d-rose flex items-center justify-center mx-auto">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-extrabold text-rose-700 dark:text-rose-300">
                {blockedMessage}
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                Your employee account is strictly locked to another active
                device/browser fingerprint. You cannot access the dashboard
                until the Admin approves your login or clears the existing
                session.
              </p>
            </div>
          )}

          {/* Pending Login Request -> "Waiting for Admin Approval" */}
          {approvalStatus === "pending_login" && (
            <div className="glass-panel rounded-3xl p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl btn-3d-amber flex items-center justify-center mx-auto">
                <Hourglass className="w-8 h-8 animate-pulse" />
              </div>
              <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">
                Waiting for Admin Approval
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                A Pending Login Request for this device fingerprint has been
                recorded in <code className="font-mono">active_sessions</code>.
                Once the Admin approves your request, your dashboard will unlock
                automatically.
              </p>
              <div className="rounded-2xl glass-input px-3.5 py-2.5 text-[11px] font-mono font-bold">
                Fingerprint:{" "}
                {fingerprint ? `${fingerprint.slice(0, 20)}...` : "Verifying"}
              </div>
            </div>
          )}

          {/* Approved Active Session */}
          {(approvalStatus === "approved" ||
            approvalStatus === "pending_logout") && (
            <div className="glass-panel rounded-3xl p-6 sm:p-8 space-y-6">
              {approvalStatus === "pending_logout" && (
                <div className="glass-card-3d rounded-2xl p-4 flex items-start gap-3">
                  <Hourglass className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5 animate-pulse" />
                  <div className="text-xs">
                    <h3 className="font-extrabold text-slate-800 dark:text-white">
                      Logout Request Pending Admin Approval
                    </h3>
                    <p className="font-medium text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                      The Admin has been notified of your logout request. Until
                      the Admin approves it, your session remains locked to this
                      device.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between rounded-2xl glass-card-3d px-4 py-2.5 text-xs">
                <span className="inline-flex items-center gap-1.5 font-extrabold text-emerald-700 dark:text-emerald-300">
                  <Smartphone className="w-4 h-4" />
                  Device Locked &amp; Verified
                </span>
                <span className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  {fingerprint ? `${fingerprint.slice(0, 12)}...` : "Locked"}
                </span>
              </div>

              <div className="glass-card-3d rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    Today&apos;s Status (PKT)
                  </span>
                  <span
                    className={`text-xs font-bold px-3 py-0.5 rounded-full ${
                      clockOutVal
                        ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200"
                        : clockInVal
                        ? "bg-indigo-500/20 text-indigo-800 dark:text-indigo-200"
                        : "bg-slate-500/20 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {clockOutVal
                      ? "Shift Completed"
                      : clockInVal
                      ? "Clocked In"
                      : "Not Clocked In"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-2xl glass-input p-3.5">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                      Clock In (PKT)
                    </span>
                    <span className="text-sm font-mono font-extrabold text-slate-800 dark:text-white mt-0.5 block">
                      {formatPktTime12h(clockInVal)}
                    </span>
                  </div>
                  <div className="rounded-2xl glass-input p-3.5">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                      Clock Out (PKT)
                    </span>
                    <span className="text-sm font-mono font-extrabold text-slate-800 dark:text-white mt-0.5 block">
                      {formatPktTime12h(clockOutVal)}
                    </span>
                  </div>
                </div>

                {(Number(todayRecord?.overtime_hours || 0) > 0 ||
                  Number(todayRecord?.missed_hours || 0) > 0) && (
                  <div className="mt-3.5 pt-3 border-t border-white/40 dark:border-slate-700/60 space-y-1 text-center text-xs font-bold">
                    {Number(todayRecord?.overtime_hours || 0) > 0 && (
                      <div className="text-indigo-700 dark:text-indigo-300">
                        Overtime Recorded:{" "}
                        {Number(todayRecord?.overtime_hours).toFixed(2)} hrs
                      </div>
                    )}
                    {Number(todayRecord?.missed_hours || 0) > 0 && (
                      <div className="text-amber-700 dark:text-amber-300">
                        Short Leave (Early Exit):{" "}
                        {Number(todayRecord?.missed_hours).toFixed(2)} hrs
                      </div>
                    )}
                  </div>
                )}
              </div>

              <AnimatePresence mode="wait">
                {feedback && (
                  <motion.div
                    key={feedback.title}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    role="alert"
                    className={`glass-card-3d rounded-2xl p-4 flex items-start gap-3 ${
                      feedback.type === "success"
                        ? "border-emerald-400/50 text-emerald-950 dark:text-emerald-200"
                        : "border-rose-400/50 text-rose-950 dark:text-rose-200"
                    }`}
                  >
                    {feedback.type === "success" ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="text-xs">
                      <h3 className="font-extrabold">{feedback.title}</h3>
                      <p className="mt-0.5 font-medium leading-relaxed">
                        {feedback.message}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Primary 3D Scan QR Action Button */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setFeedback(null);
                  setScannerOpen(true);
                }}
                disabled={processingScan || Boolean(clockOutVal)}
                className="w-full rounded-2xl btn-3d-primary disabled:opacity-50 py-5 px-6 text-base font-extrabold flex items-center justify-center gap-3"
              >
                {processingScan ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>Verifying GPS &amp; PKT Time...</span>
                  </>
                ) : clockOutVal ? (
                  <>
                    <CheckCircle2 className="w-6 h-6" />
                    <span>Today&apos;s Attendance Completed</span>
                  </>
                ) : (
                  <>
                    <QrCode className="w-6 h-6" />
                    <span>
                      {clockInVal
                        ? "Scan QR to Clock Out"
                        : "Scan QR to Clock In"}
                    </span>
                  </>
                )}
              </motion.button>
            </div>
          )}
        </motion.div>
      </main>

      <footer className="relative z-10 w-full py-4 text-center text-xs font-medium text-slate-600 dark:text-slate-400">
        PulseHR Cloud &bull; Strict Single-Device Lock &bull; PKT (Asia/Karachi)
      </footer>

      <QrScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={handleQrDecoded}
      />
    </div>
  );
}
