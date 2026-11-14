/* eslint-disable @typescript-eslint/no-explicit-any */
/** Supabase commonly defaults to 1000 rows. Never silently truncate payroll input. */
export async function selectAll(query: any) {
  const rows: any[] = [];
  const size = 250;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await query.range(offset, offset + size - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < size) return { data: rows, error: null };
    if (rows.length >= 100000) return { data: null, error: { message: "Report exceeds safe row limit. Narrow the reporting period." } };
  }
}
