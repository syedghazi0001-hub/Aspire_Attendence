/**
 * Haversine Formula — Calculate exact distance in meters between two GPS coordinates.
 * Used both client-side and server-side to verify that the employee is within the
 * allowed Lab radius (Default: 100 meters).
 */
export function calculateDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const EARTH_RADIUS_METERS = 6371000; // Earth mean radius in meters
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_METERS * c;

  return Math.round(distance * 100) / 100;
}

/**
 * Maps an Admin-assigned Employee ID (e.g. "EMP001") to a deterministic
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
