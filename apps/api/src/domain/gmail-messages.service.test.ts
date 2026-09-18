import { describe, expect, it, vi } from "vitest";
import {
  clampGmailLimit,
  createGmailMessagesService,
} from "./gmail-messages.service.js";
import type { GoogleConnectionService } from "./google-connection.service.js";
import { notFoundError, upstreamError } from "../lib/errors.js";
import type { GmailService } from "../providers/google/gmail/gmail.service.js";
import {
  GMAIL_DEFAULT_MESSAGE_LIMIT,
  GMAIL_MAX_MESSAGE_LIMIT,
} from "../providers/google/gmail/gmail.types.js";

function makeConnection(
  overrides: Partial<GoogleConnectionService> = {},
): GoogleConnectionService {
  return {
    startConnect: vi.fn(),
    handleCallback: vi.fn(),
    getStatus: vi.fn(),
    disconnect: vi.fn(),
    getDecryptedRefreshToken: vi.fn().mockResolvedValue("stored-refresh-token"),
    ...overrides,
  };
}

function makeGmail(overrides: Partial<GmailService> = {}): GmailService {
  return {
    listRecentMessages: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("clampGmailLimit", () => {
  it("defaults when no limit is requested", () => {
    expect(clampGmailLimit(undefined)).toBe(GMAIL_DEFAULT_MESSAGE_LIMIT);
  });

  it("caps an excessive requested limit at the safe maximum", () => {
    expect(clampGmailLimit(1000)).toBe(GMAIL_MAX_MESSAGE_LIMIT);
  });

  it("floors a sub-1 or non-finite value to 1", () => {
    expect(clampGmailLimit(0)).toBe(1);
    expect(clampGmailLimit(-5)).toBe(1);
    expect(clampGmailLimit(Number.NaN)).toBe(GMAIL_DEFAULT_MESSAGE_LIMIT);
  });

  it("passes through an in-range value", () => {
    expect(clampGmailLimit(7)).toBe(7);
  });
});

describe("gmail messages service", () => {
  it("uses the decrypted refresh token from the connection service", async () => {
    const connection = makeConnection();
    const gmail = makeGmail();
    const service = createGmailMessagesService({ connection, gmail });

    await service.listRecentMessages("user_1", 5);

    expect(connection.getDecryptedRefreshToken).toHaveBeenCalledWith("user_1");
    expect(gmail.listRecentMessages).toHaveBeenCalledWith("stored-refresh-token", 5);
  });

  it("clamps the limit before calling the provider", async () => {
    const gmail = makeGmail();
    const service = createGmailMessagesService({ connection: makeConnection(), gmail });

    await service.listRecentMessages("user_1", 999);

    expect(gmail.listRecentMessages).toHaveBeenCalledWith(
      "stored-refresh-token",
      GMAIL_MAX_MESSAGE_LIMIT,
    );
  });

  it("returns the normalized messages from the Gmail provider", async () => {
    const normalized = [
      {
        id: "m1",
        threadId: "t1",
        subject: "Hi",
        from: "a@example.com",
        to: "b@example.com",
        date: null,
        snippet: null,
        labels: [],
        internalDate: null,
      },
    ];
    const gmail = makeGmail({ listRecentMessages: vi.fn().mockResolvedValue(normalized) });
    const service = createGmailMessagesService({ connection: makeConnection(), gmail });

    const result = await service.listRecentMessages("user_1");

    expect(result).toEqual(normalized);
  });

  it("propagates a not_found error when no Google connection exists", async () => {
    const connection = makeConnection({
      getDecryptedRefreshToken: vi
        .fn()
        .mockRejectedValue(notFoundError("Google account is not connected.")),
    });
    const service = createGmailMessagesService({ connection, gmail: makeGmail() });

    await expect(service.listRecentMessages("user_1")).rejects.toMatchObject({
      code: "not_found",
      statusCode: 404,
    });
  });

  it("propagates a safe upstream error when the stored token cannot be decrypted", async () => {
    const connection = makeConnection({
      getDecryptedRefreshToken: vi
        .fn()
        .mockRejectedValue(upstreamError("Stored Google credentials could not be read.")),
    });
    const service = createGmailMessagesService({ connection, gmail: makeGmail() });

    await expect(service.listRecentMessages("user_1")).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("propagates a Gmail provider failure (e.g. revoked access) unchanged", async () => {
    const gmail = makeGmail({
      listRecentMessages: vi.fn().mockRejectedValue(
        Object.assign(new Error("Google authorization is invalid or has expired."), {
          code: "forbidden",
          statusCode: 403,
        }),
      ),
    });
    const service = createGmailMessagesService({ connection: makeConnection(), gmail });

    await expect(service.listRecentMessages("user_1")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
