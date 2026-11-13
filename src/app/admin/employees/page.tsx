"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { adminFetch } from "@/lib/adminFetch";
import {
  formatTime24to12,
  getCurrentMonthPkt,
  calculateShiftDurationHours,
} from "@/lib/pktTime";
import { generateMonthlySalaryPdf } from "@/lib/pdfGenerator";
import {
  Users,
  Trash2,
  RefreshCw,
  UserPlus,
  AlertTriangle,
  FileDown,
  Edit3,
  X,
  Save,
} from "lucide-react";

interface EmployeeProfile {
  id: string;
  employee_id: string;
  full_name: string;
  role: string;
  monthly_salary: number;
  basic_salary: number;
  per_day_deduction: number;
  hourly_rate: number;
  overtime_rate: number;
  duty_start_time: string;
  duty_end_time: string;
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
}

interface LeaveRecord {
  id: string;
  user_id: string;
  date: string;
  leave_type: "paid" | "unpaid" | "short";
  hours_missed: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
}

export default function EmployeeListPage() {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(
    getCurrentMonthPkt()
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [editingEmp, setEditingEmp] = useState<EmployeeProfile | null>(null);
  const [editFullName, setEditFullName] = useState<string>("");
  const [editBasicSalary, setEditBasicSalary] = useState<string>("");
  const [editPerDayDeduction, setEditPerDayDeduction] = useState<string>("");
  const [editHourlyRate, setEditHourlyRate] = useState<string>("");
  const [editOvertimeRate, setEditOvertimeRate] = useState<string>("");
  const [editDutyStart, setEditDutyStart] = useState<string>("09:00");
  const [editDutyEnd, setEditDutyEnd] = useState<string>("17:00");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [empRes, attRes, leavesRes] = await Promise.all([
        adminFetch("/api/admin/employees"),
        adminFetch(
          `/api/admin/attendance?month=${encodeURIComponent(selectedMonth)}`
        ),
        adminFetch(
          `/api/admin/leaves?month=${encodeURIComponent(selectedMonth)}`
        ),
      ]);

      const empData = await empRes.json();
      const attData = await attRes.json();
      const leavesData = await leavesRes.json();

      if (!empRes.ok) {
        setErrorMsg(empData.error || "Failed to fetch employee list.");
        return;
      }

      setEmployees(empData.employees || []);
      setAttendance(attData.attendance || []);
      setLeaves(leavesData.leaves || []);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Network error while loading employees.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openEditModal = (emp: EmployeeProfile) => {
    setEditingEmp(emp);
    setEditFullName(emp.full_name);
    const sal = Number(emp.basic_salary || emp.monthly_salary || 0);
    setEditBasicSalary(String(sal));
    setEditPerDayDeduction(String(Number(emp.per_day_deduction || 0)));
    setEditHourlyRate(String(Number(emp.hourly_rate || 0)));
    setEditOvertimeRate(String(Number(emp.overtime_rate || 0)));
    setEditDutyStart((emp.duty_start_time || "09:00").slice(0, 5));
    setEditDutyEnd((emp.duty_end_time || "17:00").slice(0, 5));
  };

  const handleEditSalaryAutoCalc = (val: string) => {
    setEditBasicSalary(val);
    const sal = parseFloat(val);
    if (!Number.isNaN(sal) && sal > 0) {
      const shiftHrs = calculateShiftDurationHours(editDutyStart, editDutyEnd);
      const perDay = Math.round((sal / 30) * 100) / 100;
      const hrRate = Math.round((perDay / shiftHrs) * 100) / 100;
      setEditPerDayDeduction(String(perDay));
      setEditHourlyRate(String(hrRate));
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp) return;
    setSavingEdit(true);
    setErrorMsg("");

    try {
      const res = await adminFetch("/api/admin/employees", {
        method: "PUT",
        body: JSON.stringify({
          id: editingEmp.id,
          employee_id: editingEmp.employee_id,
          full_name: editFullName.trim(),
          basic_salary: parseFloat(editBasicSalary || "0") || 0,
          monthly_salary: parseFloat(editBasicSalary || "0") || 0,
          per_day_deduction: parseFloat(editPerDayDeduction || "0") || 0,
          hourly_rate: parseFloat(editHourlyRate || "0") || 0,
          overtime_rate: parseFloat(editOvertimeRate || "0") || 0,
          duty_start_time: editDutyStart,
          duty_end_time: editDutyEnd,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorMsg(data.error || "Failed to update employee.");
        return;
      }

      setEditingEmp(null);
      await fetchData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to save employee updates.";
      setErrorMsg(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteEmployee = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete employee '${name}' and all associated attendance & leave records?`
      )
    ) {
      return;
    }

    setErrorMsg("");
    try {
      const response = await adminFetch(
        `/api/admin/employees?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const result = await response.json();
      if (!response.ok) {
        setErrorMsg(result.error || "Failed to delete employee.");
        return;
      }
      await fetchData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error deleting employee.";
      setErrorMsg(msg);
    }
  };

  const handleDownloadPdf = (emp: EmployeeProfile) => {
    const empRows = attendance.filter((a) => a.user_id === emp.id);
    const empLeaves = leaves.filter((l) => l.user_id === emp.id);
    generateMonthlySalaryPdf({
      employee: {
        full_name: emp.full_name,
        employee_id: emp.employee_id,
        basic_salary: Number(emp.basic_salary || emp.monthly_salary || 0),
        monthly_salary: Number(emp.monthly_salary || emp.basic_salary || 0),
        per_day_deduction: Number(emp.per_day_deduction || 0),
        hourly_rate: Number(emp.hourly_rate || 0),
        overtime_rate: Number(emp.overtime_rate || 0),
        duty_start_time: emp.duty_start_time || "09:00",
        duty_end_time: emp.duty_end_time || "17:00",
      },
      month: selectedMonth,
      attendanceRows: empRows,
      leaveRows: empLeaves,
    });
  };

  return (
    <AdminShell
      title="Employees & Monthly Payroll"
      subtitle="Generate monthly PDF reports with Present Days, Absent Days, Basic Salary, Overtime Hours, Overtime Pay, and Final Salary"
    >
      <div className="space-y-6">
        {errorMsg && (
          <div className="glass-panel rounded-2xl border-rose-400/50 p-4 text-rose-900 dark:text-rose-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs font-bold">{errorMsg}</div>
          </div>
        )}

        <div className="glass-panel rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-white/40 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl btn-3d-primary">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Registered Employees &amp; Payroll ({employees.length})
                </h2>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Final Salary = Basic &minus; Unpaid Leave Deduction &minus;
                  Short Leave Deduction + Overtime Pay
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Month:
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="rounded-xl glass-input px-3.5 py-1.5 text-xs font-mono font-bold"
                />
              </div>

              <button
                onClick={fetchData}
                className="btn-3d-glass rounded-xl px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </button>

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
                  <th className="py-3.5 px-4">Employee</th>
                  <th className="py-3.5 px-4">Shift (PKT)</th>
                  <th className="py-3.5 px-4">Basic Salary</th>
                  <th className="py-3.5 px-4">Present Days</th>
                  <th className="py-3.5 px-4">Absent (Unpaid)</th>
                  <th className="py-3.5 px-4">Short Leave</th>
                  <th className="py-3.5 px-4">Overtime</th>
                  <th className="py-3.5 px-4">Final Salary</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/30 dark:divide-slate-700/50 text-sm">
                {employees.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-12 text-center text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      No employees registered yet. Click{" "}
                      <Link
                        href="/admin/add-employee"
                        className="text-indigo-700 dark:text-indigo-300 font-bold underline"
                      >
                        Add Employee
                      </Link>{" "}
                      to create one.
                    </td>
                  </tr>
                ) : (
                  employees.map((emp) => {
                    const empAtt = attendance.filter(
                      (a) => a.user_id === emp.id
                    );
                    const empLeaves = leaves.filter(
                      (l) => l.user_id === emp.id && l.status === "approved"
                    );

                    const basicSal = Number(
                      emp.basic_salary || emp.monthly_salary || 0
                    );
                    const perDayRate = Number(emp.per_day_deduction || 0);
                    const hrRate = Number(emp.hourly_rate || 0);
                    const otRate = Number(emp.overtime_rate || hrRate || 0);

                    const daysAttended = empAtt.length;
                    const paidLeaves = empLeaves.filter(
                      (l) => l.leave_type === "paid"
                    ).length;
                    const totalPresentDays = daysAttended + paidLeaves;

                    const totalAbsentDays = empLeaves.filter(
                      (l) => l.leave_type === "unpaid"
                    ).length;

                    const shortLeaveHours = empLeaves
                      .filter((l) => l.leave_type === "short")
                      .reduce((s, l) => s + Number(l.hours_missed || 0), 0);

                    const totalOtHours =
                      Math.round(
                        empAtt.reduce(
                          (s, r) => s + Math.max(0, Number(r.overtime_hours || 0)),
                          0
                        ) * 100
                      ) / 100;

                    const unpaidDeduct =
                      Math.round(totalAbsentDays * perDayRate * 100) / 100;
                    const shortDeduct =
                      Math.round(shortLeaveHours * hrRate * 100) / 100;
                    const otPay =
                      Math.round(totalOtHours * otRate * 100) / 100;

                    const finalSalary = Math.max(
                      0,
                      Math.round(
                        (basicSal - unpaidDeduct - shortDeduct + otPay) * 100
                      ) / 100
                    );

                    return (
                      <tr
                        key={emp.id}
                        className="hover:bg-white/30 dark:hover:bg-slate-800/30 transition"
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-800 dark:text-white">
                            {emp.full_name}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {formatTime24to12(emp.duty_start_time || "09:00")} -{" "}
                          {formatTime24to12(emp.duty_end_time || "17:00")}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs">
                          <div className="font-bold text-slate-800 dark:text-white">
                            {basicSal.toLocaleString()}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400">
                            {perDayRate.toLocaleString()}/day &bull;{" "}
                            {hrRate.toLocaleString()}/hr
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          <span className="font-extrabold text-slate-800 dark:text-white">
                            {totalPresentDays} days
                          </span>
                          {paidLeaves > 0 && (
                            <span className="ml-1.5 inline-flex rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-200">
                              ({paidLeaves} Paid)
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs">
                          {totalAbsentDays > 0 ? (
                            <div>
                              <span className="font-bold text-rose-700 dark:text-rose-300">
                                {totalAbsentDays} day
                                {totalAbsentDays > 1 ? "s" : ""} (-
                                {unpaidDeduct.toLocaleString()})
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500">0 days</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs">
                          {shortLeaveHours > 0 ? (
                            <div>
                              <span className="font-bold text-amber-700 dark:text-amber-300">
                                -{shortDeduct.toLocaleString()}
                              </span>
                              <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                                ({shortLeaveHours.toFixed(2)}h missed)
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs">
                          {totalOtHours > 0 ? (
                            <div>
                              <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                +{otPay.toLocaleString()}
                              </span>
                              <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                                ({totalOtHours.toFixed(2)}h OT)
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500">0.00h</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-sm font-extrabold text-indigo-700 dark:text-indigo-300">
                          {finalSalary.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => openEditModal(emp)}
                              title="Edit Salary & Shift"
                              className="btn-3d-glass rounded-xl px-2.5 py-1.5 text-xs font-bold inline-flex items-center gap-1"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDownloadPdf(emp)}
                              title="Download Monthly Salary PDF Report"
                              className="btn-3d-primary rounded-xl px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                              PDF
                            </button>
                            <button
                              onClick={() =>
                                handleDeleteEmployee(emp.id, emp.full_name)
                              }
                              title="Delete Employee"
                              className="btn-3d-rose rounded-xl px-2.5 py-1.5 text-xs font-bold inline-flex items-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

      {/* Frosted 3D Glass Edit Employee Modal */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-md flex items-center justify-center p-4 animate-keynote-in">
          <div className="w-full max-w-lg glass-panel rounded-3xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/40 dark:border-slate-700/60 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-800 dark:text-white">
                  Edit Compensation &amp; Shift ({editingEmp.employee_id})
                </h3>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Update Basic Salary, Per-Day Deduction, Overtime Rate, or PKT
                  Shift
                </p>
              </div>
              <button
                onClick={() => setEditingEmp(null)}
                className="btn-3d-glass p-1.5 rounded-xl"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 dark:text-slate-200 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 dark:text-slate-200 mb-1">
                    Duty Start (PKT)
                  </label>
                  <input
                    type="time"
                    required
                    value={editDutyStart}
                    onChange={(e) => setEditDutyStart(e.target.value)}
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 dark:text-slate-200 mb-1">
                    Duty End (PKT)
                  </label>
                  <input
                    type="time"
                    required
                    value={editDutyEnd}
                    onChange={(e) => setEditDutyEnd(e.target.value)}
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 dark:text-slate-200 mb-1">
                    Basic Salary
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={editBasicSalary}
                    onChange={(e) => handleEditSalaryAutoCalc(e.target.value)}
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 dark:text-slate-200 mb-1">
                    Per-Day Deduction
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={editPerDayDeduction}
                    onChange={(e) => setEditPerDayDeduction(e.target.value)}
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 dark:text-slate-200 mb-1">
                    Hourly Rate (Short Leave)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={editHourlyRate}
                    onChange={(e) => setEditHourlyRate(e.target.value)}
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 dark:text-slate-200 mb-1">
                    Overtime Rate / Hr
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={editOvertimeRate}
                    onChange={(e) => setEditOvertimeRate(e.target.value)}
                    className="w-full rounded-2xl glass-input px-3.5 py-2.5 text-sm font-mono font-bold"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/40 dark:border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setEditingEmp(null)}
                  className="btn-3d-glass rounded-xl px-4 py-2 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="btn-3d-primary rounded-xl px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
