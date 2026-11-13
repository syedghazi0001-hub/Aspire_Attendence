/**
 * ============================================================================
 * PAKISTAN STANDARD TIME (PKT — Asia/Karachi, UTC+5) ENGINE, OVERTIME &
 * SHORT LEAVE (EARLY DEPARTURE MISSED HOURS) CALCULATIONS
 * ============================================================================
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC + 5 hours

export interface PktTimestampInfo {
  isoUtc: string;
  isoPkt: string;
  dateStr: string;         // YYYY-MM-DD in PKT
  time24Str: string;       // HH:MM:SS in PKT
  displayTime: string;     // hh:mm:ss AM/PM PKT
  displayDateTime: string; // YYYY-MM-DD hh:mm:ss AM/PM PKT
  minutesOfDay: number;    // Minutes since 00:00 PKT
}

/**
 * Compute Pakistan Standard Time (UTC+5) from a server UTC Date object.
 */
export function getPktTimeInfo(utcDate: Date = new Date()): PktTimestampInfo {
  const pktShifted = new Date(utcDate.getTime() + PKT_OFFSET_MS);

  const yyyy = pktShifted.getUTCFullYear();
  const mm = String(pktShifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(pktShifted.getUTCDate()).padStart(2, "0");
  const hours24 = pktShifted.getUTCHours();
  const mins = pktShifted.getUTCMinutes();
  const secs = pktShifted.getUTCSeconds();

  const hh24 = String(hours24).padStart(2, "0");
  const minStr = String(mins).padStart(2, "0");
  const secStr = String(secs).padStart(2, "0");

  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const hh12 = String(hours12).padStart(2, "0");

  const dateStr = `${yyyy}-${mm}-${dd}`;
  const time24Str = `${hh24}:${minStr}:${secStr}`;
  const displayTime = `${hh12}:${minStr}:${secStr} ${period} PKT`;
  const displayDateTime = `${dateStr} ${displayTime}`;
  const isoPkt = `${dateStr}T${time24Str}+05:00`;

  const minutesOfDay = hours24 * 60 + mins + secs / 60;

  return {
    isoUtc: utcDate.toISOString(),
    isoPkt,
    dateStr,
    time24Str,
    displayTime,
    displayDateTime,
    minutesOfDay,
  };
}

export function getTodayPktDateString(): string {
  return getPktTimeInfo().dateStr;
}

export function getCurrentMonthPkt(): string {
  return getPktTimeInfo().dateStr.slice(0, 7);
}

export function formatIsoToPktTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "-- : --";
  const parsed = new Date(isoStr);
  if (Number.isNaN(parsed.getTime())) return isoStr;
  return getPktTimeInfo(parsed).displayTime;
}

export function formatPktTime12h(isoStr: string | null | undefined): string {
  return formatIsoToPktTime(isoStr);
}

export function formatIsoToPktDateTime(
  isoStr: string | null | undefined
): string {
  if (!isoStr) return "—";
  const parsed = new Date(isoStr);
  if (Number.isNaN(parsed.getTime())) return isoStr;
  return getPktTimeInfo(parsed).displayDateTime;
}

/**
 * Parse a "HH:MM" or "HH:MM:SS" TIME string into minutes since midnight.
 */
export function parseDutyTimeToMinutes(dutyTimeStr: string): number {
  const parts = (dutyTimeStr || "09:00").trim().split(":");
  const h = parseInt(parts[0] || "9", 10);
  const m = parseInt(parts[1] || "0", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return 9 * 60;
  return h * 60 + m;
}

/**
 * Normalize "HH:MM:SS" from Postgres TIME column into "HH:MM" for <input type="time" />.
 */
export function normalizeTimeInput(dutyTimeStr: string | null | undefined): string {
  if (!dutyTimeStr) return "09:00";
  const parts = dutyTimeStr.trim().split(":");
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  return "09:00";
}

/**
 * Format 24-hour "HH:MM" or "HH:MM:SS" string into "hh:mm AM/PM".
 */
export function formatDutyTime12h(
  dutyTimeStr: string | null | undefined
): string {
  if (!dutyTimeStr) return "09:00 AM";
  const parts = dutyTimeStr.trim().split(":");
  const h = parseInt(parts[0] || "9", 10);
  const m = parseInt(parts[1] || "0", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return dutyTimeStr;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatTime24to12(
  dutyTimeStr: string | null | undefined
): string {
  return formatDutyTime12h(dutyTimeStr);
}

/**
 * Calculate scheduled shift duration in hours (e.g. 09:00 to 17:00 = 8 hours).
 */
export function calculateShiftDurationHours(
  dutyStartStr: string,
  dutyEndStr: string
): number {
  const startMins = parseDutyTimeToMinutes(dutyStartStr);
  let endMins = parseDutyTimeToMinutes(dutyEndStr);
  if (endMins <= startMins) {
    endMins += 24 * 60;
  }
  const diffHours = (endMins - startMins) / 60;
  return Math.max(0.5, Math.round(diffHours * 100) / 100);
}

/**
 * Calculate Overtime AND Short Leave (Early Departure Missed Hours) in PKT:
 * - Overtime: Any work done AFTER Duty End Time is counted as Overtime.
 * - Short Leave: If an employee leaves BEFORE Duty End Time, calculate missed hours.
 */
export function calculateShiftMetricsPkt(
  clockInIso: string,
  clockOutIso: string,
  dutyStartStr: string,
  dutyEndStr: string
): {
  overtimeMinutes: number;
  overtimeHours: number;
  missedMinutes: number;
  missedHours: number;
} {
  const inInfo = getPktTimeInfo(new Date(clockInIso));
  const outInfo = getPktTimeInfo(new Date(clockOutIso));

  const dutyStartMins = parseDutyTimeToMinutes(dutyStartStr);
  let dutyEndMins = parseDutyTimeToMinutes(dutyEndStr);

  if (dutyEndMins <= dutyStartMins) {
    dutyEndMins += 24 * 60;
  }

  let clockInMins = inInfo.minutesOfDay;
  let clockOutMins = outInfo.minutesOfDay;

  if (clockOutMins < clockInMins) {
    clockOutMins += 24 * 60;
  }

  let overtimeMinutes = 0;
  let overtimeHours = 0;
  let missedMinutes = 0;
  let missedHours = 0;

  if (clockOutMins > dutyEndMins) {
    const effectiveOvertimeStart = Math.max(dutyEndMins, clockInMins);
    const rawOvertimeMins = Math.max(0, clockOutMins - effectiveOvertimeStart);
    overtimeMinutes = Math.round(rawOvertimeMins);
    overtimeHours = Math.round((overtimeMinutes / 60) * 100) / 100;
  } else if (clockOutMins < dutyEndMins) {
    // Employee left early (Short Leave)
    const rawMissedMins = Math.max(0, dutyEndMins - clockOutMins);
    missedMinutes = Math.round(rawMissedMins);
    missedHours = Math.round((missedMinutes / 60) * 100) / 100;
  }

  return {
    overtimeMinutes,
    overtimeHours,
    missedMinutes,
    missedHours,
  };
}
