/**
 * ============================================================================
 * HIGH-PRECISION HAVERSINE FORMULA & EMPLOYEE ID ('EMP 01') VALIDATION ENGINE
 * ============================================================================
 */

/**
 * Haversine Formula — Calculate exact geodesic distance in meters between two
 * GPS coordinates (latitude/longitude in decimal degrees).
 * Uses the WGS-84 mean Earth radius (6,371,008.8 meters) for meter-level accuracy.
 */
export function calculateDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (
    !Number.isFinite(nLat1) ||
    !Number.isFinite(nLon1) ||
    !Number.isFinite(nLat2) ||
    !Number.isFinite(nLon2) || Math.abs(nLat1) > 90 || Math.abs(nLat2) > 90 || Math.abs(nLon1) > 180 || Math.abs(nLon2) > 180
  ) {
    return Number.POSITIVE_INFINITY;
  }

  // Identical coordinates shortcut
  if (
    Math.abs(nLat1 - nLat2) < 1e-9 &&
    Math.abs(nLon1 - nLon2) < 1e-9
  ) {
    return 0;
  }

  const EARTH_RADIUS_METERS = 6371008.8; // WGS-84 mean radius in meters
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const phi1 = toRadians(nLat1);
  const phi2 = toRadians(nLat2);
  const deltaPhi = toRadians(nLat2 - nLat1);
  const deltaLambda = toRadians(nLon2 - nLon1);

  const sinHalfLat = Math.sin(deltaPhi / 2);
  const sinHalfLon = Math.sin(deltaLambda / 2);

  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(phi1) * Math.cos(phi2) * sinHalfLon * sinHalfLon;

  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
  const distanceMeters = EARTH_RADIUS_METERS * c;

  return distanceMeters;
}

/**
 * Strict Employee ID Pattern: "EMP 01", "EMP 02", "EMP 03", etc.
 * Must start with "EMP", followed by a single space, followed by 2+ digits.
 */
export const STRICT_EMPLOYEE_ID_REGEX = /^EMP (?:0[1-9]|[1-9]\d+)$/;

/**
 * Normalizes user input such as "emp1", "EMP01", "emp 05", or "05" into
 * the canonical "EMP 05" format when possible.
 */
export function normalizeEmployeeIdFormat(raw: string): string {
  const trimmed = (raw || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!trimmed) return "";

  const match = trimmed.match(/^EMP[\s-]*(\d+)$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!Number.isNaN(num) && num > 0) {
      return `EMP ${String(num).padStart(2, "0")}`;
    }
  }

  const digitsOnly = trimmed.match(/^(\d+)$/);
  if (digitsOnly) {
    const num = parseInt(digitsOnly[1], 10);
    if (!Number.isNaN(num) && num > 0) {
      return `EMP ${String(num).padStart(2, "0")}`;
    }
  }

  return trimmed;
}

/**
 * Given a list of existing employee_id strings, finds the highest numeric ID
 * and returns the next sequential ID (e.g. if highest is "EMP 05", returns "EMP 06").
 */
export function computeNextEmployeeId(existingIds: string[]): string {
  let maxNumber = 0;

  for (const rawId of existingIds) {
    if (!rawId) continue;
    const match = String(rawId)
      .trim()
      .toUpperCase()
      .match(/EMP[\s_-]*(\d+)/i);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (!Number.isNaN(parsed) && parsed > maxNumber) {
        maxNumber = parsed;
      }
    }
  }

  const nextNum = maxNumber + 1;
  return `EMP ${String(nextNum).padStart(2, "0")}`;
}

/**
 * Maps an Admin-assigned Employee ID (e.g. "EMP 01") to a deterministic
 * internal email address for Supabase Auth (`auth.users`).
 * This allows employees to log in strictly with Employee ID + Password
 * while still being backed by Supabase Auth.
 */
export function employeeIdToAuthEmail(employeeId: string): string {
  const sanitized = employeeId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_");
  return `${sanitized}@employee.portal.local`;
}
