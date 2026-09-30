import { describe, expect, it, vi } from "vitest";

const generateAuthUrl = vi.fn();
const getToken = vi.fn();
const verifyIdToken = vi.fn();
const refreshAccessToken = vi.fn();
const setCredentials = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        generateAuthUrl,
        getToken,
        verifyIdToken,
        refreshAccessToken,
        setCredentials,
      })),
    },
  },
}));

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:4000/api/v1/integrations/google/callback",
};

describe("google oauth service", () => {
  it("throws a clear error when not configured", async () => {
    const { createGoogleOAuthService } = await import("./google-oauth.service.js");
    const service = createGoogleOAuthService({
      clientId: "",
      clientSecret: "",
      redirectUri: "",
    });
    expect(() => service.getAuthorizationUrl("state")).toThrow(/not configured/);
  });

  it("generates an authorization URL requesting offline access and least-privilege scopes (ADR-006 M7)", async () => {
    generateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/auth?mock=1");
    const { createGoogleOAuthService } = await import("./google-oauth.service.js");
    const service = createGoogleOAuthService(config);

    const url = service.getAuthorizationUrl("signed-state");

    expect(url).toBe("https://accounts.google.com/o/oauth2/auth?mock=1");
    expect(generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: "offline",
        prompt: "consent",
        state: "signed-state",
        scope: expect.arrayContaining([
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/calendar.readonly",
        ]),
      }),
    );
    const scopes: string[] = generateAuthUrl.mock.calls[0]![0].scope;
    // M7: send-only mail, events-only calendar, read-only Drive — never
    // mailbox modification or full-account access.
    expect(scopes).toEqual(
      expect.arrayContaining([
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive.readonly",
      ]),
    );
    expect(
      scopes.some(
        (s) =>
          s.includes("gmail.modify") ||
          s.includes("gmail.compose") ||
          s === "https://mail.google.com/" ||
          s === "https://www.googleapis.com/auth/drive" ||
          s === "https://www.googleapis.com/auth/calendar",
      ),
    ).toBe(false);
  });

  it("exchanges a code for tokens and resolves the account identity", async () => {
    getToken.mockResolvedValue({
      tokens: {
        access_token: "access-123",
        refresh_token: "refresh-123",
        expiry_date: Date.now() + 3600_000,
        scope: "openid email",
        id_token: "id-token-abc",
      },
    });
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "google-account-1", email: "user@example.com" }),
    });

    const { createGoogleOAuthService } = await import("./google-oauth.service.js");
    const service = createGoogleOAuthService(config);

    const result = await service.exchangeCodeForTokens("auth-code");

    expect(result.identity).toEqual({
      googleAccountId: "google-account-1",
      email: "user@example.com",
    });
    expect(result.tokens.accessToken).toBe("access-123");
    expect(result.tokens.refreshToken).toBe("refresh-123");
    expect(result.tokens.scopes).toEqual(["openid", "email"]);
  });

  it("rejects when Google omits the id_token", async () => {
    getToken.mockResolvedValue({ tokens: { access_token: "a" } });
    const { createGoogleOAuthService } = await import("./google-oauth.service.js");
    const service = createGoogleOAuthService(config);

    await expect(service.exchangeCodeForTokens("auth-code")).rejects.toThrow(
      /id_token/,
    );
  });

  it("refreshes an access token using the stored refresh token", async () => {
    refreshAccessToken.mockResolvedValue({
      credentials: {
        access_token: "new-access",
        expiry_date: Date.now() + 3600_000,
        scope: "openid email",
      },
    });
    const { createGoogleOAuthService } = await import("./google-oauth.service.js");
    const service = createGoogleOAuthService(config);

    const tokens = await service.refreshAccessToken("stored-refresh-token");

    expect(setCredentials).toHaveBeenCalledWith({
      refresh_token: "stored-refresh-token",
    });
    expect(tokens.accessToken).toBe("new-access");
    expect(tokens.refreshToken).toBe("stored-refresh-token");
  });
});
