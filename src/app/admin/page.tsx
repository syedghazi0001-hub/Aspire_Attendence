"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import AdminShell from "@/components/AdminShell";
import QrGeneratorCard from "@/components/QrGeneratorCard";
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
  hours_missed: number;
  status: string;
}

function getTodayPktDateString(): string {
  const now = new Date();
  const pktTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return pktTime.toISOString().slice(0, 10);
}

export default function AdminDashboardPage() {
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
        adminFetch(`/api/admin/leaves?month=${encodeURIComponent(monthPrefix)}`),
      ]);

      const [empData, attData, sessData, setData, leaveData] =
        await Promise.all([
          empRes.json().catch(() => ({})),
          attRes.json().catch(() => ({})),
          sessRes.json().catch(() => ({})),
          setRes.json().catch(() => ({})),
          leaveRes.json().catch(() => ({})),
        ]);

      setEmployees(empData.employees || []);
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
  }, [selectedDate]);

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

  // Build daily attendance rows (Showing Employee Full Name prominently, no employee_id or user_id)
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
      overtime_hours: Number(record?.overtime_hours || 0),
      missed_hours:
        Number(record?.missed_hours || 0) ||
        (leave?.leave_type === "short" ? Number(leave.hours_missed || 0) : 0),
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
      title="Admin Dashboard"
      subtitle="Live attendance overview, device login approvals, and workplace QR code"
    >
      <div className="space-y-6">
        {/* Top Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-panel rounded-3xl p-5 flex items-center gap-4">
            <div className="p-3.5 rounded-2xl btn-3d-primary">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Total Employees
              </p>
              <p className="text-2xl font-extrabold text-slate-800 dark:text-white mt-0.5">
                {employees.length}
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex items-center gap-4">
            <div className="p-3.5 rounded-2xl btn-3d-emerald">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Present / Paid Leave
              </p>
              <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 mt-0.5">
                {presentCount}
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex items-center gap-4">
            <div className="p-3.5 rounded-2xl btn-3d-rose">
              <UserX className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Absent Today
              </p>
              <p className="text-2xl font-extrabold text-rose-700 dark:text-rose-300 mt-0.5">
                {absentCount}
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5 flex items-center gap-4">
            <div className="p-3.5 rounded-2xl btn-3d-amber">
              <BellRing className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Pending Requests
              </p>
              <p className="text-2xl font-extrabold text-amber-700 dark:text-amber-300 mt-0.5">
                {sessionRequests.length}
              </p>
            </div>
          </div>
        </div>

        {/* PENDING REQUESTS SECTION */}
        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/40 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Pending Requests
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Review new device login requests and employee logout requests
                </p>
              </div>
            </div>
            <span className="text-xs font-bold px-3.5 py-1.5 rounded-full bg-indigo-500/15 text-indigo-800 dark:text-indigo-200 border border-indigo-400/30">
              {sessionRequests.length} Pending
            </span>
          </div>

          <div className="p-6 space-y-5">
            {sessionRequests.length === 0 ? (
              <div className="text-center py-6 text-sm font-medium text-slate-600 dark:text-slate-300">
                No pending login or logout requests right now.
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
                              className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase px-3 py-1 rounded-full ${
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
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-300">
                              {formatPktTime12h(req.created_at)}
                            </span>
                          </div>

                          <h3 className="text-base font-extrabold text-slate-800 dark:text-white pt-1">
                            {isLoginReq
                              ? `Login Request from ${empName}`
                              : `Logout Request from ${empName}`}
                          </h3>

                          <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
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
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl btn-3d-emerald text-xs font-extrabold disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>
                              {isLoginReq
                                ? "Approve"
                                : "Approve Logout"}
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
                            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-2xl btn-3d-rose text-xs font-extrabold disabled:opacity-50"
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
              <div className="pt-4 border-t border-white/40 dark:border-slate-700/60">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3">
                  Active Employee Sessions ({activeLockedUsers.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeLockedUsers.map((u) => (
                    <div
                      key={u.id}
                      className="glass-card-3d rounded-2xl p-4 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-slate-800 dark:text-white truncate">
                          {u.full_name}
                        </div>
                        <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mt-0.5">
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
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl btn-3d-rose text-xs font-bold disabled:opacity-50"
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Daily Attendance Table (Clean SaaS Table, Employee Full Name Only) */}
          <div className="lg:col-span-2 glass-panel rounded-3xl overflow-hidden flex flex-col">
            <div className="p-5 sm:p-6 border-b border-white/40 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Daily Attendance Log
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Real-time clock-in, clock-out, and overtime status
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-500 dark:text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="rounded-xl glass-input pl-9 pr-3 py-2 text-xs font-bold focus:outline-none"
                  />
                </div>
                <button
                  onClick={fetchDashboardData}
                  className="p-2.5 rounded-xl btn-3d-glass"
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
                  <tr className="bg-white/30 dark:bg-slate-800/40 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-white/30 dark:border-slate-700/60">
                    <th className="py-3.5 px-5">Employee</th>
                    <th className="py-3.5 px-4">Clock In</th>
                    <th className="py-3.5 px-4">Clock Out</th>
                    <th className="py-3.5 px-4">Overtime / Short</th>
                    <th className="py-3.5 px-5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/30 dark:divide-slate-700/50 text-sm">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 text-center text-slate-500 text-xs font-medium"
                      >
                        Loading attendance records...
                      </td>
                    </tr>
                  ) : mergedRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 text-center text-slate-500 text-xs font-medium"
                      >
                        No employees added yet. Visit &ldquo;Add Employee&rdquo;
                        to register your team.
                      </td>
                    </tr>
                  ) : (
                    mergedRows.map((row) => (
                      <tr
                        key={row.employee.id}
                        className="hover:bg-white/25 dark:hover:bg-slate-800/35 transition"
                      >
                        <td className="py-3.5 px-5">
                          <div className="font-bold text-slate-800 dark:text-white">
                            {row.employee.full_name}
                          </div>
                          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-300">
                            Shift:{" "}
                            {formatTime24to12(row.employee.duty_start_time)} –{" "}
                            {formatTime24to12(row.employee.duty_end_time)}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-bold text-slate-700 dark:text-slate-200">
                          {formatPktTime12h(row.login_time)}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-bold text-slate-700 dark:text-slate-200">
                          {formatPktTime12h(row.logout_time)}
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          {row.overtime_hours > 0 ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/15 text-indigo-800 dark:text-indigo-200">
                              +{row.overtime_hours.toFixed(2)} hrs OT
                            </span>
                          ) : row.missed_hours > 0 ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-800 dark:text-amber-200">
                              -{row.missed_hours.toFixed(2)} hrs Short
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
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

          {/* Workplace QR Code Card */}
          <div>
            <QrGeneratorCard qrSecret={qrSecret} />
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
