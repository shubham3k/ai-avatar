import {
  createIntegrationsRepository,
  type IntegrationsRepository,
} from "../db/repositories/integrations.repository.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { notFoundError, upstreamError, validationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  createGoogleOAuthService,
  type GoogleOAuthService,
} from "../providers/google/oauth/google-oauth.service.js";
import { createOAuthState, verifyOAuthState } from "../providers/google/oauth/state.js";

export interface GoogleConnectionStatus {
  connected: boolean;
  provider: "google";
  email: string | null;
  scopes: string[];
}

export function createGoogleConnectionService(dependencies?: {
  integrations?: IntegrationsRepository;
  oauth?: GoogleOAuthService;
}) {
  const integrations =
    dependencies?.integrations ?? createIntegrationsRepository(prisma);
  const oauth = dependencies?.oauth ?? createGoogleOAuthService();

  return {
    /** Produces the Google consent-screen URL, binding the redirect to this user via a signed state token. */
    startConnect(userId: string): string {
      const state = createOAuthState(userId);
      return oauth.getAuthorizationUrl(state);
    },

    /**
     * Completes the OAuth round trip: verifies state, exchanges the code,
     * and persists (or updates) the user's Google connection.
     */
    async handleCallback(state: string, code: string): Promise<{ userId: string }> {
      const userId = verifyOAuthState(state);

      const result = await oauth.exchangeCodeForTokens(code);

      const existing = await integrations.findByUserAndProvider(userId, "google");

      // Google only returns a refresh_token on first consent unless re-prompted;
      // fall back to the previously stored token so a re-auth never wipes it out.
      const refreshToken =
        result.tokens.refreshToken ??
        (existing ? decryptSecret(existing.refreshTokenEncrypted) : null);

      if (!refreshToken) {
        throw validationError(
          "Google did not grant a refresh token and none exists on file. Reconnect and accept offline access.",
        );
      }

      await integrations.upsertGoogle({
        userId,
        providerAccountId: result.identity.googleAccountId,
        providerAccountEmail: result.identity.email,
        refreshTokenEncrypted: encryptSecret(refreshToken),
        accessTokenEncrypted: result.tokens.accessToken
          ? encryptSecret(result.tokens.accessToken)
          : null,
        expiresAt: result.tokens.expiresAt,
        scopes: result.tokens.scopes,
      });

      return { userId };
    },

    async getStatus(userId: string): Promise<GoogleConnectionStatus> {
      const integration = await integrations.findByUserAndProvider(userId, "google");
      if (!integration || integration.status !== "connected") {
        return { connected: false, provider: "google", email: null, scopes: [] };
      }
      return {
        connected: true,
        provider: "google",
        email: integration.providerAccountEmail,
        scopes: integration.scopes,
      };
    },

    async disconnect(userId: string): Promise<GoogleConnectionStatus> {
      await integrations.disable(userId, "google");
      return { connected: false, provider: "google", email: null, scopes: [] };
    },

    /**
     * Shared entry point for any provider (Gmail, Calendar, ...) that needs
     * to call a Google API on the user's behalf: resolves the connection and
     * decrypts its refresh token, or throws a safe, consistent AppError.
     */
    async getDecryptedRefreshToken(userId: string): Promise<string> {
      const integration = await integrations.findByUserAndProvider(userId, "google");
      if (!integration || integration.status !== "connected") {
        throw notFoundError(
          "Google account is not connected. Connect it at /api/v1/integrations/google/connect.",
        );
      }
      try {
        return decryptSecret(integration.refreshTokenEncrypted);
      } catch {
        throw upstreamError(
          "Stored Google credentials could not be read. Reconnect your Google account.",
        );
      }
    },
  };
}

export type GoogleConnectionService = ReturnType<
  typeof createGoogleConnectionService
>;
