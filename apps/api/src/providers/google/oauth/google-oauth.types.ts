export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

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
