import { forbiddenError, upstreamError } from "../../lib/errors.js";

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const candidate = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [candidate.code, candidate.status, candidate.response?.status]) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

/**
 * Maps a googleapis/gaxios error into a safe AppError shared by every Google
 * API provider (Gmail, Calendar, ...) — never rethrows the raw Google
 * payload, which could include request/diagnostic details we don't want in
 * an API response or log.
 */
export function mapGoogleApiError(err: unknown, serviceLabel: string): Error {
  const status = extractStatus(err);
  const message = err instanceof Error ? err.message : "";

  if (status === 401 || message.includes("invalid_grant")) {
    return forbiddenError(
      "Google authorization is invalid or has expired. Reconnect your Google account.",
    );
  }
  if (status === 403) {
    return forbiddenError(
      `${serviceLabel} access was denied. Reconnect your Google account with ${serviceLabel} permission granted.`,
    );
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return upstreamError(`${serviceLabel} is temporarily unavailable. Try again shortly.`);
  }
  return upstreamError(`${serviceLabel} request failed.`);
}
