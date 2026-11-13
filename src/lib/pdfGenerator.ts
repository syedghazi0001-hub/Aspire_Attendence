import { jsPDF } from "jspdf";
import { formatPktTime12h, formatTime24to12 } from "@/lib/pktTime";

export interface PdfEmployeeInfo {
  full_name: string;
  employee_id: string;
  monthly_salary: number;
  basic_salary?: number;
  per_day_deduction: number;
  hourly_rate: number;
  overtime_rate: number;
  duty_start_time: string;
  duty_end_time: string;
}

export interface PdfAttendanceRow {
  date: string;
  login_time: string | null;
  logout_time: string | null;
  status: string;
  overtime_hours: number;
  overtime_minutes?: number;
  missed_hours?: number;
}

export interface PdfLeaveRow {
  date: string;
  leave_type: "paid" | "unpaid" | "short";
  hours_missed: number;
  reason: string;
  status: string;
}

export function generateMonthlySalaryPdf({
  employee,
  month,
  attendanceRows,
  leaveRows = [],
}: {
  employee: PdfEmployeeInfo;
  month: string; // YYYY-MM
  attendanceRows: PdfAttendanceRow[];
  leaveRows?: PdfLeaveRow[];
}) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const basicSalary = Number(
    employee.basic_salary || employee.monthly_salary || 0
  );
  const perDayDeduction = Number(employee.per_day_deduction || 0);
  const hourlyRate = Number(employee.hourly_rate || 0);
  const overtimeRate = Number(employee.overtime_rate || hourlyRate || 0);

  const approvedLeaves = leaveRows.filter((l) => l.status === "approved");
  const paidLeavesCount = approvedLeaves.filter(
    (l) => l.leave_type === "paid"
  ).length;
  const unpaidLeavesCount = approvedLeaves.filter(
    (l) => l.leave_type === "unpaid"
  ).length;
  const shortLeaveHours = approvedLeaves
    .filter((l) => l.leave_type === "short")
    .reduce((sum, l) => sum + Number(l.hours_missed || 0), 0);

  const daysAttended = attendanceRows.length;
  // Paid Leave = No deduction, no absent mark (counts toward Total Present Days)
  const totalPresentDays = daysAttended + paidLeavesCount;
  // Unpaid Leave = Per-day deduction applied, absent mark
  const totalAbsentDays = unpaidLeavesCount;

  const totalOvertimeHours =
    Math.round(
      attendanceRows.reduce(
        (sum, r) => sum + Number(r.overtime_hours || 0),
        0
      ) * 100
    ) / 100;

  const unpaidDeduction =
    Math.round(totalAbsentDays * perDayDeduction * 100) / 100;
  const shortLeaveDeduction =
    Math.round(shortLeaveHours * hourlyRate * 100) / 100;
  const overtimePay =
    Math.round(totalOvertimeHours * overtimeRate * 100) / 100;

  const finalSalary = Math.max(
    0,
    Math.round(
      (basicSalary -
        unpaidDeduction -
        shortLeaveDeduction +
        overtimePay) *
        100
    ) / 100
  );

  // Header Banner (Keynote Slate-Indigo)
  doc.setFillColor(39, 53, 73);
  doc.rect(0, 0, 210, 38, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("MONTHLY ATTENDANCE & SALARY REPORT", 14, 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(
    `Payroll Month: ${month}   |   Timezone: Pakistan Standard Time (Asia/Karachi, UTC+5)`,
    14,
    23
  );
  doc.text(
    `Duty Shift: ${formatTime24to12(employee.duty_start_time)} - ${formatTime24to12(
      employee.duty_end_time
    )}`,
    14,
    30
  );

  // Summary Card containing all required PDF Report fields
  doc.setTextColor(30, 41, 59);
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, 44, 182, 52, 3, 3, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Employee Name: ${employee.full_name}`, 19, 53);
  doc.text(`Employee ID: ${employee.employee_id}`, 130, 53);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(
    `Total Present Days: ${totalPresentDays} (${daysAttended} Attended + ${paidLeavesCount} Paid Leave)`,
    19,
    61
  );
  doc.text(`Total Absent Days: ${totalAbsentDays} (Unpaid Leave)`, 130, 61);

  doc.text(`Basic Salary: ${basicSalary.toLocaleString()}`, 19, 68);
  doc.text(
    `Overtime Hours: ${totalOvertimeHours.toFixed(2)} hrs`,
    85,
    68
  );
  doc.text(`Overtime Pay: +${overtimePay.toLocaleString()}`, 140, 68);

  doc.text(
    `Unpaid Leave Deduction: -${unpaidDeduction.toLocaleString()} (${perDayDeduction.toLocaleString()}/day)`,
    19,
    75
  );
  doc.text(
    `Short Leave Deduction: -${shortLeaveDeduction.toLocaleString()} (${shortLeaveHours.toFixed(
      2
    )}h @ ${hourlyRate.toLocaleString()}/hr)`,
    115,
    75
  );

  doc.setDrawColor(148, 163, 184);
  doc.line(19, 80, 190, 80);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(67, 56, 202);
  doc.text(`Final Salary: ${finalSalary.toLocaleString()}`, 19, 89);

  // Attendance Table Header
  let y = 104;
  doc.setFillColor(226, 232, 240);
  doc.setTextColor(30, 41, 59);
  doc.rect(14, y, 182, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("Date (PKT)", 17, y + 5.5);
  doc.text("Clock In", 50, y + 5.5);
  doc.text("Clock Out", 84, y + 5.5);
  doc.text("Short Leave (h)", 118, y + 5.5);
  doc.text("Overtime (h)", 148, y + 5.5);
  doc.text("Overtime Pay", 173, y + 5.5);

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);

  const sortedRows = [...attendanceRows].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (sortedRows.length === 0) {
    doc.setTextColor(100, 116, 139);
    doc.text(
      "No daily attendance logs recorded for this employee in the selected month.",
      17,
      y + 8
    );
  } else {
    sortedRows.forEach((row, index) => {
      if (y > 265) {
        doc.addPage();
        y = 20;
      }

      if (index % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(14, y, 182, 7.5, "F");
      }

      const otHrs = Number(row.overtime_hours || 0);
      const missedHrs = Number(row.missed_hours || 0);
      const rowOtPay = Math.round(otHrs * overtimeRate * 100) / 100;

      doc.setTextColor(30, 41, 59);
      doc.text(row.date, 17, y + 5);
      doc.text(formatPktTime12h(row.login_time), 50, y + 5);
      doc.text(formatPktTime12h(row.logout_time), 84, y + 5);
      doc.text(
        missedHrs > 0 ? `${missedHrs.toFixed(2)}h` : "0.00h",
        118,
        y + 5
      );
      doc.text(`${otHrs.toFixed(2)}h`, 148, y + 5);
      doc.text(`${rowOtPay.toLocaleString()}`, 173, y + 5);

      y += 7.5;
    });
  }

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "Generated by PulseHR Cloud Attendance & Payroll Suite (Asia/Karachi PKT)",
    14,
    287
  );

  const safeName = employee.employee_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`Salary_Report_${safeName}_${month}.pdf`);
}
