"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { adminFetch } from "@/lib/adminFetch";
import { formatPktTime12h, getTodayPktDateString } from "@/lib/pktTime";
import {
  Users,
  Smartphone,
  Clock,
  RefreshCw,
  ShieldOff,
  CheckCircle2,
  XCircle,
  UserPlus,
  BellRing,
  CalendarOff,
} from "lucide-react";

interface EmployeeProfile {
  id: string;
  employee_id: string;
  full_name: string;
  role: string;
  device_id?: string | null;
  monthly_salary: number;
  basic_salary: number;
  per_day_deduction: number;
  hourly_rate: number;
  overtime_rate: number;
  duty_start_time: string;
  duty_end_time: string;
}

interface SessionRequestRow {
  id: string;
  user_id: string;
  request_type: "login" | "logout";
  device_id: string;
  device_info: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  users?: {
    id: string;
    employee_id: string;
    full_name: string;
    role: string;
    device_id?: string | null;
  };
}

interface ActiveLockedUser {
  id: string;
  employee_id: string;
  full_name: string;
  role: string;
  device_id: string;
  created_at: string;
}

interface AttendanceRecord {
  id: string;
  user_id: string;
  date: string;
  login_time: string | null;
  logout_time: string | null;
  status: string;
  overtime_hours: number;
  missed_hours?: number;
  users?: {
    employee_id: string;
    full_name: string;
    duty_start_time?: string;
    duty_end_time?: string;
    overtime_rate?: number;
    hourly_rate?: number;
  };
}

export default function AdminDashboardPage() {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [sessionRequests, setSessionRequests] = useState<SessionRequestRow[]>(
    []
  );
  const [activeLockedUsers, setActiveLockedUsers] = useState<
    ActiveLockedUser[]
  >([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(
    getTodayPktDateString()
  );
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadDashboardData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [empRes, sessRes, attRes] = await Promise.all([
        adminFetch("/api/admin/employees"),
        adminFetch("/api/admin/sessions"),
        adminFetch(
          `/api/admin/attendance?date=${encodeURIComponent(selectedDate)}`
        ),
      ]);

      const empData = await empRes.json();
      const sessData = await sessRes.json();
      const attData = await attRes.json();

      if (empData.employees) setEmployees(empData.employees);
      if (sessData.session_requests) {
        setSessionRequests(sessData.session_requests);
      }
      if (sessData.active_locked_users) {
        setActiveLockedUsers(sessData.active_locked_users);
      }
      if (attData.attendance) setAttendance(attData.attendance);
    } catch {
      // Handled gracefully
    } finally {
      setRefreshing(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(() => {
      loadDashboardData();
    }, 6000);
    return () => clearInterval(interval);
  }, [loadDashboardData]);

  const handleSessionAction = async ({
    requestId,
    userId,
    deviceId,
    action,
  }: {
    requestId?: string;
    userId?: string;
    deviceId?: string;
    action:
      | "approve_login"
      | "reject_login"
      | "approve_logout"
      | "reject_logout"
      | "force_logout";
  }) => {
    setFeedback(null);
    try {
      const response = await adminFetch("/api/admin/sessions", {
        method: "PUT",
        body: JSON.stringify({
          request_id: requestId,
          user_id: userId,
          device_id: deviceId,
          action,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFeedback({
          type: "error",
          text: result.error || "Failed to update session.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: result.message || "Session updated successfully.",
      });
      await loadDashboardData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to update session.";
      setFeedback({ type: "error", text: msg });
    }
  };

  return (
    <AdminShell
      title="Operations & Session Management"
      subtitle="Approve employee device logins/logouts, enforce single-device locks, and monitor live PKT attendance"
    >
      <div className="space-y-6">
        {feedback && (
          <div
            className={`glass-panel rounded-2xl p-4 text-sm font-bold flex items-center justify-between ${
              feedback.type === "success"
                ? "border-emerald-400/50 text-emerald-900 dark:text-emerald-200"
                : "border-rose-400/50 text-rose-900 dark:text-rose-200"
            }`}
          >
            <span>{feedback.text}</span>
            <button
              onClick={() => setFeedback(null)}
              className="text-xs underline ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 3D Glass KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card-3d rounded-3xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Total Employees
              </p>
              <p className="text-3xl font-extrabold text-slate-800 dark:text-white mt-1">
                {employees.length}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl btn-3d-primary">
              <Users className="w-6 h-6" />
            </div>
          </div>

          <div className="glass-card-3d rounded-3xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Session Requests
              </p>
              <p className="text-3xl font-extrabold text-amber-600 dark:text-amber-300 mt-1">
                {sessionRequests.length}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl btn-3d-amber">
              <BellRing className="w-6 h-6" />
            </div>
          </div>

          <div className="glass-card-3d rounded-3xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Locked Active Devices
              </p>
              <p className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-300 mt-1">
                {activeLockedUsers.length}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl btn-3d-emerald">
              <Smartphone className="w-6 h-6" />
            </div>
          </div>

          <div className="glass-card-3d rounded-3xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Present ({selectedDate})
              </p>
              <p className="text-3xl font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">
                {attendance.length}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl btn-3d-primary">
              <Clock className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* SECTION: SESSION REQUESTS (Pending Logins, Logouts & Force Logout) */}
        {/* ================================================================= */}
        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/40 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-amber">
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Session Requests ({sessionRequests.length} Pending)
                </h2>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Approve new employee logins (locks{" "}
                  <code className="font-mono">users.device_id</code>) or approve
                  employee logout requests
                </p>
              </div>
            </div>
            <button
              onClick={loadDashboardData}
              className="btn-3d-glass rounded-xl px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3">
                Pending Login &amp; Logout Approvals
              </h3>

              {sessionRequests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-400/40 p-6 text-center text-xs font-medium text-slate-600 dark:text-slate-300">
                  No pending login or logout requests right now.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sessionRequests.map((req) => (
                    <div
                      key={req.id}
                      className="glass-card-3d rounded-2xl p-5 flex flex-col justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-sm text-slate-800 dark:text-white">
                            {req.users?.full_name || "Employee"} (
                            {req.users?.employee_id || "—"})
                          </span>
                          <span
                            className={`text-[11px] font-bold px-3 py-1 rounded-full ${
                              req.request_type === "login"
                                ? "bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 border border-indigo-400/40"
                                : "bg-amber-500/20 text-amber-900 dark:text-amber-200 border border-amber-400/40"
                            }`}
                          >
                            {req.request_type === "login"
                              ? "Pending Login"
                              : "Pending Logout"}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-2">
                          Browser / OS: {req.device_info || "Browser Session"}
                        </p>
                        <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300 mt-1 break-all">
                          Device ID: {req.device_id}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          Requested at: {formatPktTime12h(req.created_at)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5 pt-2">
                        {req.request_type === "login" ? (
                          <>
                            <button
                              onClick={() =>
                                handleSessionAction({
                                  requestId: req.id,
                                  userId: req.user_id,
                                  deviceId: req.device_id,
                                  action: "approve_login",
                                })
                              }
                              className="flex-1 btn-3d-emerald rounded-xl px-3.5 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-1.5"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              Approve Login
                            </button>
                            <button
                              onClick={() =>
                                handleSessionAction({
                                  requestId: req.id,
                                  userId: req.user_id,
                                  action: "reject_login",
                                })
                              }
                              className="btn-3d-rose rounded-xl px-3.5 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-1.5"
                            >
                              <XCircle className="w-4 h-4" />
                              Reject
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() =>
                                handleSessionAction({
                                  requestId: req.id,
                                  userId: req.user_id,
                                  action: "approve_logout",
                                })
                              }
                              className="flex-1 btn-3d-emerald rounded-xl px-3.5 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-1.5"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              Approve Logout
                            </button>
                            <button
                              onClick={() =>
                                handleSessionAction({
                                  requestId: req.id,
                                  userId: req.user_id,
                                  action: "reject_logout",
                                })
                              }
                              className="btn-3d-glass rounded-xl px-3.5 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-1.5"
                            >
                              <XCircle className="w-4 h-4" />
                              Keep Logged In
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Locked Sessions with "Force Logout" */}
            <div className="pt-4 border-t border-white/40 dark:border-slate-700/60">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Active Locked Device Sessions ({activeLockedUsers.length})
                </h3>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Force Logout immediately clears{" "}
                  <code className="font-mono">users.device_id</code>
                </span>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-white/40 dark:border-slate-700/60">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/40 dark:border-slate-700/60 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-white/30 dark:bg-slate-800/40">
                      <th className="py-3.5 px-4">Employee</th>
                      <th className="py-3.5 px-4">Employee ID</th>
                      <th className="py-3.5 px-4">
                        Locked Device ID / Browser Fingerprint
                      </th>
                      <th className="py-3.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/30 dark:divide-slate-700/50 text-sm">
                    {activeLockedUsers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-8 text-center text-xs font-medium text-slate-600 dark:text-slate-300"
                        >
                          No active locked employee sessions right now.
                        </td>
                      </tr>
                    ) : (
                      activeLockedUsers.map((u) => (
                        <tr
                          key={u.id}
                          className="hover:bg-white/30 dark:hover:bg-slate-800/30 transition"
                        >
                          <td className="py-3.5 px-4 font-bold text-slate-800 dark:text-white">
                            {u.full_name}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300">
                            {u.employee_id}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-300 break-all">
                            {u.device_id}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() =>
                                handleSessionAction({
                                  userId: u.id,
                                  action: "force_logout",
                                })
                              }
                              className="btn-3d-rose rounded-xl px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5"
                            >
                              <ShieldOff className="w-3.5 h-3.5" />
                              Force Logout
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Daily Attendance Ledger (PKT) */}
        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/40 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Daily Attendance Ledger (Pakistan Standard Time)
                </h2>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Exact overtime minutes after Duty End Time &amp; automatic
                  Short Leave tracking
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-xl glass-input px-3.5 py-2 text-xs font-mono font-bold"
              />
              <Link
                href="/admin/leaves"
                className="btn-3d-glass rounded-xl px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <CalendarOff className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Manage Leaves
              </Link>
              <Link
                href="/admin/add-employee"
                className="btn-3d-primary rounded-xl px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add Employee
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/40 dark:border-slate-700/60 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-white/30 dark:bg-slate-800/40">
                  <th className="py-3.5 px-5">Employee</th>
                  <th className="py-3.5 px-5">ID</th>
                  <th className="py-3.5 px-5">Date (PKT)</th>
                  <th className="py-3.5 px-5">Clock In (PKT)</th>
                  <th className="py-3.5 px-5">Clock Out (PKT)</th>
                  <th className="py-3.5 px-5">Short Leave</th>
                  <th className="py-3.5 px-5">Overtime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/30 dark:divide-slate-700/50 text-sm">
                {attendance.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-10 text-center text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      No attendance records found for {selectedDate}.
                    </td>
                  </tr>
                ) : (
                  attendance.map((rec) => (
                    <tr
                      key={rec.id}
                      className="hover:bg-white/30 dark:hover:bg-slate-800/30 transition"
                    >
                      <td className="py-3.5 px-5 font-bold text-slate-800 dark:text-white">
                        {rec.users?.full_name || "Unknown"}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300">
                        {rec.users?.employee_id || "—"}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                        {rec.date}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-xs text-emerald-700 dark:text-emerald-300 font-bold">
                        {formatPktTime12h(rec.login_time)}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-xs text-amber-700 dark:text-amber-300 font-bold">
                        {formatPktTime12h(rec.logout_time)}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-xs">
                        {Number(rec.missed_hours || 0) > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-amber-500/20 border border-amber-400/40 px-2.5 py-0.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                            -{Number(rec.missed_hours).toFixed(2)} hrs
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            0.00 hrs
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-xs">
                        {Number(rec.overtime_hours || 0) > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-indigo-500/20 border border-indigo-400/40 px-2.5 py-0.5 text-xs font-bold text-indigo-900 dark:text-indigo-200">
                            +{Number(rec.overtime_hours).toFixed(2)} hrs
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            0.00 hrs
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
