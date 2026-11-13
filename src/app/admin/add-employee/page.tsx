"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import AdminShell from "@/components/AdminShell";
import { adminFetch } from "@/lib/adminFetch";
import { calculateShiftDurationHours } from "@/lib/pktTime";
import {
  STRICT_EMPLOYEE_ID_REGEX,
  normalizeEmployeeIdFormat,
} from "@/lib/geo";
import {
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Users,
  Loader2,
  Calculator,
  Sparkles,
} from "lucide-react";

export default function AddEmployeePage() {
  const [fullName, setFullName] = useState<string>("");
  const [employeeId, setEmployeeId] = useState<string>("EMP 01");
  const [suggestedId, setSuggestedId] = useState<string>("EMP 01");
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

  const fetchNextEmployeeId = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/employees");
      const data = await res.json();
      if (res.ok && data.next_employee_id) {
        setSuggestedId(data.next_employee_id);
        setEmployeeId(data.next_employee_id);
      }
    } catch {
      // Keep default EMP 01
    }
  }, []);

  useEffect(() => {
    fetchNextEmployeeId();
  }, [fetchNextEmployeeId]);

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

  const handleEmployeeIdBlur = () => {
    const formatted = normalizeEmployeeIdFormat(employeeId);
    if (formatted) {
      setEmployeeId(formatted);
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const normalizedId = normalizeEmployeeIdFormat(employeeId);
    setEmployeeId(normalizedId);

    if (!STRICT_EMPLOYEE_ID_REGEX.test(normalizedId)) {
      setErrorMsg(
        `Invalid Employee ID format ('${employeeId}'). Please use the strict pattern: EMP 01, EMP 02, EMP 03, etc.`
      );
      return;
    }

    setSubmitting(true);

    try {
      const response = await adminFetch("/api/admin/employees", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName.trim(),
          employee_id: normalizedId,
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

      let result: {
        error?: string;
        message?: string;
        employee?: unknown;
        next_employee_id?: string;
      } = {};
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

      const nextId = result.next_employee_id || suggestedId;
      setSuggestedId(nextId);
      setEmployeeId(nextId);

      setSuccessMsg(
        result.message ||
          `Employee '${fullName.trim()}' (${normalizedId}) added immediately!`
      );
      setFullName("");
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
      subtitle="Strict 'EMP 01' ID pattern with automatic next-ID suggestion and duplicate name/ID protection"
    >
      <div className="max-w-3xl mx-auto space-y-6">
        <AnimatePresence mode="wait">
          {errorMsg && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              role="alert"
              className="glass-panel rounded-3xl border-rose-400/50 p-5 text-rose-900 dark:text-rose-200"
            >
              <div className="flex items-start gap-3.5">
                <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <h3 className="text-sm font-semibold">
                    Validation or Database Error
                  </h3>
                  <p className="text-xs leading-relaxed break-words">
                    {errorMsg}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {successMsg && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              role="status"
              className="glass-panel rounded-3xl border-emerald-400/50 p-5 text-emerald-950 dark:text-emerald-200"
            >
              <div className="flex items-start gap-3.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div className="space-y-2.5 flex-1">
                  <h3 className="text-sm font-semibold">
                    Employee Created &amp; Auto-Confirmed
                  </h3>
                  <p className="text-xs">{successMsg}</p>
                  <div className="pt-1">
                    <Link
                      href="/admin/employees"
                      className="btn-3d-emerald inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium"
                    >
                      <Users className="w-4 h-4" />
                      View Employees &amp; Payroll &rarr;
                    </Link>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-3xl overflow-hidden"
        >
          <div className="px-7 py-5 border-b border-white/40 dark:border-white/10 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                  Employee Onboarding &amp; Shift Configuration
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Next available Employee ID auto-suggested: {suggestedId}
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-xl glass-card-3d px-3.5 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              <Calculator className="w-3.5 h-3.5" />
              Shift Duration: {shiftHours} hrs/day
            </span>
          </div>

          <form onSubmit={handleCreateEmployee} className="p-7 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Muhammad Usman"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Must be unique across employees
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Employee ID *
                  </label>
                  <button
                    type="button"
                    onClick={() => setEmployeeId(suggestedId)}
                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    Use {suggestedId}
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
                  onBlur={handleEmployeeIdBlur}
                  placeholder="e.g. EMP 01"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-semibold uppercase"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Strict format: EMP 01, EMP 02, EMP 03
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
                  Password (Min 6 chars) *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Set login password"
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/40 dark:border-white/10">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
                  Duty Start Time (PKT) *
                </label>
                <input
                  type="time"
                  required
                  value={dutyStartTime}
                  onChange={(e) => handleDutyStartChange(e.target.value)}
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
                  Duty End Time (PKT) *
                </label>
                <input
                  type="time"
                  required
                  value={dutyEndTime}
                  onChange={(e) => handleDutyEndChange(e.target.value)}
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-white/40 dark:border-white/10">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
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
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Monthly basic salary
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
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
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Deducted per Unpaid Leave
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
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
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Deducted per missed hour
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
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
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-medium"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Added per overtime hour
                </p>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl btn-3d-primary py-3.5 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating Employee in Auth &amp; Database...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Add Employee ({employeeId || suggestedId})
                </>
              )}
            </motion.button>
          </form>
        </motion.div>
      </div>
    </AdminShell>
  );
}
