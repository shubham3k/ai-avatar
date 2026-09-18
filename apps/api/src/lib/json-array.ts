/**
 * SQLite (Phase 4.1) has no native array/Json type support in Prisma, unlike
 * the previous PostgreSQL datasource — array-shaped columns are stored as
 * JSON-encoded `String` instead. These helpers are the single place that
 * serialization happens; every repository maps through them at the DB
 * boundary so callers keep seeing plain `string[]`, exactly as before.
 */
export function encodeStringArray(values: string[]): string {
  return JSON.stringify(values);
}

export function decodeStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
