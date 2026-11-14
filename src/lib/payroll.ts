export interface PayEmployee { requires_rate_review?: boolean; basic_salary?: number; monthly_salary: number; per_day_deduction: number; hourly_rate: number; overtime_rate: number }
export interface PayAttendance { date: string; clock_in?: string | null; clock_out?: string | null; login_time?: string | null; logout_time?: string | null; overtime_hours: number }
export interface PayLeave { date: string; status: string; leave_type: string; hours_missed: number }
const units = (n: number | undefined) => Math.round(Math.max(0, Number.isFinite(Number(n)) ? Number(n) : 0) * 100);
export function calculatePayroll(employee: PayEmployee, month: string, attendance: PayAttendance[], leaves: PayLeave[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid payroll month.");
  const issues: string[] = [];
  if (employee.requires_rate_review) issues.push("Salary/rates changed during or after this report month. Effective-date allocation requires payroll review; PDF export is held.");
  const finite = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0;
  const basic = employee.basic_salary ?? employee.monthly_salary;
  for (const [label,value] of Object.entries({ basic, daily: employee.per_day_deduction, hourly: employee.hourly_rate, overtime: employee.overtime_rate })) if (!finite(value)) issues.push(`Invalid ${label} rate; review before payment.`);
  const days = new Set<string>(); const leaveDates = new Set<string>();
  const approved = leaves.filter(l => l.date.startsWith(month + "-") && l.status === "approved");
  const fullDates = new Set(approved.filter(l => l.leave_type !== "short").map(l => l.date));
  let paidLeaves = 0, unpaidLeaves = 0, shortUnits = 0, overtimeUnits = 0;
  for (const l of approved) {
    if (leaveDates.has(l.date)) { issues.push(`Duplicate leave on ${l.date}.`); continue; } leaveDates.add(l.date);
    if (l.leave_type === "paid") paidLeaves++;
    else if (l.leave_type === "unpaid") unpaidLeaves++;
    else if (l.leave_type === "short") { if (!finite(l.hours_missed) || Number(l.hours_missed) > 24) issues.push(`Invalid short-leave hours on ${l.date}.`); else shortUnits += units(l.hours_missed); }
    else issues.push(`Unknown leave type on ${l.date}.`);
  }
  const seen = new Set<string>();
  for (const row of attendance.filter(r => r.date.startsWith(month + "-"))) {
    if (seen.has(row.date)) { issues.push(`Duplicate attendance on ${row.date}.`); continue; } seen.add(row.date);
    const inTime = row.clock_in || row.login_time;
    if (fullDates.has(row.date)) {
      if (inTime || Number(row.overtime_hours) > 0) issues.push(`Attendance overlaps full-day leave on ${row.date}. Reconcile before payment.`);
      continue;
    }
    if (inTime) days.add(row.date); // an OT-only adjustment is not an attended day
    if (!finite(row.overtime_hours)) issues.push(`Invalid overtime on ${row.date}; historical negative values ignored.`);
    else if (Number(row.overtime_hours) > 24) issues.push(`Overtime exceeds 24 hours on ${row.date}.`);
    else overtimeUnits += units(row.overtime_hours);
  }
  const basicCents = units(basic);
  const unpaidCents = unpaidLeaves * units(employee.per_day_deduction);
  const mul = (a: number, b: number) => Number((BigInt(a) * BigInt(b) + BigInt(50)) / BigInt(100));
  const shortCents = mul(shortUnits, units(employee.hourly_rate));
  const otCents = mul(overtimeUnits, units(employee.overtime_rate));
  if (![basicCents, unpaidCents, shortCents, otCents, basicCents - unpaidCents - shortCents + otCents].every(Number.isSafeInteger)) issues.push("Payroll value exceeds safe report precision. Manual financial review required.");
  return { basicSalary: basicCents/100, daysAttended: days.size, paidLeaves, totalPresentDays: days.size + paidLeaves, totalAbsentDays: unpaidLeaves,
    shortLeaveHours: shortUnits/100, totalOvertimeHours: overtimeUnits/100, unpaidDeduction: unpaidCents/100, shortLeaveDeduction: shortCents/100, overtimePay: otCents/100,
    finalSalary: Math.max(0, basicCents - unpaidCents - shortCents + otCents)/100, issues };
}
