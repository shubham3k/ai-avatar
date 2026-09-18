import { describe, expect, it, vi } from "vitest";
import type { GoogleOAuthService } from "../oauth/google-oauth.service.js";

const messagesList = vi.fn();
const messagesGet = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    gmail: vi.fn().mockImplementation(() => ({
      users: {
        messages: {
          list: messagesList,
          get: messagesGet,
        },
      },
    })),
  },
}));

function makeOAuth(overrides: Partial<GoogleOAuthService> = {}): GoogleOAuthService {
  return {
    getAuthorizationUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    refreshAccessToken: vi.fn(),
    createAuthorizedClient: vi.fn().mockReturnValue({ mockClient: true }),
    ...overrides,
  };
}

function header(name: string, value: string) {
  return { name, value };
}

describe("gmail service", () => {
  it("passes the decrypted refresh token to the OAuth client builder", async () => {
    messagesList.mockResolvedValue({ data: { messages: [] } });
    const oauth = makeOAuth();
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth });

    await service.listRecentMessages("plain-refresh-token", 10);

    expect(oauth.createAuthorizedClient).toHaveBeenCalledWith("plain-refresh-token");
  });

  it("fetches recent messages and normalizes headers", async () => {
    messagesList.mockResolvedValue({
      data: { messages: [{ id: "msg_1", threadId: "thread_1" }] },
    });
    messagesGet.mockResolvedValue({
      data: {
        id: "msg_1",
        threadId: "thread_1",
        snippet: "Please approve the launch assets",
        labelIds: ["INBOX", "UNREAD"],
        internalDate: "1756721000000",
        payload: {
          headers: [
            header("Subject", "Final approval needed"),
            header("From", "design-team@example.com"),
            header("To", "demo@example.local"),
            header("Date", "Mon, 1 Sep 2026 10:00:00 +0000"),
          ],
        },
      },
    });
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    const messages = await service.listRecentMessages("token", 10);

    expect(messages).toEqual([
      {
        id: "msg_1",
        threadId: "thread_1",
        subject: "Final approval needed",
        from: "design-team@example.com",
        to: "demo@example.local",
        date: new Date("Mon, 1 Sep 2026 10:00:00 +0000").toISOString(),
        snippet: "Please approve the launch assets",
        labels: ["INBOX", "UNREAD"],
        internalDate: "1756721000000",
      },
    ]);
  });

  it("handles headers case-insensitively", async () => {
    messagesList.mockResolvedValue({ data: { messages: [{ id: "m1" }] } });
    messagesGet.mockResolvedValue({
      data: {
        id: "m1",
        threadId: "t1",
        payload: { headers: [header("subject", "lowercase header")] },
      },
    });
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    const [message] = await service.listRecentMessages("token", 5);

    expect(message?.subject).toBe("lowercase header");
  });

  it("fills in nulls when headers, snippet or labels are missing", async () => {
    messagesList.mockResolvedValue({ data: { messages: [{ id: "m1" }] } });
    messagesGet.mockResolvedValue({ data: { id: "m1", threadId: "t1" } });
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    const [message] = await service.listRecentMessages("token", 5);

    expect(message).toEqual({
      id: "m1",
      threadId: "t1",
      subject: null,
      from: null,
      to: null,
      date: null,
      snippet: null,
      labels: [],
      internalDate: null,
    });
  });

  it("keeps an unparsable date header as raw text instead of crashing", async () => {
    messagesList.mockResolvedValue({ data: { messages: [{ id: "m1" }] } });
    messagesGet.mockResolvedValue({
      data: {
        id: "m1",
        threadId: "t1",
        payload: { headers: [header("Date", "not-a-real-date")] },
      },
    });
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    const [message] = await service.listRecentMessages("token", 5);

    expect(message?.date).toBe("not-a-real-date");
  });

  it("carries Gmail's internalDate through for use as a receivedAt fallback", async () => {
    messagesList.mockResolvedValue({ data: { messages: [{ id: "m1" }] } });
    messagesGet.mockResolvedValue({
      data: { id: "m1", threadId: "t1", internalDate: "1756721000000" },
    });
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    const [message] = await service.listRecentMessages("token", 5);

    expect(message?.internalDate).toBe("1756721000000");
  });

  it("returns an empty list when the mailbox has no messages", async () => {
    messagesList.mockResolvedValue({ data: {} });
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    const messages = await service.listRecentMessages("token", 5);

    expect(messages).toEqual([]);
  });

  it("skips a single malformed/failing message instead of crashing the whole request", async () => {
    messagesList.mockResolvedValue({
      data: { messages: [{ id: "bad" }, { id: "good" }] },
    });
    messagesGet.mockImplementation(async ({ id }: { id: string }) => {
      if (id === "bad") throw new Error("boom");
      return {
        data: {
          id: "good",
          threadId: "t2",
          payload: { headers: [header("Subject", "Fine")] },
        },
      };
    });
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    const messages = await service.listRecentMessages("token", 5);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("good");
  });

  it("clamps the requested limit to the safe server-side maximum", async () => {
    messagesList.mockResolvedValue({ data: { messages: [] } });
    const { createGmailService } = await import("./gmail.service.js");
    const { GMAIL_MAX_MESSAGE_LIMIT } = await import("./gmail.types.js");
    const service = createGmailService({ oauth: makeOAuth() });

    await service.listRecentMessages("token", 999999);

    expect(messagesList).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: GMAIL_MAX_MESSAGE_LIMIT }),
    );
  });

  it("maps an authentication failure (401) into a forbidden AppError without leaking Google details", async () => {
    messagesList.mockRejectedValue(
      Object.assign(new Error("invalid_grant: token expired or revoked"), {
        code: 401,
      }),
    );
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    await expect(service.listRecentMessages("token", 5)).rejects.toMatchObject({
      code: "forbidden",
      statusCode: 403,
    });
  });

  it("maps a permission failure (403) into a forbidden AppError", async () => {
    messagesList.mockRejectedValue(Object.assign(new Error("Insufficient Permission"), { code: 403 }));
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    await expect(service.listRecentMessages("token", 5)).rejects.toMatchObject({
      code: "forbidden",
      statusCode: 403,
    });
  });

  it("maps a rate-limit/5xx failure into an upstream AppError", async () => {
    messagesList.mockRejectedValue(Object.assign(new Error("Too Many Requests"), { code: 429 }));
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    await expect(service.listRecentMessages("token", 5)).rejects.toMatchObject({
      code: "upstream_error",
      statusCode: 502,
    });
  });

  it("never includes the raw Google error message in the thrown AppError", async () => {
    messagesList.mockRejectedValue(
      new Error("secret Google diagnostic containing client_secret=abc123"),
    );
    const { createGmailService } = await import("./gmail.service.js");
    const service = createGmailService({ oauth: makeOAuth() });

    await expect(service.listRecentMessages("token", 5)).rejects.not.toMatchObject({
      message: expect.stringContaining("client_secret"),
    });
  });
});
