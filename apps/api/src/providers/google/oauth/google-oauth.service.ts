import { google } from "googleapis";
import { env } from "../../../config/env.js";
import {
  GOOGLE_OAUTH_SCOPES,
  type GoogleAuthorizationResult,
  type GoogleTokenSet,
} from "./google-oauth.types.js";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function resolveConfig(overrides?: Partial<GoogleOAuthConfig>): GoogleOAuthConfig {
  const clientId = overrides?.clientId ?? env.GOOGLE_CLIENT_ID;
  const clientSecret = overrides?.clientSecret ?? env.GOOGLE_CLIENT_SECRET;
  const redirectUri = overrides?.redirectUri ?? env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export type GoogleAuthorizedClient = InstanceType<typeof google.auth.OAuth2>;

export interface GoogleOAuthService {
  getAuthorizationUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<GoogleAuthorizationResult>;
  refreshAccessToken(refreshToken: string): Promise<GoogleTokenSet>;
  /**
   * Builds an OAuth2 client pre-loaded with a refresh token. googleapis
   * transparently exchanges it for a fresh access token on the first API
   * call (and again whenever the access token expires) — no manual
   * refresh bookkeeping needed by callers.
   */
  createAuthorizedClient(refreshToken: string): GoogleAuthorizedClient;
}

export function createGoogleOAuthService(
  overrides?: Partial<GoogleOAuthConfig>,
): GoogleOAuthService {
  function buildClient() {
    const config = resolveConfig(overrides);
    return new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    );
  }

  return {
    getAuthorizationUrl(state: string): string {
      const client = buildClient();
      return client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [...GOOGLE_OAUTH_SCOPES],
        include_granted_scopes: true,
        state,
      });
    },

    async exchangeCodeForTokens(code: string): Promise<GoogleAuthorizationResult> {
      const client = buildClient();
      const { tokens } = await client.getToken(code);

      if (!tokens.id_token) {
        throw new Error("Google did not return an id_token for this authorization.");
      }

      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: resolveConfig(overrides).clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) {
        throw new Error("Google identity token is missing a subject claim.");
      }

      return {
        tokens: {
          accessToken: tokens.access_token ?? null,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          scopes: tokens.scope ? tokens.scope.split(" ") : [],
        },
        identity: {
          googleAccountId: payload.sub,
          email: payload.email ?? null,
        },
      };
    },

    async refreshAccessToken(refreshToken: string): Promise<GoogleTokenSet> {
      const client = buildClient();
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();
      return {
        accessToken: credentials.access_token ?? null,
        refreshToken: credentials.refresh_token ?? refreshToken,
        expiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : null,
        scopes: credentials.scope ? credentials.scope.split(" ") : [],
      };
    },

    createAuthorizedClient(refreshToken: string): GoogleAuthorizedClient {
      const client = buildClient();
      client.setCredentials({ refresh_token: refreshToken });
      return client;
    },
  };
}
