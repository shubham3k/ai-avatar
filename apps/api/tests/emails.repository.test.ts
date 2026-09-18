import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEmailsRepository,
  type UpsertEmailInput,
} from "../src/db/repositories/emails.repository.js";
import { prisma } from "../src/lib/prisma.js";

async function cleanDb() {
  await prisma.intervention.deleteMany();
  await prisma.signal.deleteMany();
  await prisma.email.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser(email: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email, displayName: "Test User", timezone: "UTC" },
  });
  return user.id;
}

function makeInput(overrides: Partial<UpsertEmailInput> = {}): UpsertEmailInput {
  return {
    userId: "placeholder",
    providerMessageId: "msg-1",
    threadId: "thread-1",
    fromEmail: "design-team@example.com",
    fromName: "Design Team",
    toEmails: ["demo@example.local"],
    subject: "Final approval needed",
    snippet: "Please approve the launch assets",
    receivedAt: new Date("2026-09-01T10:00:00.000Z"),
    isRead: false,
    labels: ["INBOX", "UNREAD"],
    sourceUrl: "https://mail.google.com/mail/u/0/#all/msg-1",
    rawUpdatedAt: new Date("2026-09-01T10:05:00.000Z"),
    ...overrides,
  };
}

const repo = createEmailsRepository(prisma);

describe("emails repository", () => {
  let userId: string;

  beforeEach(async () => {
    await cleanDb();
    userId = await createUser("demo@example.local");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts a new email on first upsert", async () => {
    const { email, created } = await repo.upsertEmail(makeInput({ userId }));

    expect(created).toBe(true);
    expect(email.userId).toBe(userId);
    expect(email.providerMessageId).toBe("msg-1");
    expect(email.threadId).toBe("thread-1");
    expect(email.fromEmail).toBe("design-team@example.com");
    expect(email.fromName).toBe("Design Team");
    expect(email.toEmails).toEqual(["demo@example.local"]);
    expect(email.subject).toBe("Final approval needed");
    expect(email.snippet).toBe("Please approve the launch assets");
    expect(email.receivedAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(email.isRead).toBe(false);
    expect(email.labels).toEqual(["INBOX", "UNREAD"]);
    expect(email.sourceUrl).toBe("https://mail.google.com/mail/u/0/#all/msg-1");

    const count = await prisma.email.count();
    expect(count).toBe(1);
  });

  it("updates the existing record instead of inserting a duplicate on re-sync", async () => {
    await repo.upsertEmail(makeInput({ userId }));

    const { created } = await repo.upsertEmail(
      makeInput({
        userId,
        labels: ["INBOX"], // UNREAD label removed since first sync
        isRead: true,
      }),
    );

    expect(created).toBe(false);
    const count = await prisma.email.count();
    expect(count).toBe(1);

    const stored = await repo.findByProviderMessageId(userId, "msg-1");
    expect(stored?.labels).toEqual(["INBOX"]);
    expect(stored?.isRead).toBe(true);
  });

  it("is idempotent across repeated identical syncs (no duplicate rows)", async () => {
    for (let i = 0; i < 3; i += 1) {
      await repo.upsertEmail(makeInput({ userId }));
    }

    const count = await prisma.email.count();
    expect(count).toBe(1);
  });

  it("enforces uniqueness on (userId, providerMessageId) so a duplicate insert is not possible", async () => {
    await repo.upsertEmail(makeInput({ userId }));

    await expect(
      prisma.email.create({
        data: {
          userId,
          providerMessageId: "msg-1",
          threadId: "thread-1",
          fromEmail: "x@example.com",
          toEmails: JSON.stringify([]),
          subject: "dupe",
          receivedAt: new Date(),
          labels: JSON.stringify([]),
        },
      }),
    ).rejects.toThrow();
  });

  it("does not let two different users collide on the same Gmail message ID", async () => {
    const otherUserId = await createUser("other@example.local");

    await repo.upsertEmail(makeInput({ userId, providerMessageId: "shared-id" }));
    await repo.upsertEmail(
      makeInput({ userId: otherUserId, providerMessageId: "shared-id", subject: "Other user's copy" }),
    );

    const count = await prisma.email.count();
    expect(count).toBe(2);

    const mine = await repo.findByProviderMessageId(userId, "shared-id");
    const theirs = await repo.findByProviderMessageId(otherUserId, "shared-id");
    expect(mine?.subject).toBe("Final approval needed");
    expect(theirs?.subject).toBe("Other user's copy");
  });

  it("keeps createdAt stable but bumps updatedAt across an update", async () => {
    const first = await repo.upsertEmail(makeInput({ userId }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await repo.upsertEmail(makeInput({ userId, subject: "Updated subject" }));

    expect(second.email.createdAt.toISOString()).toBe(first.email.createdAt.toISOString());
    expect(second.email.updatedAt.getTime()).toBeGreaterThan(first.email.updatedAt.getTime());
  });

  it("persists the thread ID across create and update", async () => {
    await repo.upsertEmail(makeInput({ userId, threadId: "thread-abc" }));
    const { email } = await repo.upsertEmail(
      makeInput({ userId, threadId: "thread-abc", subject: "reply in same thread" }),
    );
    expect(email.threadId).toBe("thread-abc");
  });

  it("upsertMany tallies created vs updated correctly", async () => {
    await repo.upsertEmail(makeInput({ userId, providerMessageId: "existing-1" }));

    const tally = await repo.upsertMany([
      makeInput({ userId, providerMessageId: "existing-1", subject: "updated" }),
      makeInput({ userId, providerMessageId: "new-1" }),
      makeInput({ userId, providerMessageId: "new-2" }),
    ]);

    expect(tally).toEqual({ created: 2, updated: 1 });
    expect(await prisma.email.count()).toBe(3);
  });

  it("lists recent emails ordered by receivedAt descending, respecting the limit", async () => {
    await repo.upsertEmail(
      makeInput({ userId, providerMessageId: "old", receivedAt: new Date("2026-01-01T00:00:00Z") }),
    );
    await repo.upsertEmail(
      makeInput({ userId, providerMessageId: "new", receivedAt: new Date("2026-06-01T00:00:00Z") }),
    );
    await repo.upsertEmail(
      makeInput({ userId, providerMessageId: "newest", receivedAt: new Date("2026-09-01T00:00:00Z") }),
    );

    const recent = await repo.listRecent(userId, 2);

    expect(recent).toHaveLength(2);
    expect(recent[0]?.providerMessageId).toBe("newest");
    expect(recent[1]?.providerMessageId).toBe("new");
  });

  it("findByProviderMessageId returns null when nothing matches", async () => {
    const result = await repo.findByProviderMessageId(userId, "does-not-exist");
    expect(result).toBeNull();
  });
});
