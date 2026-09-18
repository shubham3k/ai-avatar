import { describe, expect, it, vi } from "vitest";
import type { Integration } from "../db/repositories/integrations.repository.js";
import { createGoogleConnectionService } from "./google-connection.service.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import type { IntegrationsRepository } from "../db/repositories/integrations.repository.js";
import type { GoogleOAuthService } from "../providers/google/oauth/google-oauth.service.js";
import { createOAuthState } from "../providers/google/oauth/state.js";

vi.mock("../config/env.js", () => ({
  env: { ENCRYPTION_KEY: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=" },
}));

function makeIntegration(overrides: Partial<Integration> = {}): Integration {
  return {
    id: "int_1",
    userId: "user_1",
    provider: "google",
    status: "connected",
    providerAccountId: "google-account-1",
    providerAccountEmail: "user@example.com",
    refreshTokenEncrypted: encryptSecret("refresh-token"),
    accessTokenEncrypted: null,
    expiresAt: null,
    scopes: ["openid", "email"],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(
  overrides: Partial<IntegrationsRepository> = {},
): IntegrationsRepository {
  return {
    findByUserAndProvider: vi.fn().mockResolvedValue(null),
    upsertGoogle: vi.fn().mockResolvedValue(makeIntegration()),
    disable: vi.fn().mockResolvedValue(makeIntegration({ status: "disabled" })),
    ...overrides,
  };
}

function makeOAuth(overrides: Partial<GoogleOAuthService> = {}): GoogleOAuthService {
  return {
    getAuthorizationUrl: vi.fn().mockReturnValue("https://accounts.google.com/mock"),
    exchangeCodeForTokens: vi.fn().mockResolvedValue({
      tokens: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: ["openid", "email"],
      },
      identity: { googleAccountId: "google-account-1", email: "user@example.com" },
    }),
    refreshAccessToken: vi.fn(),
    createAuthorizedClient: vi.fn(),
    ...overrides,
  };
}

describe("google connection service", () => {
  it("binds the authorization URL to the calling user via signed state", () => {
    const oauth = makeOAuth();
    const service = createGoogleConnectionService({ integrations: makeRepo(), oauth });

    const url = service.startConnect("user_1");

    expect(url).toBe("https://accounts.google.com/mock");
    expect(oauth.getAuthorizationUrl).toHaveBeenCalledWith(expect.any(String));
  });

  it("persists an encrypted refresh token on successful callback", async () => {
    const repo = makeRepo();
    const oauth = makeOAuth();
    const service = createGoogleConnectionService({ integrations: repo, oauth });
    const state = createOAuthState("user_1");

    const { userId } = await service.handleCallback(state, "auth-code");

    expect(userId).toBe("user_1");
    expect(repo.upsertGoogle).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        providerAccountId: "google-account-1",
        providerAccountEmail: "user@example.com",
      }),
    );
    const persisted = (repo.upsertGoogle as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(persisted.refreshTokenEncrypted).not.toBe("refresh-1");
  });

  it("rejects a callback with an invalid or tampered state", async () => {
    const service = createGoogleConnectionService({
      integrations: makeRepo(),
      oauth: makeOAuth(),
    });

    await expect(
      service.handleCallback("not-a-valid-state", "auth-code"),
    ).rejects.toThrow();
  });

  it("falls back to the previously stored refresh token when Google omits one on re-consent", async () => {
    const existing = makeIntegration();
    const repo = makeRepo({
      findByUserAndProvider: vi.fn().mockResolvedValue(existing),
    });
    const oauth = makeOAuth({
      exchangeCodeForTokens: vi.fn().mockResolvedValue({
        tokens: {
          accessToken: "access-2",
          refreshToken: null,
          expiresAt: null,
          scopes: ["openid"],
        },
        identity: { googleAccountId: "google-account-1", email: "user@example.com" },
      }),
    });
    const service = createGoogleConnectionService({ integrations: repo, oauth });
    const state = createOAuthState("user_1");

    await service.handleCallback(state, "auth-code");

    const persisted = (repo.upsertGoogle as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // AES-GCM uses a random IV, so ciphertexts of the same plaintext differ;
    // compare the decrypted value instead.
    expect(decryptSecret(persisted.refreshTokenEncrypted)).toBe(
      decryptSecret(existing.refreshTokenEncrypted),
    );
  });

  it("returns only safe fields from getStatus (no tokens)", async () => {
    const repo = makeRepo({
      findByUserAndProvider: vi.fn().mockResolvedValue(makeIntegration()),
    });
    const service = createGoogleConnectionService({ integrations: repo, oauth: makeOAuth() });

    const status = await service.getStatus("user_1");

    expect(status).toEqual({
      connected: true,
      provider: "google",
      email: "user@example.com",
      scopes: ["openid", "email"],
    });
    expect(JSON.stringify(status)).not.toMatch(/refresh|token/i);
  });

  it("reports disconnected when no integration exists", async () => {
    const service = createGoogleConnectionService({ integrations: makeRepo(), oauth: makeOAuth() });
    const status = await service.getStatus("user_1");
    expect(status.connected).toBe(false);
  });

  it("reports disconnected for a disabled integration", async () => {
    const repo = makeRepo({
      findByUserAndProvider: vi
        .fn()
        .mockResolvedValue(makeIntegration({ status: "disabled" })),
    });
    const service = createGoogleConnectionService({ integrations: repo, oauth: makeOAuth() });
    const status = await service.getStatus("user_1");
    expect(status.connected).toBe(false);
  });

  it("disables the integration on disconnect", async () => {
    const repo = makeRepo();
    const service = createGoogleConnectionService({ integrations: repo, oauth: makeOAuth() });

    const status = await service.disconnect("user_1");

    expect(repo.disable).toHaveBeenCalledWith("user_1", "google");
    expect(status.connected).toBe(false);
  });

  describe("getDecryptedRefreshToken", () => {
    it("decrypts and returns the stored refresh token", async () => {
      const integration = makeIntegration({
        refreshTokenEncrypted: encryptSecret("plain-refresh-token"),
      });
      const repo = makeRepo({
        findByUserAndProvider: vi.fn().mockResolvedValue(integration),
      });
      const service = createGoogleConnectionService({ integrations: repo, oauth: makeOAuth() });

      const token = await service.getDecryptedRefreshToken("user_1");

      expect(token).toBe("plain-refresh-token");
    });

    it("throws not_found when no Google connection exists", async () => {
      const service = createGoogleConnectionService({
        integrations: makeRepo({ findByUserAndProvider: vi.fn().mockResolvedValue(null) }),
        oauth: makeOAuth(),
      });

      await expect(service.getDecryptedRefreshToken("user_1")).rejects.toMatchObject({
        code: "not_found",
        statusCode: 404,
      });
    });

    it("throws not_found when the connection is disabled", async () => {
      const repo = makeRepo({
        findByUserAndProvider: vi
          .fn()
          .mockResolvedValue(makeIntegration({ status: "disabled" })),
      });
      const service = createGoogleConnectionService({ integrations: repo, oauth: makeOAuth() });

      await expect(service.getDecryptedRefreshToken("user_1")).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("throws a safe upstream error when the stored token cannot be decrypted", async () => {
      const repo = makeRepo({
        findByUserAndProvider: vi
          .fn()
          .mockResolvedValue(makeIntegration({ refreshTokenEncrypted: "not-valid-ciphertext" })),
      });
      const service = createGoogleConnectionService({ integrations: repo, oauth: makeOAuth() });

      const err = await service.getDecryptedRefreshToken("user_1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("upstream_error");
    });
  });
});
