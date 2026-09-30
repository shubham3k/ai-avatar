/**
 * ADR-006 M7: least privilege for actions — send only (no mailbox changes),
 * events on the user's calendars, and read-only Drive (for M8). Every use of
 * a write scope goes through an approval card the user clicks.
 */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  GMAIL_SEND_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  DRIVE_READONLY_SCOPE,
] as const;

/** Which M7/M8 capabilities the stored grant covers (an older connection lacks them until the user reconnects). */
export function grantedCapabilities(scopes: string[]): { sendEmail: boolean; editCalendar: boolean; readDrive: boolean } {
  return {
    sendEmail: scopes.includes(GMAIL_SEND_SCOPE),
    editCalendar: scopes.includes(CALENDAR_EVENTS_SCOPE),
    readDrive: scopes.includes(DRIVE_READONLY_SCOPE),
  };
}

export interface GoogleIdentity {
  googleAccountId: string;
  email: string | null;
}

export interface GoogleTokenSet {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export interface GoogleAuthorizationResult {
  tokens: GoogleTokenSet;
  identity: GoogleIdentity;
}
