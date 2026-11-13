"use client";

import React, { useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { adminFetch } from "@/lib/adminFetch";
import { calculateShiftDurationHours } from "@/lib/pktTime";
import {
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Users,
  Loader2,
  Calculator,
} from "lucide-react";

export default function AddEmployeePage() {
  const [fullName, setFullName] = useState<string>("");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [password, setPassword] = useState<string>("");

  const [basicSalary, setBasicSalary] = useState<string>("");
  const [dutyStartTime, setDutyStartTime] = useState<string>("09:00");
  const [dutyEndTime, setDutyEndTime] = useState<string>("17:00");
  const [perDayDeduction, setPerDayDeduction] = useState<string>("");
  const [hourlyRate, setHourlyRate] = useState<string>("");
  const [overtimeRate, setOvertimeRate] = useState<string>("");

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");

  const recalculateRates = (
    salaryVal: string,
    startVal: string,
    endVal: string
  ) => {
    const sal = parseFloat(salaryVal);
    if (Number.isNaN(sal) || sal <= 0) return;

    const shiftHours = calculateShiftDurationHours(startVal, endVal);
    const calcPerDay = Math.round((sal / 30) * 100) / 100;
    const calcHourly = Math.round((calcPerDay / shiftHours) * 100) / 100;

    setPerDayDeduction(String(calcPerDay));
    setHourlyRate(String(calcHourly));
    if (!overtimeRate) {
      setOvertimeRate(String(calcHourly));
    }
  };

  const handleSalaryChange = (val: string) => {
    setBasicSalary(val);
    recalculateRates(val, dutyStartTime, dutyEndTime);
  };

  const handleDutyStartChange = (val: string) => {
    setDutyStartTime(val);
    recalculateRates(basicSalary, val, dutyEndTime);
  };

  const handleDutyEndChange = (val: string) => {
    setDutyEndTime(val);
    recalculateRates(basicSalary, dutyStartTime, val);
  };

  const handlePerDayDeductionChange = (val: string) => {
    setPerDayDeduction(val);
    const perDay = parseFloat(val);
    if (!Number.isNaN(perDay) && perDay >= 0) {
      const shiftHours = calculateShiftDurationHours(dutyStartTime, dutyEndTime);
      const calcHourly = Math.round((perDay / shiftHours) * 100) / 100;
      setHourlyRate(String(calcHourly));
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setSubmitting(true);

    try {
      const response = await adminFetch("/api/admin/employees", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName.trim(),
          employee_id: employeeId.trim().toUpperCase(),
          password: password.trim(),
          basic_salary: parseFloat(basicSalary || "0") || 0,
          monthly_salary: parseFloat(basicSalary || "0") || 0,
          per_day_deduction: parseFloat(perDayDeduction || "0") || 0,
          hourly_rate: parseFloat(hourlyRate || "0") || 0,
          overtime_rate:
            parseFloat(overtimeRate || hourlyRate || "0") || 0,
          duty_start_time: dutyStartTime,
          duty_end_time: dutyEndTime,
        }),
      });

      let result: { error?: string; message?: string; employee?: unknown } = {};
      try {
        result = await response.json();
      } catch {
        throw new Error(
          `Server returned status ${response.status} without valid JSON.`
        );
      }

      if (!response.ok || result.error) {
        setErrorMsg(
          result.error ||
            `Failed to create employee (HTTP ${response.status}).`
        );
        return;
      }

      setSuccessMsg(
        result.message ||
          `Employee '${fullName.trim()}' (${employeeId
            .trim()
            .toUpperCase()}) added immediately to auth.users & public.users!`
      );
      setFullName("");
      setEmployeeId("");
      setPassword("");
      setBasicSalary("");
      setPerDayDeduction("");
      setHourlyRate("");
      setOvertimeRate("");
    } catch (err: unknown) {
      const actualReason =
        err instanceof Error
          ? err.message
          : "Network or server error while creating employee.";
      setErrorMsg(actualReason);
    } finally {
      setSubmitting(false);
    }
  };

  const shiftHours = calculateShiftDurationHours(dutyStartTime, dutyEndTime);

  return (
    <AdminShell
      title="Add New Employee"
      subtitle="Creates employee in auth.users and public.users immediately (no approval required to add; approval only applies on first device login)"
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {errorMsg && (
          <div
            role="alert"
            className="glass-panel rounded-3xl border-rose-400/50 p-5 text-rose-900 dark:text-rose-100"
          >
            <div className="flex items-start gap-3.5">
              <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                <h3 className="text-sm font-extrabold">
                  Error: Employee Could Not Be Saved
                </h3>
                <p className="text-xs font-medium leading-relaxed break-words">
                  {errorMsg}
                </p>
              </div>
            </div>
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="glass-panel rounded-3xl border-emerald-400/50 p-5 text-emerald-950 dark:text-emerald-100"
          >
            <div className="flex items-start gap-3.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-2.5 flex-1">
                <h3 className="text-sm font-extrabold">
                  Employee Added Immediately
                </h3>
                <p className="text-xs font-medium">{successMsg}</p>
                <div className="pt-1">
                  <Link
                    href="/admin/employees"
                    className="btn-3d-emerald inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold"
                  >
                    <Users className="w-4 h-4" />
                    View Employees &amp; Payroll &rarr;
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-7 py-5 border-b border-white/40 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Employee Account &amp; Compensation Form
                </h2>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Hourly rate auto-calculates from Per-Day Deduction &divide;{" "}
                  {shiftHours}h shift duration
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-xl glass-card-3d px-3.5 py-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
              <Calculator className="w-3.5 h-3.5" />
              Shift: {shiftHours} hrs/day
            </span>
          </div>

          <form onSubmit={handleCreateEmployee} className="p-7 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Muhammad Usman"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Employee ID *
                </label>
                <input
                  type="text"
                  required
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
                  placeholder="e.g. EMP001"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Password (Min 6 chars) *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Set login password"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-medium"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/40 dark:border-slate-700/60">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Duty Start Time (PKT) *
                </label>
                <input
                  type="time"
                  required
                  value={dutyStartTime}
                  onChange={(e) => handleDutyStartChange(e.target.value)}
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Duty End Time (PKT) *
                </label>
                <input
                  type="time"
                  required
                  value={dutyEndTime}
                  onChange={(e) => handleDutyEndChange(e.target.value)}
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-white/40 dark:border-slate-700/60">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Basic Salary *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={basicSalary}
                  onChange={(e) => handleSalaryChange(e.target.value)}
                  placeholder="e.g. 60000"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 mt-1">
                  Monthly basic salary
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Per-Day Deduction *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={perDayDeduction}
                  onChange={(e) => handlePerDayDeductionChange(e.target.value)}
                  placeholder="e.g. 2000"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 mt-1">
                  Deducted per Unpaid Leave
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Hourly Rate (Short Leave) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="Auto-calculated"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 mt-1">
                  Deducted per missed hour
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-2">
                  Overtime Rate / Hr *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={overtimeRate}
                  onChange={(e) => setOvertimeRate(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 mt-1">
                  Added per overtime hour
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl btn-3d-primary py-3.5 text-sm font-extrabold disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating Employee in Auth &amp; Database...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Add Employee Immediately
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </AdminShell>
  );
}
