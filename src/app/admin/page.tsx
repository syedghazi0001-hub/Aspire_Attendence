"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AdminShell from "@/components/AdminShell";
import Link from "next/link";
import { adminFetch } from "@/lib/adminFetch";
import { formatPktTime12h, formatTime24to12 } from "@/lib/pktTime";
import {
  Users,
  UserCheck,
  UserX,
  Smartphone,
  ShieldAlert,
  Calendar,
  RefreshCw,
  CheckCircle2,
  XCircle,
  BellRing,
  Clock,
  PlusCircle,
  X,
  CalendarOff,
  Banknote,
} from "lucide-react";

interface EmployeeRow {
  id: string;
  employee_id: string;
  full_name: string;
  duty_start_time?: string;
  duty_end_time?: string;
}

interface AttendanceRow {
  id: string;
  user_id: string;
  date: string;
  clock_in?: string | null;
  clock_out?: string | null;
  login_time: string | null;
  logout_time: string | null;
  status: string;
  overtime_hours?: number;
  missed_hours?: number;
  users?: EmployeeRow | EmployeeRow[];
}

interface SessionRequestRow {
  id: string;
  user_id: string;
  request_type: "login" | "logout";
  device_id: string;
  device_info: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  users?:
    | {
        id?: string;
        employee_id: string;
        full_name: string;
        role: string;
      }
    | {
        id?: string;
        employee_id: string;
        full_name: string;
        role: string;
      }[];
}

interface ActiveLockedUser {
  id: string;
  employee_id: string;
  full_name: string;
  role: string;
  device_info?: string;
  created_at: string;
}

interface LeaveRow {
  id: string;
  user_id: string;
  date: string;
  leave_type: "paid" | "unpaid" | "short";
  leave_category?: string;
  hours_missed: number;
  reason?: string;
  status: "pending" | "approved" | "rejected";
  employee_name?: string;
  employee_code?: string;
  users?: {
    id: string;
    employee_id: string;
    full_name: string;
  };
}

function getTodayPktDateString(): string {
  const now = new Date();
  const pktTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return pktTime.toISOString().slice(0, 10);
}

export default function AdminDashboardPage() {
  const [panel, setPanel] = useState<"attendance" | "leaves" | "devices">("attendance");
  const [selectedDate, setSelectedDate] = useState<string>(
    getTodayPktDateString
  );
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [sessionRequests, setSessionRequests] = useState<SessionRequestRow[]>(
    []
  );
  const [activeLockedUsers, setActiveLockedUsers] = useState<
    ActiveLockedUser[]
  >([]);
  const [qrSecret, setQrSecret] = useState<string>("LAB-DEFAULT-QR-SECRET-2026");
  const [loading, setLoading] = useState<boolean>(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string>("");

  // Manual Overtime Modal State
  const [otModalOpen, setOtModalOpen] = useState<boolean>(false);
  const [otUserId, setOtUserId] = useState<string>("");
  const [otDate, setOtDate] = useState<string>(getTodayPktDateString);
  const [otHours, setOtHours] = useState<string>("2");
  const [savingOt, setSavingOt] = useState<boolean>(false);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const monthPrefix = selectedDate.slice(0, 7);
      const [empRes, attRes, sessRes, setRes, leaveRes] = await Promise.all([
        adminFetch("/api/admin/employees"),
        adminFetch(
          `/api/admin/attendance?date=${encodeURIComponent(selectedDate)}`
        ),
        adminFetch("/api/admin/sessions"),
        adminFetch("/api/admin/settings"),
        adminFetch("/api/admin/leaves"),
      ]);

      const [empData, attData, sessData, setData, leaveData] =
        await Promise.all([
          empRes.json().catch(() => ({})),
          attRes.json().catch(() => ({})),
          sessRes.json().catch(() => ({})),
          setRes.json().catch(() => ({})),
          leaveRes.json().catch(() => ({})),
        ]);

      const empList = empData.employees || [];
      setEmployees(empList);
      if (!otUserId && empList.length > 0) {
        setOtUserId(empList[0].id);
      }
      setAttendance(attData.attendance || attData.records || []);
      setSessionRequests(sessData.session_requests || []);
      setActiveLockedUsers(sessData.active_locked_users || []);
      setLeaves(leaveData.leaves || []);
      if (setData?.settings?.qr_code_string) {
        setQrSecret(setData.settings.qr_code_string);
      }
    } catch {
      // Ignore transient errors
    } finally {
      setLoading(false);
    }
  }, [selectedDate, otUserId]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    const interval = setInterval(() => {
      adminFetch("/api/admin/sessions")
        .then((r) => r.json())
        .then((d) => {
          if (d.session_requests) setSessionRequests(d.session_requests);
          if (d.active_locked_users)
            setActiveLockedUsers(d.active_locked_users);
        })
        .catch(() => null);
    }, 4500);
    return () => clearInterval(interval);
  }, []);

  const handleSessionAction = async (
    payload: {
      request_id?: string;
      user_id?: string;
      device_id?: string;
      action:
        | "approve_login"
        | "reject_login"
        | "approve_logout"
        | "reject_logout"
        | "force_logout";
    },
    busyKey: string
  ) => {
    setActionId(busyKey);
    try {
      const res = await adminFetch("/api/admin/sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await fetchDashboardData();
      }
    } finally {
      setActionId(null);
    }
  };

  const handleLeaveDecision = async (
    leaveId: string,
    status: "approved" | "rejected",
    chosenType?: "paid" | "unpaid" | "short"
  ) => {
    setActionId(`leave-${leaveId}-${status}-${chosenType || ""}`);
    try {
      const res = await adminFetch("/api/admin/leaves", {
        method: "PUT",
        body: JSON.stringify({
          id: leaveId,
          status,
          ...(chosenType ? { leave_type: chosenType } : {}),
        }),
      });
      if (res.ok) {
        setBannerMsg(
          status === "approved"
            ? `Leave approved (${
                chosenType === "short" ? "Short Leave" : chosenType === "unpaid" ? "Unpaid Leave" : "Paid Leave"
              }).`
            : "Leave request rejected."
        );
        await fetchDashboardData();
      }
    } finally {
      setActionId(null);
    }
  };

  const handleSaveManualOvertime = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otUserId || !otDate) return;
    setSavingOt(true);
    setBannerMsg("");

    try {
      const res = await adminFetch("/api/admin/attendance", {
        method: "POST",
        body: JSON.stringify({
          user_id: otUserId,
          date: otDate,
          overtime_hours: parseFloat(otHours || "0") || 0,
          mode: "set",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMsg(data.message || "Manual overtime saved.");
        setOtModalOpen(false);
        await fetchDashboardData();
      } else { setBannerMsg(data.error || "Manual overtime was not saved."); }
    } catch(error) { setBannerMsg(error instanceof Error ? error.message : "Manual overtime failed."); }
    finally {
      setSavingOt(false);
    }
  };

  // Build daily attendance rows
  const attendanceMap = new Map<string, AttendanceRow>();
  attendance.forEach((row) => {
    attendanceMap.set(row.user_id, row);
  });

  const dateLeavesMap = new Map<string, LeaveRow>();
  leaves
    .filter((l) => l.date === selectedDate && l.status === "approved")
    .forEach((l) => {
      dateLeavesMap.set(l.user_id, l);
    });

  const pendingLeaves = leaves.filter((l) => l.status === "pending");

  const mergedRows = employees.map((emp) => {
    const record = attendanceMap.get(emp.id);
    const leave = dateLeavesMap.get(emp.id);
    const clockIn = record?.clock_in || record?.login_time || null;
    const clockOut = record?.clock_out || record?.logout_time || null;

    let displayStatus: "Present" | "Paid Leave" | "Unpaid Leave" | "Absent" =
      "Absent";
    if (clockIn) {
      displayStatus = "Present";
    } else if (leave?.leave_type === "paid") {
      displayStatus = "Paid Leave";
    } else if (leave?.leave_type === "unpaid") {
      displayStatus = "Unpaid Leave";
    }

    return {
      employee: emp,
      login_time: clockIn,
      logout_time: clockOut,
      status: displayStatus,
      // Strict non-negative overtime
      overtime_hours: Math.max(0, Number(record?.overtime_hours || 0)),
    };
  });

  const presentCount = mergedRows.filter(
    (r) => r.status === "Present" || r.status === "Paid Leave"
  ).length;
  const absentCount = mergedRows.filter(
    (r) => r.status === "Absent" || r.status === "Unpaid Leave"
  ).length;

  return (
    <AdminShell
      title="Admin Command Center"
      subtitle="Live attendance telemetry, leave & device approvals, manual overtime, and dynamic QR rotation"
    >
      <div className="space-y-6">
        <AnimatePresence mode="wait">
          {bannerMsg && (
            <motion.div
              key={bannerMsg}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-panel rounded-2xl border-emerald-400/40 px-4 py-3 text-xs font-medium text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{bannerMsg}</span>
              </div>
              <button
                onClick={() => setBannerMsg("")}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-panel rounded-3xl p-5 flex items-center gap-4">
            <div className="p-3.5 rounded-2xl btn-3d-primary">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Employees
              </p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-white mt-0.5">
                {employees.length}
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex items-center gap-4">
            <div className="p-3.5 rounded-2xl btn-3d-emerald">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Present / Paid Leave
              </p>
              <p className="text-2xl font-semibold text-emerald-700 dark:text-emerald-300 mt-0.5">
                {presentCount}
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex items-center gap-4">
            <div className="p-3.5 rounded-2xl btn-3d-rose">
              <UserX className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Absent Today
              </p>
              <p className="text-2xl font-semibold text-rose-600 dark:text-rose-300 mt-0.5">
                {absentCount}
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex items-center gap-4">
            <div className="p-3.5 rounded-2xl btn-3d-amber">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Pending Approvals
              </p>
              <p className="text-2xl font-semibold text-amber-600 dark:text-amber-300 mt-0.5">
                {sessionRequests.length + pendingLeaves.length}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex flex-wrap gap-3">{([['attendance','Attendance'],['leaves', 'Leave Requests'],['devices','Device Approvals']] as const).map(([key,label]) => <button key={key} aria-pressed={panel === key} className={`rounded-2xl px-5 py-3 ${panel === key ? 'btn-3d-primary' : 'btn-3d-glass'}`} onClick={() => setPanel(key)}>{label}</button>)}</nav>
        {/* PENDING EMPLOYEE LEAVE REQUESTS SECTION */}
        <div className={panel === "leaves" ? "glass-panel rounded-3xl overflow-hidden" : "hidden"}>
          <div className="px-6 py-5 border-b border-white/40 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <CalendarOff className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                  Employee Leave Requests
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Approve as Paid or Unpaid Leave, or Reject directly from the
                  dashboard
                </p>
              </div>
            </div>
            <span className="text-xs font-medium px-3.5 py-1.5 rounded-full bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 border border-indigo-400/30">
              {pendingLeaves.length} Pending Leave Request
              {pendingLeaves.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="p-6">
            {pendingLeaves.length === 0 ? (
              <div className="text-center py-4 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                No pending leave requests right now.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingLeaves.map((lv) => {
                  const matchedEmp = employees.find(
                    (e) => e.id === lv.user_id
                  );
                  const empName =
                    lv.employee_name ||
                    lv.users?.full_name ||
                    matchedEmp?.full_name ||
                    "Employee";
                  const empCode =
                    lv.employee_code ||
                    lv.users?.employee_id ||
                    matchedEmp?.employee_id ||
                    "EMP --";
                  const leaveTypeLabel =
                    lv.leave_category ||
                    (lv.leave_type === "paid"
                      ? "Paid Leave"
                      : lv.leave_type === "unpaid"
                      ? "Unpaid Leave"
                      : `Short Leave (${lv.hours_missed}h)`);

                  return (
                    <motion.div
                      key={lv.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="glass-card-3d rounded-3xl p-5 flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 border border-indigo-400/30">
                            {empCode} &bull; {empName}
                          </span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {lv.date}
                          </span>
                        </div>

                        <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white leading-snug pt-1">
                          Employee{" "}
                          <span className="text-indigo-600 dark:text-indigo-300">
                            {empName}
                          </span>{" "}
                          ({empCode}) requested{" "}
                          <span className="underline decoration-indigo-400/60">
                            {leaveTypeLabel}
                          </span>{" "}
                          for <span className="font-mono">{lv.date}</span>
                        </p>

                        {lv.reason && (
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            Reason: {lv.reason}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        {lv.leave_type === "short" && <button disabled={Boolean(actionId)} onClick={() => handleLeaveDecision(lv.id, "approved", "short")} className="btn-3d-primary rounded-2xl px-4 py-2.5 text-xs">Approve Short ({lv.hours_missed}h)</button>}
                        <button
                          onClick={() =>
                            handleLeaveDecision(lv.id, "approved", "paid")
                          }
                          disabled={Boolean(actionId)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-2xl btn-3d-emerald text-xs font-medium disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Approve (Paid)</span>
                        </button>

                        <button
                          onClick={() =>
                            handleLeaveDecision(lv.id, "approved", "unpaid")
                          }
                          disabled={Boolean(actionId)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-2xl btn-3d-amber text-xs font-medium disabled:opacity-50"
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          <span>Approve (Unpaid)</span>
                        </button>

                        <button
                          onClick={() => handleLeaveDecision(lv.id, "rejected")}
                          disabled={Boolean(actionId)}
                          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-2xl btn-3d-rose text-xs font-medium disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* DEVICE SESSION LOGIN / LOGOUT REQUESTS SECTION */}
        <div className={panel === "devices" ? "glass-panel rounded-3xl overflow-hidden" : "hidden"}>
          <div className="px-6 py-5 border-b border-white/40 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                  Device Session Approvals
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Review new device login requests and employee logout requests
                </p>
              </div>
            </div>
            <span className="text-xs font-medium px-3.5 py-1.5 rounded-full bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 border border-indigo-400/30">
              {sessionRequests.length} Pending
            </span>
          </div>

          <div className="p-6 space-y-5">
            {sessionRequests.length === 0 ? (
              <div className="text-center py-4 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                No pending device login or logout requests right now.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnimatePresence>
                  {sessionRequests.map((req) => {
                    const empObj = Array.isArray(req.users)
                      ? req.users[0]
                      : req.users;
                    const empName = empObj?.full_name || "Employee";
                    const isLoginReq = req.request_type === "login";
                    const deviceLabel = req.device_info || "Web Browser";

                    return (
                      <motion.div
                        key={req.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        className="glass-card-3d rounded-3xl p-5 flex flex-col justify-between gap-4"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase px-3 py-1 rounded-full ${
                                isLoginReq
                                  ? "bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-400/40"
                                  : "bg-indigo-500/20 text-indigo-900 dark:text-indigo-200 border border-indigo-400/40"
                              }`}
                            >
                              <Smartphone className="w-3.5 h-3.5" />
                              {isLoginReq
                                ? "New Device Login"
                                : "Logout Request"}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {formatPktTime12h(req.created_at)}
                            </span>
                          </div>

                          <h3 className="text-base font-semibold text-slate-900 dark:text-white pt-1">
                            {isLoginReq
                              ? `Login Request from ${empName}`
                              : `Logout Request from ${empName}`}
                          </h3>

                          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                            {isLoginReq
                              ? `${empName} is trying to log in from another device (${deviceLabel}). Approve to logout old session?`
                              : `${empName} has requested to log out from their active session (${deviceLabel}). Approve to clear session?`}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                          <button
                            onClick={() =>
                              handleSessionAction(
                                {
                                  request_id: req.id,
                                  user_id: req.user_id,
                                  device_id: req.device_id,
                                  action: isLoginReq
                                    ? "approve_login"
                                    : "approve_logout",
                                },
                                `approve-${req.id}`
                              )
                            }
                            disabled={actionId === `approve-${req.id}`}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl btn-3d-emerald text-xs font-medium disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>
                              {isLoginReq ? "Approve" : "Approve Logout"}
                            </span>
                          </button>

                          <button
                            onClick={() =>
                              handleSessionAction(
                                {
                                  request_id: req.id,
                                  user_id: req.user_id,
                                  action: isLoginReq
                                    ? "reject_login"
                                    : "reject_logout",
                                },
                                `reject-${req.id}`
                              )
                            }
                            disabled={actionId === `reject-${req.id}`}
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl btn-3d-rose text-xs font-medium disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                            <span>Reject</span>
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}

            {/* Active Employee Sessions */}
            {activeLockedUsers.length > 0 && (
              <div className="pt-4 border-t border-white/40 dark:border-white/10">
                <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                  Active Employee Sessions ({activeLockedUsers.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeLockedUsers.map((u) => (
                    <div
                      key={u.id}
                      className="glass-card-3d rounded-2xl p-4 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {u.full_name}
                        </div>
                        <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                          {u.device_info || "Active Device"}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          handleSessionAction(
                            {
                              user_id: u.id,
                              action: "force_logout",
                            },
                            `force-${u.id}`
                          )
                        }
                        disabled={actionId === `force-${u.id}`}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl btn-3d-rose text-xs font-medium disabled:opacity-50"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>End Session</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={panel === "attendance" ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : "hidden"}>
          {/* Daily Attendance Table + Manual Overtime Button */}
          <div className="lg:col-span-2 glass-panel rounded-3xl overflow-hidden flex flex-col">
            <div className="p-5 sm:p-6 border-b border-white/40 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                  Daily Attendance Log
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Overtime = max(0, CheckOut &minus; max(DutyEnd, CheckIn))
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setOtDate(selectedDate);
                    if (!otUserId && employees.length > 0) {
                      setOtUserId(employees[0].id);
                    }
                    setOtModalOpen(true);
                  }}
                  className="rounded-xl btn-3d-primary px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Add Manual Overtime</span>
                </motion.button>

                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="rounded-xl glass-input pl-9 pr-3 py-2 text-xs font-mono font-medium focus:outline-none"
                  />
                </div>
                <button
                  onClick={fetchDashboardData}
                  className="p-2 rounded-xl btn-3d-glass"
                  title="Refresh"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/30 dark:bg-slate-900/40 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-white/30 dark:border-white/10">
                    <th className="py-3.5 px-5">Employee</th>
                    <th className="py-3.5 px-4">Check In</th>
                    <th className="py-3.5 px-4">Check Out</th>
                    <th className="py-3.5 px-4">Overtime</th>
                    <th className="py-3.5 px-5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/30 dark:divide-white/5 text-sm">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 text-center text-slate-500 text-xs"
                      >
                        Loading attendance records...
                      </td>
                    </tr>
                  ) : mergedRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 text-center text-slate-500 text-xs"
                      >
                        No employees added yet. Visit &ldquo;Add Employee&rdquo;
                        to register your team.
                      </td>
                    </tr>
                  ) : (
                    mergedRows.map((row) => (
                      <tr
                        key={row.employee.id}
                        className="hover:bg-white/25 dark:hover:bg-white/5 transition"
                      >
                        <td className="py-3.5 px-5">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {row.employee.full_name}{" "}
                            <span className="font-mono text-xs font-normal text-indigo-600 dark:text-indigo-400">
                              ({row.employee.employee_id})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Shift:{" "}
                            {formatTime24to12(row.employee.duty_start_time)} –{" "}
                            {formatTime24to12(row.employee.duty_end_time)}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-mono font-medium text-slate-700 dark:text-slate-200">
                          {formatPktTime12h(row.login_time)}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-mono font-medium text-slate-700 dark:text-slate-200">
                          {formatPktTime12h(row.logout_time)}
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          {row.overtime_hours > 0 ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border border-emerald-400/30">
                              +{row.overtime_hours.toFixed(2)} hrs OT
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono">
                              0.00 hrs
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                              row.status === "Present"
                                ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border border-emerald-400/30"
                                : row.status === "Paid Leave"
                                ? "bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 border border-indigo-400/30"
                                : row.status === "Unpaid Leave"
                                ? "bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-400/30"
                                : "bg-rose-500/20 text-rose-800 dark:text-rose-200 border border-rose-400/30"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex flex-col gap-3 self-start"><Link className="btn-3d-primary rounded-2xl p-4 text-center" href="/admin/qr-code">Open QR Code</Link><Link className="btn-3d-glass rounded-2xl p-4 text-center" href="/admin/settings">GPS Settings</Link><Link className="btn-3d-glass rounded-2xl p-4 text-center" href="/admin/leaves">Leave Management</Link></div>

        </div>
      </div>

      {/* MANUAL OVERTIME MODAL */}
      <AnimatePresence>
        {otModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              className="w-full max-w-md glass-panel rounded-3xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-white/40 dark:border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl btn-3d-primary">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Add Manual Overtime
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Sets the final overtime total for this date; does not add a second bonus.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setOtModalOpen(false)}
                  className="btn-3d-glass p-1.5 rounded-xl"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveManualOvertime} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Employee *
                  </label>
                  <select
                    required
                    value={otUserId}
                    onChange={(e) => setOtUserId(e.target.value)}
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-medium"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.employee_id} — {emp.full_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Date (PKT) *
                  </label>
                  <input
                    type="date"
                    required
                    value={otDate}
                    onChange={(e) => setOtDate(e.target.value)}
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Overtime Hours *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="24"
                    required
                    value={otHours}
                    onChange={(e) => setOtHours(e.target.value)}
                    placeholder="e.g. 2.5"
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setOtModalOpen(false)}
                    className="btn-3d-glass rounded-xl px-4 py-2 text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingOt}
                    className="btn-3d-primary rounded-xl px-4 py-2 text-xs font-medium"
                  >
                    {savingOt ? "Saving..." : "Save Overtime"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AdminShell>
  );
}
