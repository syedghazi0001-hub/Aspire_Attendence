"use client";

import React, { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { adminFetch } from "@/lib/adminFetch";
import { getCurrentMonthPkt, getTodayPktDateString } from "@/lib/pktTime";
import {
  CalendarOff,
  PlusCircle,
  Trash2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Clock,
} from "lucide-react";

interface EmployeeProfile {
  id: string;
  employee_id: string;
  full_name: string;
  monthly_salary: number;
  basic_salary?: number;
  per_day_deduction: number;
  hourly_rate: number;
  duty_start_time: string;
  duty_end_time: string;
}

interface LeaveRecord {
  id: string;
  user_id: string;
  date: string;
  leave_type: "paid" | "unpaid" | "short";
  hours_missed: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  users?: {
    id: string;
    employee_id: string;
    full_name: string;
    monthly_salary: number;
    per_day_deduction: number;
    hourly_rate: number;
    duty_start_time: string;
    duty_end_time: string;
  };
}

export default function AdminLeavesPage() {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(
    getCurrentMonthPkt()
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");

  const [userId, setUserId] = useState<string>("");
  const [date, setDate] = useState<string>(getTodayPktDateString());
  const [leaveType, setLeaveType] = useState<"paid" | "unpaid" | "short">(
    "paid"
  );
  const [hoursMissed, setHoursMissed] = useState<string>("2");
  const [reason, setReason] = useState<string>("");

  const fetchLeavesAndEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, leavesRes] = await Promise.all([
        adminFetch("/api/admin/employees"),
        adminFetch(
          `/api/admin/leaves?month=${encodeURIComponent(selectedMonth)}`
        ),
      ]);

      const empData = await empRes.json();
      const leavesData = await leavesRes.json();

      if (empRes.ok && empData.employees) {
        setEmployees(empData.employees);
        if (!userId && empData.employees.length > 0) {
          setUserId(empData.employees[0].id);
        }
      }

      if (leavesRes.ok && leavesData.leaves) {
        setLeaves(leavesData.leaves);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load leaves.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, userId]);

  useEffect(() => {
    fetchLeavesAndEmployees();
  }, [fetchLeavesAndEmployees]);

  const handleAddLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!userId) {
      setErrorMsg("Please select an employee first.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await adminFetch("/api/admin/leaves", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          date,
          leave_type: leaveType,
          hours_missed:
            leaveType === "short" ? parseFloat(hoursMissed || "0") || 0 : 0,
          reason: reason.trim(),
          status: "approved",
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || "Failed to save leave.");
        return;
      }

      setSuccessMsg(data.message || "Leave recorded successfully.");
      setReason("");
      await fetchLeavesAndEmployees();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error saving leave record.";
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (
    id: string,
    status: "approved" | "rejected"
  ) => {
    setErrorMsg("");
    try {
      const res = await adminFetch("/api/admin/leaves", {
        method: "PUT",
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to update leave status.");
        return;
      }
      await fetchLeavesAndEmployees();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error updating leave status.";
      setErrorMsg(msg);
    }
  };

  const handleDeleteLeave = async (id: string) => {
    setErrorMsg("");
    try {
      const res = await adminFetch(
        `/api/admin/leaves?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to delete leave.");
        return;
      }
      await fetchLeavesAndEmployees();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error deleting leave.";
      setErrorMsg(msg);
    }
  };

  const calculateLeaveDeductionPreview = (leave: LeaveRecord): number => {
    if (leave.status !== "approved") return 0;
    const emp = leave.users;
    if (!emp) return 0;

    if (leave.leave_type === "paid") {
      return 0;
    }
    if (leave.leave_type === "unpaid") {
      return Number(emp.per_day_deduction || 0);
    }
    if (leave.leave_type === "short") {
      return (
        Math.round(
          Number(emp.hourly_rate || 0) * Number(leave.hours_missed || 0) * 100
        ) / 100
      );
    }
    return 0;
  };

  return (
    <AdminShell
      title="Leaves & Short-Leave Management"
      subtitle="Paid Leave = No deduction, no absent mark | Unpaid Leave = Per-day deduction, absent mark | Short Leave = Hourly deduction"
    >
      <div className="space-y-6">
        {errorMsg && (
          <div className="glass-panel rounded-2xl border-rose-400/50 p-4 text-xs font-bold text-rose-900 dark:text-rose-200 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="glass-panel rounded-2xl border-emerald-400/50 p-4 text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Record Leave Form */}
        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/40 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <PlusCircle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Assign Paid / Unpaid / Short Leave
                </h2>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Early clock-outs automatically log a Short Leave entry
                </p>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleAddLeave}
            className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end"
          >
            <div className="lg:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                Employee *
              </label>
              <select
                required
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-bold"
              >
                {employees.length === 0 ? (
                  <option value="">No employees registered yet</option>
                ) : (
                  employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                Date (PKT) *
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                Leave Type *
              </label>
              <select
                value={leaveType}
                onChange={(e) =>
                  setLeaveType(e.target.value as "paid" | "unpaid" | "short")
                }
                className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-bold"
              >
                <option value="paid">Paid Leave (No Deduction)</option>
                <option value="unpaid">Unpaid Leave (Full Day Deduct)</option>
                <option value="short">Short Leave (Hourly Deduct)</option>
              </select>
            </div>

            {leaveType === "short" ? (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                  Hours Missed *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.1"
                  required
                  value={hoursMissed}
                  onChange={(e) => setHoursMissed(e.target.value)}
                  placeholder="e.g. 2.5"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                  Reason / Note
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Medical / Personal"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-medium"
                />
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={submitting || employees.length === 0}
                className="w-full rounded-2xl btn-3d-primary py-2.5 px-4 text-sm font-extrabold disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Record Leave"}
              </button>
            </div>
          </form>
        </div>

        {/* Monthly Leaves Ledger Table */}
        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/40 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <CalendarOff className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Monthly Leave Records ({selectedMonth})
                </h2>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Paid leaves count as present; Unpaid leaves deduct per-day
                  rate; Short leaves deduct missed hours &times; hourly rate
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-xl glass-input px-3.5 py-1.5 text-xs font-mono font-bold"
              />
              <button
                onClick={fetchLeavesAndEmployees}
                className="btn-3d-glass rounded-xl px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/40 dark:border-slate-700/60 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-white/30 dark:bg-slate-800/40">
                  <th className="py-3.5 px-5">Date</th>
                  <th className="py-3.5 px-5">Employee</th>
                  <th className="py-3.5 px-5">Leave Type</th>
                  <th className="py-3.5 px-5">Hours Missed</th>
                  <th className="py-3.5 px-5">Salary Impact</th>
                  <th className="py-3.5 px-5">Reason</th>
                  <th className="py-3.5 px-5">Status</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/30 dark:divide-slate-700/50 text-sm">
                {leaves.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-12 text-center text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      No leaves recorded for {selectedMonth}.
                    </td>
                  </tr>
                ) : (
                  leaves.map((lv) => {
                    const deduction = calculateLeaveDeductionPreview(lv);
                    return (
                      <tr
                        key={lv.id}
                        className="hover:bg-white/30 dark:hover:bg-slate-800/30 transition"
                      >
                        <td className="py-3.5 px-5 font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                          {lv.date}
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="font-bold text-slate-800 dark:text-white">
                            {lv.users?.full_name || "Employee"}
                          </div>
                        </td>
                        <td className="py-3.5 px-5">
                          {lv.leave_type === "paid" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2.5 py-0.5 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                              Paid Leave
                            </span>
                          )}
                          {lv.leave_type === "unpaid" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 border border-rose-400/40 px-2.5 py-0.5 text-xs font-bold text-rose-900 dark:text-rose-200">
                              Unpaid Leave (Absent)
                            </span>
                          )}
                          {lv.leave_type === "short" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-400/40 px-2.5 py-0.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                              <Clock className="w-3 h-3" />
                              Short Leave
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                          {lv.leave_type === "short"
                            ? `${Number(lv.hours_missed || 0).toFixed(2)} hrs`
                            : "Full Day"}
                        </td>
                        <td className="py-3.5 px-5 font-mono text-xs font-bold">
                          {deduction === 0 ? (
                            <span className="text-emerald-700 dark:text-emerald-300">
                              0 (No Deduction)
                            </span>
                          ) : (
                            <span className="text-rose-700 dark:text-rose-300">
                              -{deduction.toLocaleString()}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-xs font-medium text-slate-600 dark:text-slate-300 max-w-xs truncate">
                          {lv.reason || "—"}
                        </td>
                        <td className="py-3.5 px-5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${
                              lv.status === "approved"
                                ? "bg-indigo-500/20 text-indigo-800 dark:text-indigo-200"
                                : lv.status === "rejected"
                                ? "bg-slate-500/20 text-slate-700 dark:text-slate-300"
                                : "bg-amber-500/20 text-amber-900 dark:text-amber-200"
                            }`}
                          >
                            {lv.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {lv.status !== "approved" && (
                              <button
                                onClick={() =>
                                  handleStatusChange(lv.id, "approved")
                                }
                                title="Approve Leave"
                                className="btn-3d-emerald p-1.5 rounded-lg"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            )}
                            {lv.status !== "rejected" && (
                              <button
                                onClick={() =>
                                  handleStatusChange(lv.id, "rejected")
                                }
                                title="Reject Leave"
                                className="btn-3d-amber p-1.5 rounded-lg"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteLeave(lv.id)}
                              title="Delete Leave"
                              className="btn-3d-rose p-1.5 rounded-lg"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
