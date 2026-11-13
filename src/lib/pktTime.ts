/**
 * ============================================================================
 * PAKISTAN STANDARD TIME (PKT — Asia/Karachi, UTC+5) ENGINE &
 * STRICT OVERTIME CALCULATION
 * Formula: Overtime = max(0, CheckOutTime - max(DutyEndTime, CheckInTime))
 * - Arriving early (before DutyStartTime) NEVER counts as overtime.
 * - Only time worked AFTER DutyEndTime counts as overtime.
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
  const cleaned = (dutyTimeStr || "09:00").trim();
  const isPm = /PM/i.test(cleaned);
  const isAm = /AM/i.test(cleaned);
  const timeOnly = cleaned.replace(/[AP]M/gi, "").trim();
  const parts = timeOnly.split(":");

  let h = parseInt(parts[0] || "9", 10);
  const m = parseInt(parts[1] || "0", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return 9 * 60;

  if (isPm && h < 12) h += 12;
  if (isAm && h === 12) h = 0;

  return h * 60 + m;
}

/**
 * Resolves start and end duty minutes on a 24-hour clock.
 * Prevents the common bug where "09:00" start and "05:00" end (intended as 5:00 PM = 17:00)
 * was misinterpreted as 5:00 AM the next day (20-hour shift, causing -16h diffs).
 */
export function resolveShiftWindowMinutes(
  dutyStartStr: string,
  dutyEndStr: string
): { dutyStartMins: number; dutyEndMins: number } {
  const dutyStartMins = parseDutyTimeToMinutes(dutyStartStr || "09:00");
  let dutyEndMins = parseDutyTimeToMinutes(dutyEndStr || "17:00");

  if (dutyEndMins <= dutyStartMins) {
    // If start is morning/midday (06:00 - 12:59) and end was entered as 01:00 - 08:59 (e.g. 05:00 instead of 17:00),
    // treat end as PM (+12 hours = 720 mins) rather than next day AM (+24 hours).
    if (
      dutyStartMins >= 6 * 60 &&
      dutyStartMins < 13 * 60 &&
      dutyEndMins >= 1 * 60 &&
      dutyEndMins <= 8 * 60
    ) {
      dutyEndMins += 12 * 60;
    } else {
      // True overnight shift (e.g. 20:00 to 04:00)
      dutyEndMins += 24 * 60;
    }
  }

  return { dutyStartMins, dutyEndMins };
}

/**
 * Normalize "HH:MM:SS" from Postgres TIME column into "HH:MM" for <input type="time" />.
 */
export function normalizeTimeInput(
  dutyTimeStr: string | null | undefined
): string {
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
  const { dutyStartMins, dutyEndMins } = resolveShiftWindowMinutes(
    dutyStartStr,
    dutyEndStr
  );
  const diffHours = (dutyEndMins - dutyStartMins) / 60;
  return Math.max(0.5, Math.round(diffHours * 100) / 100);
}

/**
 * STRICT OVERTIME CALCULATION (PKT):
 * - Overtime = max(0, CheckOutTime - max(DutyEndTime, CheckInTime))
 * - Arriving early (before DutyStartTime) does NOT count as overtime.
 * - Only time worked AFTER DutyEndTime is overtime.
 * - Never returns negative numbers.
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
  const inDate = new Date(clockInIso);
  const outDate = new Date(clockOutIso);

  if (
    Number.isNaN(inDate.getTime()) ||
    Number.isNaN(outDate.getTime()) ||
    outDate.getTime() <= inDate.getTime()
  ) {
    return {
      overtimeMinutes: 0,
      overtimeHours: 0,
      missedMinutes: 0,
      missedHours: 0,
    };
  }

  const inInfo = getPktTimeInfo(inDate);
  const outInfo = getPktTimeInfo(outDate);

  const { dutyEndMins } = resolveShiftWindowMinutes(dutyStartStr, dutyEndStr);

  const checkInMins = inInfo.minutesOfDay;
  // Compute checkOutMins relative to the check-in day in PKT
  const totalElapsedMins = (outDate.getTime() - inDate.getTime()) / (60 * 1000);
  const checkOutMins =
    inInfo.dateStr === outInfo.dateStr
      ? outInfo.minutesOfDay
      : checkInMins + Math.max(0, totalElapsedMins);

  // Formula: Overtime = max(0, CheckOutTime - max(DutyEndTime, CheckInTime))
  // Arriving early (CheckInTime < DutyStartTime) does not lower DutyEndTime,
  // so time before DutyStartTime is never counted as overtime.
  const overtimeStartBaseline = Math.max(dutyEndMins, checkInMins);
  const rawOvertimeMins = Math.max(0, checkOutMins - overtimeStartBaseline);

  const overtimeMinutes = Math.max(0, Math.round(rawOvertimeMins));
  const overtimeHours = Math.max(
    0,
    Math.round((overtimeMinutes / 60) * 100) / 100
  );

  return {
    overtimeMinutes,
    overtimeHours,
    missedMinutes: 0,
    missedHours: 0,
  };
}
