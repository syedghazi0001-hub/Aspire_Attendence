"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Inbox,
  FilePlus2,
  BadgeCheck,
  Ban,
  Banknote,
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
  leave_category?: string;
  hours_missed: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  source?: "employee" | "manual";
  is_paid?: boolean;
  employee_name?: string;
  employee_code?: string;
  request_summary?: string;
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

type LeaveTab = "requests" | "manual" | "approved" | "rejected";

export default function AdminLeavesPage() {
  const [activeTab, setActiveTab] = useState<LeaveTab>("requests");
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(
    getCurrentMonthPkt()
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");

  // Manual Leave Form State
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

  const handleAddManualLeave = async (e: React.FormEvent) => {
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
          source: "manual",
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || "Failed to save manual leave.");
        return;
      }

      setSuccessMsg(data.message || "Manual leave recorded successfully.");
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

  const handleLeaveDecision = async (
    id: string,
    status: "approved" | "rejected",
    chosenType?: "paid" | "unpaid" | "short"
  ) => {
    setErrorMsg("");
    setSuccessMsg("");
    setActionBusyId(`${id}-${status}-${chosenType || ""}`);
    try {
      const payload: Record<string, unknown> = { id, status };
      if (chosenType) {
        payload.leave_type = chosenType;
      }

      const res = await adminFetch("/api/admin/leaves", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to update leave status.");
        return;
      }
      setSuccessMsg(
        status === "approved"
          ? `Leave approved as ${
              chosenType === "unpaid"
                ? "Unpaid Leave"
                : chosenType === "short"
                ? "Short Leave"
                : "Paid Leave"
            }.`
          : "Leave request rejected."
      );
      await fetchLeavesAndEmployees();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error updating leave status.";
      setErrorMsg(msg);
    } finally {
      setActionBusyId(null);
    }
  };

  const handleTogglePaidType = async (
    id: string,
    newType: "paid" | "unpaid"
  ) => {
    setErrorMsg("");
    setActionBusyId(`${id}-type`);
    try {
      const res = await adminFetch("/api/admin/leaves", {
        method: "PUT",
        body: JSON.stringify({ id, leave_type: newType }),
      });
      if (res.ok) {
        await fetchLeavesAndEmployees();
      }
    } finally {
      setActionBusyId(null);
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

  const resolveEmployeeInfo = (lv: LeaveRecord) => {
    const matchedEmp = employees.find((e) => e.id === lv.user_id);
    const name =
      lv.employee_name ||
      lv.users?.full_name ||
      matchedEmp?.full_name ||
      "Employee";
    const code =
      lv.employee_code ||
      lv.users?.employee_id ||
      matchedEmp?.employee_id ||
      "EMP --";
    return { name, code, emp: lv.users || matchedEmp };
  };

  const calculateLeaveDeductionPreview = (leave: LeaveRecord): number => {
    if (leave.status !== "approved") return 0;
    const { emp } = resolveEmployeeInfo(leave);
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

  // Filtered collections for the 4 tabs
  const employeeRequestsList = leaves.filter(
    (l) => l.source !== "manual" && l.status === "pending"
  );
  const manualLeavesList = leaves.filter((l) => l.source === "manual");
  const approvedLeavesList = leaves.filter((l) => l.status === "approved");
  const rejectedLeavesList = leaves.filter((l) => l.status === "rejected");

  const tabs: {
    id: LeaveTab;
    label: string;
    count: number;
    icon: React.ElementType;
  }[] = [
    {
      id: "requests",
      label: "Employee Requests",
      count: employeeRequestsList.length,
      icon: Inbox,
    },
    {
      id: "manual",
      label: "Manual Leaves",
      count: manualLeavesList.length,
      icon: FilePlus2,
    },
    {
      id: "approved",
      label: "Approved",
      count: approvedLeavesList.length,
      icon: BadgeCheck,
    },
    {
      id: "rejected",
      label: "Rejected",
      count: rejectedLeavesList.length,
      icon: Ban,
    },
  ];

  const activeRows =
    activeTab === "requests"
      ? employeeRequestsList
      : activeTab === "manual"
      ? manualLeavesList
      : activeTab === "approved"
      ? approvedLeavesList
      : rejectedLeavesList;

  return (
    <AdminShell
      title="Leave Management Dashboard"
      subtitle="Review employee leave applications, decide Paid vs. Unpaid status, or assign manual leaves"
    >
      <div className="space-y-6">
        <AnimatePresence mode="wait">
          {errorMsg && (
            <motion.div
              key="err"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="glass-panel rounded-2xl border-rose-400/50 p-4 text-xs font-medium text-rose-900 dark:text-rose-200 flex items-center gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{errorMsg}</span>
            </motion.div>
          )}

          {successMsg && (
            <motion.div
              key="ok"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="glass-panel rounded-2xl border-emerald-400/50 p-4 text-xs font-medium text-emerald-900 dark:text-emerald-200 flex items-center gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{successMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top Navigation Tabs & Month Selector */}
        <div className="glass-panel rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <motion.button
                  key={tab.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-all ${
                    isActive ? "btn-3d-primary" : "btn-3d-glass"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isActive
                        ? "bg-white/25 text-white"
                        : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                    }`}
                  >
                    {tab.count}
                  </span>
                </motion.button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-xl glass-input px-3.5 py-2 text-xs font-mono font-medium"
            />
            <button
              onClick={fetchLeavesAndEmployees}
              className="btn-3d-glass rounded-xl px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>

        {/* TAB 1: EMPLOYEE REQUESTS (Detailed Cards with "Employee [Name] requested [Leave Type] for [Date]" + Paid/Unpaid Approval) */}
        {activeTab === "requests" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-3xl p-6 space-y-5"
          >
            <div className="flex items-center justify-between flex-wrap gap-3 border-b border-white/40 dark:border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl btn-3d-primary">
                  <Inbox className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                    Pending Employee Leave Requests (
                    {employeeRequestsList.length})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Approve as Paid Leave (no deduction) or Unpaid Leave
                    (per-day deduction), or Reject
                  </p>
                </div>
              </div>
            </div>

            {employeeRequestsList.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                No pending employee leave requests for {selectedMonth}.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {employeeRequestsList.map((lv) => {
                  const { name, code } = resolveEmployeeInfo(lv);
                  const requestedTypeLabel =
                    lv.leave_category ||
                    (lv.leave_type === "paid"
                      ? "Paid Leave"
                      : lv.leave_type === "unpaid"
                      ? "Unpaid Leave"
                      : `Short Leave (${lv.hours_missed}h)`);

                  return (
                    <motion.div
                      key={lv.id}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="glass-card-3d rounded-3xl p-5 flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 border border-indigo-400/30 px-3 py-1 text-xs font-medium text-indigo-800 dark:text-indigo-200">
                            {code} &bull; {name}
                          </span>
                          <span className="rounded-full bg-amber-500/20 border border-amber-400/35 px-2.5 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">
                            Pending Review
                          </span>
                        </div>

                        <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white leading-snug">
                          Employee{" "}
                          <span className="text-indigo-600 dark:text-indigo-300">
                            {name}
                          </span>{" "}
                          ({code}) requested{" "}
                          <span className="underline decoration-indigo-400/60">
                            {requestedTypeLabel}
                          </span>{" "}
                          for <span className="font-mono">{lv.date}</span>
                        </p>

                        <div className="rounded-2xl glass-input px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            Reason:{" "}
                          </span>
                          {lv.reason ? (
                            lv.reason
                          ) : (
                            <em className="text-slate-400">
                              No reason provided (optional)
                            </em>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/40 dark:border-white/10">
                        <button
                          onClick={() =>
                            handleLeaveDecision(lv.id, "approved", "paid")
                          }
                          disabled={Boolean(actionBusyId)}
                          className="flex-1 rounded-2xl btn-3d-emerald px-3.5 py-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Approve (Paid)</span>
                        </button>

                        <button
                          onClick={() =>
                            handleLeaveDecision(lv.id, "approved", "unpaid")
                          }
                          disabled={Boolean(actionBusyId)}
                          className="flex-1 rounded-2xl btn-3d-amber px-3.5 py-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          <span>Approve (Unpaid)</span>
                        </button>

                        <button
                          onClick={() => handleLeaveDecision(lv.id, "rejected")}
                          disabled={Boolean(actionBusyId)}
                          className="rounded-2xl btn-3d-rose px-3.5 py-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
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
          </motion.div>
        )}

        {/* TAB 2: MANUAL LEAVES ASSIGNMENT FORM */}
        {activeTab === "manual" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-3xl overflow-hidden"
          >
            <div className="px-6 py-5 border-b border-white/40 dark:border-white/10 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl btn-3d-primary">
                  <PlusCircle className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                    Assign Manual Leave (Paid / Unpaid / Short)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Directly record an approved Paid, Unpaid, or Short Leave for
                    any employee
                  </p>
                </div>
              </div>
            </div>

            <form
              onSubmit={handleAddManualLeave}
              className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end"
            >
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                  Employee *
                </label>
                <select
                  required
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-medium"
                >
                  {employees.length === 0 ? (
                    <option value="">No employees registered yet</option>
                  ) : (
                    employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.employee_id} — {emp.full_name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                  Date (PKT) *
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                  Paid / Unpaid Status *
                </label>
                <select
                  value={leaveType}
                  onChange={(e) =>
                    setLeaveType(e.target.value as "paid" | "unpaid" | "short")
                  }
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-medium"
                >
                  <option value="paid">Paid Leave (No Deduction)</option>
                  <option value="unpaid">Unpaid Leave (Full Day Deduct)</option>
                  <option value="short">Short Leave (Hourly Deduct)</option>
                </select>
              </div>

              {leaveType === "short" ? (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
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
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Reason (Optional)
                  </label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Optional note"
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm"
                  />
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={submitting || employees.length === 0}
                  className="w-full rounded-2xl btn-3d-primary py-2.5 px-4 text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Assign Manual Leave"}
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {/* TABLE FOR ACTIVE TAB */}
        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/40 dark:border-white/10 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <CalendarOff className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                  {tabs.find((t) => t.id === activeTab)?.label} Ledger (
                  {selectedMonth})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Showing Employee Name, Employee ID, Leave Type, Paid/Unpaid
                  Status, and Salary Impact
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/40 dark:border-white/10 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-white/30 dark:bg-slate-900/40">
                  <th className="py-3.5 px-5">Date</th>
                  <th className="py-3.5 px-5">Employee &amp; Request</th>
                  <th className="py-3.5 px-5">Paid / Unpaid Status</th>
                  <th className="py-3.5 px-5">Salary Impact</th>
                  <th className="py-3.5 px-5">Reason (Optional)</th>
                  <th className="py-3.5 px-5">Approval Status</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/30 dark:divide-white/5 text-sm">
                {activeRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-12 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No records in &ldquo;
                      {tabs.find((t) => t.id === activeTab)?.label}&rdquo; for{" "}
                      {selectedMonth}.
                    </td>
                  </tr>
                ) : (
                  activeRows.map((lv) => {
                    const { name, code } = resolveEmployeeInfo(lv);
                    const deduction = calculateLeaveDeductionPreview(lv);
                    const requestedLabel =
                      lv.leave_category ||
                      (lv.leave_type === "paid"
                        ? "Paid Leave"
                        : lv.leave_type === "unpaid"
                        ? "Unpaid Leave"
                        : "Short Leave");

                    return (
                      <tr
                        key={lv.id}
                        className="hover:bg-white/30 dark:hover:bg-white/5 transition"
                      >
                        <td className="py-3.5 px-5 font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
                          {lv.date}
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {name}{" "}
                            <span className="font-mono text-xs font-normal text-indigo-600 dark:text-indigo-400">
                              ({code})
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Employee {name} requested {requestedLabel} for{" "}
                            {lv.date}
                          </div>
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {lv.leave_type === "paid" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:text-emerald-200">
                                Paid Leave
                              </span>
                            )}
                            {lv.leave_type === "unpaid" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 border border-rose-400/40 px-2.5 py-0.5 text-xs font-medium text-rose-900 dark:text-rose-200">
                                Unpaid Leave
                              </span>
                            )}
                            {lv.leave_type === "short" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-400/40 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                                <Clock className="w-3 h-3" />
                                Short ({Number(lv.hours_missed || 0).toFixed(1)}
                                h)
                              </span>
                            )}

                            {/* Quick Paid/Unpaid switcher for Admin */}
                            {lv.leave_type !== "short" && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleTogglePaidType(
                                    lv.id,
                                    lv.leave_type === "paid" ? "unpaid" : "paid"
                                  )
                                }
                                disabled={actionBusyId === `${lv.id}-type`}
                                className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                Switch to{" "}
                                {lv.leave_type === "paid" ? "Unpaid" : "Paid"}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-5 font-mono text-xs font-medium">
                          {deduction === 0 ? (
                            <span className="text-emerald-700 dark:text-emerald-300">
                              0 (Paid / No Deduct)
                            </span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-300">
                              -{deduction.toLocaleString()}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-xs text-slate-600 dark:text-slate-300 max-w-xs truncate">
                          {lv.reason || "—"}
                        </td>
                        <td className="py-3.5 px-5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase ${
                              lv.status === "approved"
                                ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200"
                                : lv.status === "rejected"
                                ? "bg-rose-500/20 text-rose-800 dark:text-rose-200"
                                : "bg-amber-500/20 text-amber-900 dark:text-amber-200"
                            }`}
                          >
                            {lv.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {lv.status !== "approved" && (
                              <>
                                <button
                                  onClick={() =>
                                    handleLeaveDecision(
                                      lv.id,
                                      "approved",
                                      "paid"
                                    )
                                  }
                                  title="Approve as Paid Leave"
                                  className="btn-3d-emerald px-2.5 py-1 rounded-xl text-xs font-medium inline-flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Paid
                                </button>
                                <button
                                  onClick={() =>
                                    handleLeaveDecision(
                                      lv.id,
                                      "approved",
                                      "unpaid"
                                    )
                                  }
                                  title="Approve as Unpaid Leave"
                                  className="btn-3d-amber px-2.5 py-1 rounded-xl text-xs font-medium inline-flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Unpaid
                                </button>
                              </>
                            )}
                            {lv.status !== "rejected" && (
                              <button
                                onClick={() =>
                                  handleLeaveDecision(lv.id, "rejected")
                                }
                                title="Reject Leave"
                                className="btn-3d-rose px-2.5 py-1 rounded-xl text-xs font-medium inline-flex items-center gap-1"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Reject
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteLeave(lv.id)}
                              title="Delete Leave Record"
                              className="btn-3d-glass p-1.5 rounded-xl text-rose-600 dark:text-rose-400"
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
