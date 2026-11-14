"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getAveragedGps } from "@/lib/accurateGps";
import QrScannerModal from "@/components/QrScannerModal";
import ThemeToggle from "@/components/ThemeToggle";
import { getBrowserSupabase } from "@/lib/supabaseClient";
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
  CalendarPlus,
  Send,
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

function getTodayIsoDate(): string {
  const now = new Date();
  const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return pkt.toISOString().slice(0, 10);
}

export default function EmployeePortalPage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [deviceSummary, setDeviceSummary] = useState<string>("Web Browser");
  const [approvalStatus, setApprovalStatus] = useState<
    | "pending_login"
    | "approved"
    | "pending_logout"
    | "blocked_other_device"
    | "rejected"
    | "checking"
  >("checking");
  const [blockedMessage, setBlockedMessage] = useState<string>(
    "Active session detected on another device. A request has been sent to the Admin for approval. Please wait."
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

  const [activeTab, setActiveTab] = useState<"clock_in" | "clock_out" | "leave">("clock_in");
  const [leaveHistory, setLeaveHistory] = useState<any[]>([]);

  const [leaveVerified, setLeaveVerified] = useState(false);
  const gpsAbort = useRef<AbortController | null>(null);
  useEffect(() => () => gpsAbort.current?.abort(), []);
  const fullDayLeave = leaveHistory.find(l => l.date === getTodayIsoDate() && l.status === "approved" && ["paid", "unpaid"].includes(l.leave_type));

  // Leave Application State
  const [leaveType, setLeaveType] = useState<"paid" | "unpaid" | "short">(
    "paid"
  );
  const [shortHours, setShortHours] = useState("2");
  const [leaveDate, setLeaveDate] = useState<string>(getTodayIsoDate);
  const [leaveReason, setLeaveReason] = useState<string>("");
  const [submittingLeave, setSubmittingLeave] = useState<boolean>(false);
  const [leaveMessage, setLeaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const clearLocalSessionAndRedirect = useCallback(async () => {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(EMPLOYEE_PROFILE_KEY);
    // Employee custom-session cleanup must still succeed if public config is unavailable.
    await getBrowserSupabase().then(client => client.auth.signOut()).catch(() => null);
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
        if (res.status >= 500) return;

        if (data.rejected_by_admin || data.approval_status === "rejected") {
          setBlockedMessage(
            data.error ||
              "Your login request from this device was rejected by the Admin."
          );
          setApprovalStatus("rejected");
          return;
        }

        if (res.status === 403 || data.blocked_other_device) {
          setBlockedMessage(
            "Active session detected on another device. A request has been sent to the Admin for approval. Please wait."
          );
          setApprovalStatus("pending_login");
          return;
        }

        if (!res.ok || !data.valid) {
          await clearLocalSessionAndRedirect();
          return;
        }

        if (data.session_token && data.session_token !== token) {
          setSessionToken(data.session_token);
          localStorage.setItem(SESSION_TOKEN_KEY, data.session_token);
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
    }, 3500);
    return () => clearInterval(interval);
  }, [sessionToken, fingerprint, employee?.id, verifySessionStatus]);

  useEffect(() => {
    if (!employee || !sessionToken) return;
    const load = () => fetch(`/api/employee/leave?user_id=${encodeURIComponent(employee.id)}&session_token=${encodeURIComponent(sessionToken)}&fp=${encodeURIComponent(fingerprint)}`, { cache: "no-store" }).then(r => r.json()).then(d => { if (!Array.isArray(d.leaves) || d.error) throw new Error(d.error || "Leave check failed"); setLeaveHistory(d.leaves); setLeaveVerified(true); }).catch(() => setLeaveVerified(false));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [employee?.id, sessionToken, fingerprint, activeTab]);

  const cancelLeave = async (id: string) => {
    if (!employee || !sessionToken || !confirm("Cancel this approved leave? Salary preview will be recalculated.")) return;
    try {
      const response = await fetch("/api/employee/leave", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, user_id: employee.id, session_token: sessionToken, device_fingerprint: fingerprint }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Cancellation failed.");
      setLeaveHistory(history => history.map(l => l.id === id ? { ...l, status: "cancelled" } : l));
      setLeaveMessage({ type: "success", text: data.message });
    } catch(error) { setLeaveMessage({ type: "error", text: error instanceof Error ? error.message : "Cancellation failed." }); }
  };

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
        title: "Logout Request Sent",
        message:
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

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setLeaveMessage(null);

    if (!leaveDate) {
      setLeaveMessage({
        type: "error",
        text: "Please select a Date for your leave.",
      });
      return;
    }

    setSubmittingLeave(true);
    try {
      const res = await fetch("/api/employee/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: sessionToken,
          device_fingerprint: fingerprint,
          user_id: employee.id,
          leave_type: leaveType,
          date: leaveDate,
          reason: leaveReason.trim(),
          hours_missed: leaveType === "short" ? Number(shortHours) : 0,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setLeaveMessage({
          type: "error",
          text: data.error || "Could not submit leave application.",
        });
        return;
      }

      setLeaveReason("");
      setLeaveMessage({
        type: "success",
        text: "Leave application submitted to Admin.",
      });
    } catch {
      setLeaveMessage({
        type: "error",
        text: "Network error while submitting leave application.",
      });
    } finally {
      setSubmittingLeave(false);
    }
  };

  const handleQrDecoded = useCallback(
    async (decodedQrText: string) => {
      setScannerOpen(false);
      if (!sessionToken || !employee || !leaveVerified || fullDayLeave) return;

      setProcessingScan(true);
      setFeedback(null);

      if (!navigator.geolocation) {
        setProcessingScan(false);
        setFeedback({
          type: "error",
          title: "GPS Not Supported",
          message: "Your browser does not support GPS Geolocation.",
        });
        return;
      }

      gpsAbort.current?.abort();
      gpsAbort.current = new AbortController();
      try {
        const position = await getAveragedGps(message => setFeedback({ type: "error", title: "GPS Verification", message }), gpsAbort.current.signal);
            const response = await fetch("/api/employee/attendance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                session_token: sessionToken,
                device_id: fingerprint,
                device_fingerprint: fingerprint,
                intent: activeTab === "clock_out" ? "clock_out" : "clock_in",
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
                "Active session detected on another device. A request has been sent to the Admin for approval. Please wait."
              );
              setApprovalStatus("pending_login");
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
                  ? "Clock-In Recorded"
                  : "Clock-Out Recorded",
              message: result.message,
            });
      } catch(error) {
        setFeedback({ type: "error", title: "Verification Failed", message: error instanceof Error ? error.message : "Could not record attendance." });
      } finally { setProcessingScan(false); }

    },
    [activeTab, sessionToken, employee, fingerprint, clearLocalSessionAndRedirect, leaveVerified, fullDayLeave]
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
          <span>Loading your workspace...</span>
        </motion.div>
      </div>
    );
  }

  const clockInVal = todayRecord?.clock_in || todayRecord?.login_time || null;
  const clockOutVal =
    todayRecord?.clock_out || todayRecord?.logout_time || null;

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

      {/* Top 3D Frosted Glass Navbar (Clean Employee Name, no technical IDs) */}
      <header className="relative z-10 w-full glass-panel px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="p-1.5 rounded-2xl glass-card-3d shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-placeholder.svg"
                alt="Company Logo"
                className="w-9 h-9 rounded-xl object-contain"
              />
            </div>
            <div>
              <h1 className="text-base font-medium text-slate-800 dark:text-white leading-tight">
                {employee.full_name}
              </h1>
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                {employee.duty_start_time && employee.duty_end_time
                  ? `Shift: ${formatTime24to12(
                      employee.duty_start_time
                    )} – ${formatTime24to12(employee.duty_end_time)}`
                  : "Employee Portal"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            {(approvalStatus === "approved" ||
              approvalStatus === "pending_logout") && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleRequestLogout}
                disabled={
                  requestingLogout || approvalStatus === "pending_logout"
                }
                className={`rounded-xl px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5 ${
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

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-3xl"
        >
          {/* Second Device Login Pending Approval */}
          {(approvalStatus === "pending_login" ||
            approvalStatus === "blocked_other_device") && (
            <div className="max-w-md mx-auto glass-panel rounded-3xl p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl btn-3d-amber flex items-center justify-center mx-auto">
                <Hourglass className="w-8 h-8 animate-pulse" />
              </div>
              <h2 className="text-xl font-medium text-slate-800 dark:text-white">
                Approval Pending
              </h2>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 leading-relaxed">
                Active session detected on another device. A request has been
                sent to the Admin for approval. Please wait.
              </p>
              <div className="rounded-2xl glass-card-3d px-4 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2">
                <Smartphone className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>New Device: {deviceSummary}</span>
              </div>
            </div>
          )}

          {/* Rejected by Admin */}
          {approvalStatus === "rejected" && (
            <div className="max-w-md mx-auto glass-panel rounded-3xl p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl btn-3d-rose flex items-center justify-center mx-auto">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-medium text-rose-700 dark:text-rose-300">
                Login Request Declined
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                {blockedMessage}
              </p>
              <button
                onClick={clearLocalSessionAndRedirect}
                className="rounded-2xl btn-3d-glass px-5 py-2.5 text-xs font-medium"
              >
                Back to Sign In
              </button>
            </div>
          )}

          {/* Active Approved Employee Dashboard */}
          {(approvalStatus === "approved" ||
            approvalStatus === "pending_logout") && (
            <div className="space-y-5">
              {fullDayLeave && <div role="alert" className="glass-panel rounded-2xl p-4 text-sm">Approved {fullDayLeave.leave_type} leave today. Check-In and Check-Out are disabled. <button className="btn-3d-glass rounded-xl px-4 py-2 ml-2" onClick={() => cancelLeave(fullDayLeave.id)}>Cancel Leave</button></div>}
              {!leaveVerified && <p role="status">Checking leave status… Attendance stays disabled until verified.</p>}
              <nav className="glass-panel rounded-3xl p-3 flex flex-wrap gap-3" aria-label="Employee actions">
                {([['clock_in', 'Check-In'], ['clock_out', 'Check-Out'], ['leave', 'Apply for Leave']] as const).map(([tab, label]) => <button key={tab} onClick={() => setActiveTab(tab)} disabled={tab !== "leave" && (!leaveVerified || Boolean(fullDayLeave))} aria-pressed={activeTab === tab} className={`rounded-2xl px-5 py-3 text-sm ${activeTab === tab ? 'btn-3d-primary' : 'btn-3d-glass'}`}>{label}</button>)}
              </nav>
              {/* Left Card: Attendance & QR Scanner */}
              <div className={`glass-panel rounded-3xl p-6 sm:p-7 flex flex-col justify-between space-y-5 ${activeTab === "leave" ? "hidden" : ""}`}>
                <div className="space-y-5">
                  {approvalStatus === "pending_logout" && (
                    <div className="glass-card-3d rounded-2xl p-4 flex items-start gap-3">
                      <Hourglass className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5 animate-pulse" />
                      <div className="text-xs">
                        <h3 className="font-medium text-slate-800 dark:text-white">
                          Logout Request Pending
                        </h3>
                        <p className="font-medium text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                          The Admin has been notified of your logout request.
                          Your session stays active until approved.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between rounded-2xl glass-card-3d px-4 py-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                      <Smartphone className="w-4 h-4" />
                      Active Device Verified
                    </span>
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      {deviceSummary}
                    </span>
                  </div>

                  <div className="glass-card-3d rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        Today&apos;s Attendance
                      </span>
                      <span
                        className={`text-xs font-medium px-3 py-1 rounded-full ${
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
                          Clock In
                        </span>
                        <span className="text-sm font-medium text-slate-800 dark:text-white mt-0.5 block">
                          {formatPktTime12h(clockInVal)}
                        </span>
                      </div>
                      <div className="rounded-2xl glass-input p-3.5">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                          Clock Out
                        </span>
                        <span className="text-sm font-medium text-slate-800 dark:text-white mt-0.5 block">
                          {formatPktTime12h(clockOutVal)}
                        </span>
                      </div>
                    </div>

                    {(Number(todayRecord?.overtime_hours || 0) > 0 ||
                      Number(todayRecord?.missed_hours || 0) > 0) && (
                      <div className="mt-3.5 pt-3 border-t border-white/40 dark:border-slate-700/60 space-y-1 text-center text-xs font-medium">
                        {Number(todayRecord?.overtime_hours || 0) > 0 && (
                          <div className="text-indigo-700 dark:text-indigo-300">
                            Overtime Recorded:{" "}
                            {Number(todayRecord?.overtime_hours).toFixed(2)} hrs
                          </div>
                        )}
                        {Number(todayRecord?.missed_hours || 0) > 0 && (
                          <div className="text-amber-700 dark:text-amber-300">
                            Short Leave:{" "}
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
                          <h3 className="font-medium">{feedback.title}</h3>
                          <p className="mt-0.5 font-medium leading-relaxed">
                            {feedback.message}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Primary 3D Scan QR Action Button */}
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setFeedback(null);
                    setScannerOpen(true);
                  }}
                  disabled={!leaveVerified || Boolean(fullDayLeave) || processingScan || Boolean(clockOutVal) || (activeTab === "clock_in" ? Boolean(clockInVal) : !clockInVal)}
                  className="w-full rounded-2xl btn-3d-primary disabled:opacity-50 py-4 px-6 text-sm sm:text-base font-medium flex items-center justify-center gap-3"
                >
                  {processingScan ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Verifying Location &amp; Time...</span>
                    </>
                  ) : clockOutVal ? (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Today&apos;s Attendance Completed</span>
                    </>
                  ) : (
                    <>
                      <QrCode className="w-5 h-5" />
                      <span>
                        {activeTab === "clock_out" ? "Scan QR to Check-Out" : "Scan QR to Check-In"}
                      </span>
                    </>
                  )}
                </motion.button>
              </div>

              {/* Right Card: Apply for Leave Form */}
              <div className={`glass-panel rounded-3xl p-6 sm:p-7 flex flex-col justify-between ${activeTab !== "leave" ? "hidden" : ""}`}>
                <div>
                  <div className="flex items-center gap-2.5 mb-5">
                    <div className="p-2.5 rounded-2xl btn-3d-primary">
                      <CalendarPlus className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-medium text-slate-800 dark:text-white">
                        Apply for Leave
                      </h2>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Submit a leave request directly to the Admin
                      </p>
                    </div>
                  </div>

                  <AnimatePresence mode="wait">
                    {leaveMessage && (
                      <motion.div
                        key={leaveMessage.text}
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        role="alert"
                        className={`mb-4 rounded-2xl p-3.5 text-xs font-medium flex items-center gap-2.5 ${
                          leaveMessage.type === "success"
                            ? "bg-emerald-500/15 border border-emerald-400/40 text-emerald-900 dark:text-emerald-200"
                            : "bg-rose-500/15 border border-rose-400/40 text-rose-900 dark:text-rose-200"
                        }`}
                      >
                        {leaveMessage.type === "success" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                        )}
                        <span>{leaveMessage.text}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <form onSubmit={handleApplyLeave} className="space-y-4">
                    {leaveType === "short" && <label className="block text-sm">Hours missed<input required min="0.01" max="24" step="0.01" type="number" value={shortHours} onChange={e => setShortHours(e.target.value)} className="glass-input w-full rounded-2xl p-3 mt-2" /></label>}
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                        Leave Type
                      </label>
                      <select
                        value={leaveType}
                        onChange={(e) =>
                          setLeaveType(
                            e.target.value as "paid" | "unpaid" | "short"
                          )
                        }
                        className="w-full rounded-2xl glass-input px-4 py-3 text-sm font-semibold focus:outline-none"
                      >
                        <option value="paid">Paid Leave</option>
                        <option value="unpaid">Unpaid Leave</option>
                        <option value="short">Short Leave</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                        Date
                      </label>
                      <input
                        type="date"
                        required
                        value={leaveDate}
                        onChange={(e) => setLeaveDate(e.target.value)}
                        className="w-full rounded-2xl glass-input px-4 py-3 text-sm font-semibold focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                        Reason (Optional)
                      </label>
                      <textarea
                        rows={3}
                        value={leaveReason}
                        onChange={(e) => setLeaveReason(e.target.value)}
                        placeholder="Briefly describe the reason for your leave..."
                        className="w-full rounded-2xl glass-input px-4 py-3 text-sm font-medium focus:outline-none resize-none"
                      />
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={submittingLeave}
                      className="w-full rounded-2xl btn-3d-emerald py-3.5 px-5 text-sm font-medium flex items-center justify-center gap-2"
                    >
                      {submittingLeave ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Submitting...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>Submit Leave Application</span>
                        </>
                      )}
                    </motion.button>
                  </form>
                  <section className="mt-6 space-y-3"><h3 className="text-base font-medium">Your Leave History</h3>{leaveHistory.length === 0 ? <p className="text-sm text-slate-500">No applications yet.</p> : leaveHistory.map(l => <div key={l.id} className="glass-card-3d rounded-2xl p-4 text-sm flex flex-wrap justify-between gap-2"><span>{l.date} · {l.leave_category || l.leave_type}</span><span className="capitalize">{l.status} · {l.is_paid ? 'Paid' : l.leave_type === 'short' ? 'Short / hourly' : 'Unpaid'}</span>{l.status === 'approved' && l.date >= getTodayIsoDate() && <button type="button" className="btn-3d-glass rounded-xl px-3 py-1" onClick={() => cancelLeave(l.id)}>Cancel Leave</button>}</div>)}</section>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </main>

      <footer className="relative z-10 w-full py-4 text-center text-xs font-medium text-slate-600 dark:text-slate-400">
        PulseHR Cloud &bull; Employee Self-Service &amp; Attendance
      </footer>

      <QrScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={handleQrDecoded}
      />
    </div>
  );
}
