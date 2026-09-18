import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCalendarEventsRepository,
  type UpsertCalendarEventInput,
} from "../src/db/repositories/calendar-events.repository.js";
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

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeInput(
  overrides: Partial<UpsertCalendarEventInput> = {},
): UpsertCalendarEventInput {
  return {
    userId: "placeholder",
    providerEventId: "evt-1",
    calendarId: "primary",
    title: "Launch review",
    description: "Discuss launch readiness",
    location: "Conference Room A",
    startAt: new Date("2026-09-15T10:00:00.000Z"),
    endAt: new Date("2026-09-15T11:00:00.000Z"),
    isAllDay: false,
    status: "confirmed",
    organizerEmail: "organizer@example.com",
    organizerName: "Org",
    attendeeEmails: ["a@example.com"],
    attendees: [{ email: "a@example.com", displayName: "Alex", responseStatus: "accepted" }],
    sourceUrl: "https://calendar.google.com/event?eid=evt-1",
    rawUpdatedAt: new Date("2026-09-14T12:05:00.000Z"),
    ...overrides,
  };
}

const repo = createCalendarEventsRepository(prisma);

describe("calendar events repository", () => {
  let userId: string;

  beforeEach(async () => {
    await cleanDb();
    userId = await createUser("demo@example.local");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts a new event on first upsert", async () => {
    const { event, created } = await repo.upsertEvent(makeInput({ userId }));

    expect(created).toBe(true);
    expect(event.userId).toBe(userId);
    expect(event.providerEventId).toBe("evt-1");
    expect(event.calendarId).toBe("primary");
    expect(event.title).toBe("Launch review");
    expect(event.description).toBe("Discuss launch readiness");
    expect(event.location).toBe("Conference Room A");
    expect(event.startAt.toISOString()).toBe("2026-09-15T10:00:00.000Z");
    expect(event.endAt.toISOString()).toBe("2026-09-15T11:00:00.000Z");
    expect(event.isAllDay).toBe(false);
    expect(event.status).toBe("confirmed");
    expect(event.organizerEmail).toBe("organizer@example.com");
    expect(event.organizerName).toBe("Org");
    expect(event.attendeeEmails).toEqual(["a@example.com"]);
    expect(event.attendees).toEqual([
      { email: "a@example.com", displayName: "Alex", responseStatus: "accepted" },
    ]);
    expect(event.sourceUrl).toBe("https://calendar.google.com/event?eid=evt-1");

    expect(await prisma.calendarEvent.count()).toBe(1);
  });

  it("updates the existing record instead of inserting a duplicate on re-sync", async () => {
    await repo.upsertEvent(makeInput({ userId }));

    const { created } = await repo.upsertEvent(
      makeInput({
        userId,
        status: "tentative",
        attendees: [
          { email: "a@example.com", displayName: "Alex", responseStatus: "declined" },
        ],
      }),
    );

    expect(created).toBe(false);
    expect(await prisma.calendarEvent.count()).toBe(1);

    const stored = await repo.findByProviderEventId(userId, "primary", "evt-1");
    expect(stored?.status).toBe("tentative");
    expect((stored?.attendees as unknown as { responseStatus: string }[])[0]?.responseStatus).toBe(
      "declined",
    );
  });

  it("is idempotent across repeated identical syncs (no duplicate rows)", async () => {
    for (let i = 0; i < 3; i += 1) {
      await repo.upsertEvent(makeInput({ userId }));
    }

    expect(await prisma.calendarEvent.count()).toBe(1);
  });

  it("enforces uniqueness on (userId, calendarId, providerEventId)", async () => {
    await repo.upsertEvent(makeInput({ userId }));

    await expect(
      prisma.calendarEvent.create({
        data: {
          userId,
          providerEventId: "evt-1",
          calendarId: "primary",
          title: "dupe",
          startAt: new Date(),
          endAt: new Date(),
          attendeeEmails: JSON.stringify([]),
        },
      }),
    ).rejects.toThrow();
  });

  it("does not let two different users collide on the same Google event ID", async () => {
    const otherUserId = await createUser("other@example.local");

    await repo.upsertEvent(makeInput({ userId, providerEventId: "shared-id" }));
    await repo.upsertEvent(
      makeInput({ userId: otherUserId, providerEventId: "shared-id", title: "Other user's copy" }),
    );

    expect(await prisma.calendarEvent.count()).toBe(2);

    const mine = await repo.findByProviderEventId(userId, "primary", "shared-id");
    const theirs = await repo.findByProviderEventId(otherUserId, "primary", "shared-id");
    expect(mine?.title).toBe("Launch review");
    expect(theirs?.title).toBe("Other user's copy");
  });

  it("persists an all-day event with UTC-midnight-anchored dates", async () => {
    const { event } = await repo.upsertEvent(
      makeInput({
        userId,
        providerEventId: "allday-1",
        isAllDay: true,
        startAt: new Date("2026-09-20T00:00:00.000Z"),
        endAt: new Date("2026-09-21T00:00:00.000Z"),
      }),
    );

    expect(event.isAllDay).toBe(true);
    expect(event.startAt.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(event.endAt.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("persists a timed event with its exact start/end instants", async () => {
    const { event } = await repo.upsertEvent(makeInput({ userId }));
    expect(event.isAllDay).toBe(false);
    expect(event.startAt.getTime()).toBe(new Date("2026-09-15T10:00:00.000Z").getTime());
  });

  it("keeps createdAt stable but bumps updatedAt across an update", async () => {
    const first = await repo.upsertEvent(makeInput({ userId }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await repo.upsertEvent(makeInput({ userId, title: "Updated title" }));

    expect(second.event.createdAt.toISOString()).toBe(first.event.createdAt.toISOString());
    expect(second.event.updatedAt.getTime()).toBeGreaterThan(first.event.updatedAt.getTime());
  });

  it("upsertMany tallies created vs updated correctly", async () => {
    await repo.upsertEvent(makeInput({ userId, providerEventId: "existing-1" }));

    const tally = await repo.upsertMany([
      makeInput({ userId, providerEventId: "existing-1", title: "updated" }),
      makeInput({ userId, providerEventId: "new-1" }),
      makeInput({ userId, providerEventId: "new-2" }),
    ]);

    expect(tally).toEqual({ created: 2, updated: 1 });
    expect(await prisma.calendarEvent.count()).toBe(3);
  });

  it("lists upcoming events ordered by startAt ascending, respecting the limit", async () => {
    await repo.upsertEvent(
      makeInput({
        userId,
        providerEventId: "soonest",
        startAt: new Date("2026-09-15T00:00:00Z"),
        endAt: new Date("2026-09-15T01:00:00Z"),
      }),
    );
    await repo.upsertEvent(
      makeInput({
        userId,
        providerEventId: "middle",
        startAt: new Date("2026-09-20T00:00:00Z"),
        endAt: new Date("2026-09-20T01:00:00Z"),
      }),
    );
    await repo.upsertEvent(
      makeInput({
        userId,
        providerEventId: "latest",
        startAt: new Date("2026-09-25T00:00:00Z"),
        endAt: new Date("2026-09-25T01:00:00Z"),
      }),
    );

    const upcoming = await repo.listUpcoming(userId, 2, NOW);

    expect(upcoming).toHaveLength(2);
    expect(upcoming[0]?.providerEventId).toBe("soonest");
    expect(upcoming[1]?.providerEventId).toBe("middle");
  });

  it("excludes events that already started before `now`", async () => {
    await repo.upsertEvent(
      makeInput({
        userId,
        providerEventId: "past",
        startAt: new Date("2026-01-01T00:00:00Z"),
        endAt: new Date("2026-01-01T01:00:00Z"),
      }),
    );
    await repo.upsertEvent(
      makeInput({
        userId,
        providerEventId: "future",
        startAt: new Date("2026-09-20T00:00:00Z"),
        endAt: new Date("2026-09-20T01:00:00Z"),
      }),
    );

    const upcoming = await repo.listUpcoming(userId, 10, NOW);

    expect(upcoming.map((e) => e.providerEventId)).toEqual(["future"]);
  });

  it("findByProviderEventId returns null when nothing matches", async () => {
    const result = await repo.findByProviderEventId(userId, "primary", "does-not-exist");
    expect(result).toBeNull();
  });
});
