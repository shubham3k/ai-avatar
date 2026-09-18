import { describe, expect, it, vi } from "vitest";
import { createGmailSyncService } from "./gmail-sync.service.js";
import type { GoogleConnectionService } from "./google-connection.service.js";
import { notFoundError } from "../lib/errors.js";
import type {
  EmailsRepository,
  UpsertEmailInput,
} from "../db/repositories/emails.repository.js";
import type { GmailService } from "../providers/google/gmail/gmail.service.js";
import type { NormalizedGmailMessage } from "../providers/google/gmail/gmail.types.js";

function makeMessage(overrides: Partial<NormalizedGmailMessage> = {}): NormalizedGmailMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    subject: "Final approval needed",
    from: "Design Team <design-team@example.com>",
    to: "demo@example.local, second@example.com",
    date: "2026-09-01T10:00:00.000Z",
    snippet: "Please approve",
    labels: ["INBOX", "UNREAD"],
    internalDate: "1756721000000",
    ...overrides,
  };
}

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
    listRecentMessages: vi.fn().mockResolvedValue([makeMessage()]),
    ...overrides,
  };
}

function makeEmails(overrides: Partial<EmailsRepository> = {}): EmailsRepository {
  return {
    upsertEmail: vi.fn(),
    upsertMany: vi.fn().mockResolvedValue({ created: 1, updated: 0 }),
    findByProviderMessageId: vi.fn(),
    listRecent: vi.fn(),
    ...overrides,
  };
}

describe("gmail sync service", () => {
  it("fetches Gmail messages via the existing Gmail service using the decrypted refresh token", async () => {
    const connection = makeConnection();
    const gmail = makeGmail();
    const service = createGmailSyncService({ connection, gmail, emails: makeEmails() });

    await service.sync("user_1", 5);

    expect(connection.getDecryptedRefreshToken).toHaveBeenCalledWith("user_1");
    expect(gmail.listRecentMessages).toHaveBeenCalledWith("stored-refresh-token", 5);
  });

  it("transforms normalized messages into email persistence input and upserts them", async () => {
    const emails = makeEmails();
    const service = createGmailSyncService({
      connection: makeConnection(),
      gmail: makeGmail(),
      emails,
    });

    await service.sync("user_1");

    expect(emails.upsertMany).toHaveBeenCalledTimes(1);
    const inputs = (emails.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertEmailInput[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      userId: "user_1",
      providerMessageId: "msg-1",
      threadId: "thread-1",
      fromEmail: "design-team@example.com",
      fromName: "Design Team",
      toEmails: ["demo@example.local", "second@example.com"],
      subject: "Final approval needed",
      snippet: "Please approve",
      isRead: false,
      labels: ["INBOX", "UNREAD"],
    });
    expect(inputs[0]?.receivedAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
  });

  it("marks isRead true when the Gmail UNREAD label is absent", async () => {
    const gmail = makeGmail({
      listRecentMessages: vi.fn().mockResolvedValue([makeMessage({ labels: ["INBOX"] })]),
    });
    const emails = makeEmails();
    const service = createGmailSyncService({ connection: makeConnection(), gmail, emails });

    await service.sync("user_1");

    const inputs = (emails.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertEmailInput[];
    expect(inputs[0]?.isRead).toBe(true);
  });

  it("falls back to internalDate when the Date header is missing", async () => {
    const gmail = makeGmail({
      listRecentMessages: vi
        .fn()
        .mockResolvedValue([makeMessage({ date: null, internalDate: "1756721000000" })]),
    });
    const emails = makeEmails();
    const service = createGmailSyncService({ connection: makeConnection(), gmail, emails });

    await service.sync("user_1");

    const inputs = (emails.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertEmailInput[];
    expect(inputs[0]?.receivedAt.getTime()).toBe(1756721000000);
  });

  it("falls back to the current time when neither date nor internalDate is usable, without throwing", async () => {
    const gmail = makeGmail({
      listRecentMessages: vi
        .fn()
        .mockResolvedValue([makeMessage({ date: null, internalDate: null })]),
    });
    const emails = makeEmails();
    const service = createGmailSyncService({ connection: makeConnection(), gmail, emails });

    const before = Date.now();
    await service.sync("user_1");
    const after = Date.now();

    const inputs = (emails.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertEmailInput[];
    expect(inputs[0]?.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(inputs[0]?.receivedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("falls back to a placeholder subject when missing", async () => {
    const gmail = makeGmail({
      listRecentMessages: vi.fn().mockResolvedValue([makeMessage({ subject: null })]),
    });
    const emails = makeEmails();
    const service = createGmailSyncService({ connection: makeConnection(), gmail, emails });

    await service.sync("user_1");

    const inputs = (emails.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertEmailInput[];
    expect(inputs[0]?.subject).toBe("(no subject)");
  });

  it("handles a missing From header without crashing", async () => {
    const gmail = makeGmail({
      listRecentMessages: vi.fn().mockResolvedValue([makeMessage({ from: null, to: null })]),
    });
    const emails = makeEmails();
    const service = createGmailSyncService({ connection: makeConnection(), gmail, emails });

    await service.sync("user_1");

    const inputs = (emails.upsertMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as UpsertEmailInput[];
    expect(inputs[0]?.fromEmail).toBe("");
    expect(inputs[0]?.fromName).toBeNull();
    expect(inputs[0]?.toEmails).toEqual([]);
  });

  it("returns a summary of fetched/created/updated counts", async () => {
    const emails = makeEmails({
      upsertMany: vi.fn().mockResolvedValue({ created: 2, updated: 1 }),
    });
    const gmail = makeGmail({
      listRecentMessages: vi
        .fn()
        .mockResolvedValue([makeMessage({ id: "a" }), makeMessage({ id: "b" }), makeMessage({ id: "c" })]),
    });
    const service = createGmailSyncService({ connection: makeConnection(), gmail, emails });

    const result = await service.sync("user_1");

    expect(result).toEqual({ fetched: 3, created: 2, updated: 1 });
  });

  it("does no persistence work when Gmail returns no messages", async () => {
    const gmail = makeGmail({ listRecentMessages: vi.fn().mockResolvedValue([]) });
    const emails = makeEmails({ upsertMany: vi.fn().mockResolvedValue({ created: 0, updated: 0 }) });
    const service = createGmailSyncService({ connection: makeConnection(), gmail, emails });

    const result = await service.sync("user_1");

    expect(result).toEqual({ fetched: 0, created: 0, updated: 0 });
    expect(emails.upsertMany).toHaveBeenCalledWith([]);
  });

  it("propagates a not_found error when Google is not connected, without touching the repository", async () => {
    const connection = makeConnection({
      getDecryptedRefreshToken: vi
        .fn()
        .mockRejectedValue(notFoundError("Google account is not connected.")),
    });
    const emails = makeEmails();
    const service = createGmailSyncService({ connection, gmail: makeGmail(), emails });

    await expect(service.sync("user_1")).rejects.toMatchObject({ code: "not_found" });
    expect(emails.upsertMany).not.toHaveBeenCalled();
  });

  it("propagates a Gmail provider failure unchanged, without touching the repository", async () => {
    const gmail = makeGmail({
      listRecentMessages: vi.fn().mockRejectedValue(
        Object.assign(new Error("Gmail access was denied."), {
          code: "forbidden",
          statusCode: 403,
        }),
      ),
    });
    const emails = makeEmails();
    const service = createGmailSyncService({ connection: makeConnection(), gmail, emails });

    await expect(service.sync("user_1")).rejects.toMatchObject({ statusCode: 403 });
    expect(emails.upsertMany).not.toHaveBeenCalled();
  });

  it("is idempotent: syncing the same messages twice does not change the fetched count semantics", async () => {
    const emails = makeEmails({
      upsertMany: vi
        .fn()
        .mockResolvedValueOnce({ created: 1, updated: 0 })
        .mockResolvedValueOnce({ created: 0, updated: 1 }),
    });
    const service = createGmailSyncService({
      connection: makeConnection(),
      gmail: makeGmail(),
      emails,
    });

    const first = await service.sync("user_1");
    const second = await service.sync("user_1");

    expect(first).toEqual({ fetched: 1, created: 1, updated: 0 });
    expect(second).toEqual({ fetched: 1, created: 0, updated: 1 });
  });
});
