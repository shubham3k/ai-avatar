/**
 * ADR-006 M7: least privilege for actions — send only (no mailbox changes),
 * events on the user's calendars, and read-only Drive (for M8). Every use of
 * a write scope goes through an approval card the user clicks.
 */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
/**
 * ADR-006 §8a: Google Chat — read one chat when the user asks, send only
 * through an approval card (click + 30 s Undo). `directory.readonly` names
 * the people who wrote in a group space (Chat doesn't return sender names
 * when acting as the user).
 */
export const CHAT_MESSAGES_CREATE_SCOPE = "https://www.googleapis.com/auth/chat.messages.create";
export const CHAT_MESSAGES_READONLY_SCOPE = "https://www.googleapis.com/auth/chat.messages.readonly";
export const CHAT_SPACES_READONLY_SCOPE = "https://www.googleapis.com/auth/chat.spaces.readonly";
export const CHAT_SPACES_CREATE_SCOPE = "https://www.googleapis.com/auth/chat.spaces.create";
export const DIRECTORY_READONLY_SCOPE = "https://www.googleapis.com/auth/directory.readonly";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  GMAIL_SEND_SCOPE,
  CALENDAR_EVENTS_SCOPE,
  DRIVE_READONLY_SCOPE,
  CHAT_MESSAGES_CREATE_SCOPE,
  CHAT_MESSAGES_READONLY_SCOPE,
  CHAT_SPACES_READONLY_SCOPE,
  CHAT_SPACES_CREATE_SCOPE,
  DIRECTORY_READONLY_SCOPE,
] as const;

export interface GrantedCapabilities {
  sendEmail: boolean;
  editCalendar: boolean;
  readDrive: boolean;
  /** Read and send Google Chat (sender names in spaces are best effort). */
  googleChat: boolean;
}

/** Which M7/M8/§8a capabilities the stored grant covers (an older connection lacks them until the user reconnects). */
export function grantedCapabilities(scopes: string[]): GrantedCapabilities {
  return {
    sendEmail: scopes.includes(GMAIL_SEND_SCOPE),
    editCalendar: scopes.includes(CALENDAR_EVENTS_SCOPE),
    readDrive: scopes.includes(DRIVE_READONLY_SCOPE),
    googleChat: [CHAT_MESSAGES_CREATE_SCOPE, CHAT_MESSAGES_READONLY_SCOPE, CHAT_SPACES_READONLY_SCOPE, CHAT_SPACES_CREATE_SCOPE].every((scope) =>
      scopes.includes(scope),
    ),
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
