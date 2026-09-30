import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { createActivityService } from "../src/domain/activity/activity.service.js";
import { createActionsService, SEND_DELAY_MS } from "../src/domain/actions/actions.service.js";
import { buildRawMessage, encodeHeader } from "../src/providers/google/gmail/gmail-send.service.js";
import { grantedCapabilities, GOOGLE_OAUTH_SCOPES } from "../src/providers/google/oauth/google-oauth.types.js";
import { createZaraAgentService, type ChatEvent } from "../src/domain/chat/zara-agent.service.js";
import type { ChatRequest, LlmProvider } from "../src/providers/llm/llm-provider.js";

const USER_EMAIL = "actions@example.local";
let userId: string;
const now = new Date("2026-09-30T10:00:00Z");

async function cleanDb() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) return;
  await prisma.pendingAction.deleteMany({ where: { userId: user.id } });
  await prisma.draftEdit.deleteMany({ where: { userId: user.id } });
  await prisma.actionSettings.deleteMany({ where: { userId: user.id } });
  await prisma.activityEntry.deleteMany({ where: { userId: user.id } });
  await prisma.chatMessage.deleteMany({ where: { conversation: { userId: user.id } } });
  await prisma.conversation.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

function fakes() {
  const gmail = {
    send: vi.fn().mockResolvedValue({ id: "sent-1", threadId: "thr" }),
    replyHeaders: vi.fn().mockResolvedValue({ messageId: "<orig@mail>", references: "<older@mail>" }),
  };
  const normalized = (id: string, title: string, start: string, end: string, attendees: string[] = []) => ({
    id,
    calendarId: "primary",
    summary: title,
    description: null,
    location: null,
    start,
    end,
    isAllDay: false,
    attendees: attendees.map((email) => ({ email, displayName: null, responseStatus: "needsAction" })),
    organizer: { email: "me@example.com", displayName: "Me" },
    status: "confirmed",
    htmlLink: "https://calendar.google.com/x",
  });
  const calendar = {
    create: vi.fn(async (_t: string, fields: { title: string; start: Date; end: Date; attendees: string[] }) =>
      normalized("new-ev", fields.title, fields.start.toISOString(), fields.end.toISOString(), fields.attendees),
    ),
    update: vi.fn(async (_t: string, _c: string, eventId: string, changes: { title?: string; start?: Date; end?: Date }) =>
      normalized(eventId, changes.title ?? "Standup", (changes.start ?? new Date("2026-10-01T04:00:00Z")).toISOString(), (changes.end ?? new Date("2026-10-01T04:30:00Z")).toISOString(), ["rahul@acme.com"]),
    ),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
  const connection = { getDecryptedRefreshToken: vi.fn().mockResolvedValue("tok") } as never;
  const scheduled: (() => void)[] = [];
  const activity = createActivityService({ calendarUndo: { connection, calendar } });
  const actions = createActionsService({ gmail, calendar, connection, activity, schedule: (run) => scheduled.push(run) });
  return { gmail, calendar, actions, activity, scheduled };
}

beforeEach(async () => {
  await cleanDb();
  userId = (await prisma.user.create({ data: { email: USER_EMAIL, displayName: "A", timezone: "UTC" } })).id;
  await prisma.integration.create({
    data: { userId, provider: "google", providerAccountEmail: "me@example.com", refreshTokenEncrypted: "x", scopes: "[]" },
  });
  await prisma.email.create({
    data: {
      userId,
      providerMessageId: "gm-1",
      threadId: "thr-1",
      fromEmail: "rahul@acme.com",
      fromName: "Rahul",
      toEmails: '["me@example.com"]',
      subject: "Budget",
      receivedAt: new Date(now.getTime() - 86_400_000),
      labels: '["INBOX"]',
    },
  });
});
afterAll(cleanDb);

describe("outgoing email format (M7)", () => {
  it("builds a UTF-8 MIME message with reply threading, safe against header injection", () => {
    const raw = buildRawMessage({
      to: ["rahul@acme.com"],
      cc: [],
      subject: "बजट update\r\nBcc: evil@x.com",
      body: "Namaste Rahul,\nDeck kal bhej dunga.",
      inReplyTo: "<orig@mail>",
      references: "<older@mail>",
    });
    const text = Buffer.from(raw, "base64url").toString("utf-8");
    const [headers, body] = text.split("\r\n\r\n");
    expect(headers).toContain("To: rahul@acme.com");
    expect(headers).toContain(`Subject: ${encodeHeader("बजट update Bcc: evil@x.com")}`);
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers).toContain("In-Reply-To: <orig@mail>");
    expect(headers).toContain("References: <older@mail> <orig@mail>");
    expect(Buffer.from(body!.replace(/\r\n/g, ""), "base64").toString("utf-8")).toBe("Namaste Rahul,\r\nDeck kal bhej dunga.");
  });

  it("asks for send / calendar-write / drive-read and reports what's granted", () => {
    expect(GOOGLE_OAUTH_SCOPES).toEqual(expect.arrayContaining([expect.stringMatching(/gmail\.send$/), expect.stringMatching(/calendar\.events$/), expect.stringMatching(/drive\.readonly$/)]));
    expect(grantedCapabilities(["https://www.googleapis.com/auth/gmail.readonly"])).toEqual({ sendEmail: false, editCalendar: false, readDrive: false });
    expect(grantedCapabilities([...GOOGLE_OAUTH_SCOPES])).toEqual({ sendEmail: true, editCalendar: true, readDrive: true });
  });
});

describe("email approval (M7)", () => {
  it("waits 30 s after Approve, then sends exactly once, as a threaded reply, and logs it", async () => {
    const { gmail, actions, activity, scheduled } = fakes();
    const card = await actions.propose(userId, "email_send", {
      to: ["Rahul@acme.com"],
      subject: "Re: Budget",
      body: "Sure, will do.",
      replyTo: { emailId: "e", providerMessageId: "gm-1", threadId: "thr-1" },
    });
    expect(card).toMatchObject({ status: "pending", newRecipients: [], notifies: ["rahul@acme.com"], voiceApprovable: false });

    const approved = await actions.approve(userId, card.id, { via: "click" }, now);
    expect(approved.status).toBe("sending");
    expect(new Date(approved.executeAt!).getTime() - now.getTime()).toBe(SEND_DELAY_MS);
    expect(scheduled).toHaveLength(1);

    expect(await actions.executeDue(new Date(now.getTime() + 10_000))).toBe(0);
    expect(gmail.send).not.toHaveBeenCalled();
    expect(await actions.executeDue(new Date(now.getTime() + SEND_DELAY_MS + 1))).toBe(1);
    expect(await actions.executeDue(new Date(now.getTime() + SEND_DELAY_MS + 5000))).toBe(0);

    expect(gmail.send).toHaveBeenCalledOnce();
    expect(gmail.send.mock.calls[0]![1]).toMatchObject({ to: ["rahul@acme.com"], inReplyTo: "<orig@mail>", threadId: "thr-1", body: "Sure, will do." });
    expect((await actions.get(userId, card.id)).status).toBe("done");
    const [entry] = await activity.list(userId);
    expect(entry).toMatchObject({ kind: "email_sent", canUndo: false });
  });

  it("Undo during the 30 s window stops it; nothing is sent", async () => {
    const { gmail, actions, activity } = fakes();
    const card = await actions.propose(userId, "email_send", { to: ["rahul@acme.com"], subject: "Hi", body: "Hello" });
    await actions.approve(userId, card.id, { via: "click" }, now);
    const undone = await actions.cancel(userId, card.id);
    expect(undone.status).toBe("cancelled");
    expect(await actions.executeDue(new Date(now.getTime() + 60_000))).toBe(0);
    expect(gmail.send).not.toHaveBeenCalled();
    expect((await activity.list(userId))[0]).toMatchObject({ kind: "action_cancelled", summary: expect.stringMatching(/^Stopped sending/) });
  });

  it("never sends email on a chat 'yes' — only a click", async () => {
    const { actions } = fakes();
    const card = await actions.propose(userId, "email_send", { to: ["rahul@acme.com"], subject: "Hi", body: "Hello" });
    await expect(actions.approve(userId, card.id, { via: "chat" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("flags first-time recipients, sends the user's edit, and remembers the edit for style", async () => {
    const { gmail, actions } = fakes();
    const card = await actions.propose(userId, "email_send", { to: ["new.person@corp.com"], cc: ["rahul@acme.com"], subject: "Intro", body: "Dear Sir, kindly find attached." });
    expect(card.newRecipients).toEqual(["new.person@corp.com"]);

    await actions.approve(userId, card.id, { via: "click", payload: { to: ["new.person@corp.com"], cc: [], subject: "Intro", body: "Hi! Sharing the deck." } }, now);
    await actions.executeDue(new Date(now.getTime() + SEND_DELAY_MS + 1));

    expect(gmail.send.mock.calls[0]![1]).toMatchObject({ cc: [], body: "Hi! Sharing the deck." });
    expect(await prisma.draftEdit.findMany({ where: { userId } })).toEqual([
      expect.objectContaining({ before: "Dear Sir, kindly find attached.", after: "Hi! Sharing the deck." }),
    ]);
  });

  it("rejects invalid edits, and asks again instead of sending late after a restart", async () => {
    const { gmail, actions } = fakes();
    const card = await actions.propose(userId, "email_send", { to: ["rahul@acme.com"], subject: "Hi", body: "Hello" });
    await expect(actions.approve(userId, card.id, { via: "click", payload: { to: ["not-an-address"], subject: "Hi", body: "x" } })).rejects.toMatchObject({ statusCode: 400 });

    await actions.approve(userId, card.id, { via: "click" }, now);
    await actions.executeDue(new Date(now.getTime() + 10 * 60_000));
    expect(gmail.send).not.toHaveBeenCalled();
    expect(await actions.get(userId, card.id)).toMatchObject({ status: "pending", error: expect.stringMatching(/closed before sending/) });
  });

  it("explains a missing Google permission", async () => {
    const { gmail, actions } = fakes();
    const { forbiddenError } = await import("../src/lib/errors.js");
    gmail.send.mockRejectedValue(forbiddenError("Gmail access was denied. Reconnect your Google account with Gmail permission granted."));
    const card = await actions.propose(userId, "email_send", { to: ["rahul@acme.com"], subject: "Hi", body: "Hello" });
    await actions.approve(userId, card.id, { via: "click" }, now);
    await actions.executeDue(new Date(now.getTime() + SEND_DELAY_MS + 1));
    expect(await actions.get(userId, card.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/Settings → Actions/) });
  });
});

describe("calendar approval (M7)", () => {
  async function seedEvent() {
    return prisma.calendarEvent.create({
      data: {
        userId,
        providerEventId: "gev-1",
        calendarId: "primary",
        title: "Standup",
        startAt: new Date("2026-10-01T04:00:00Z"),
        endAt: new Date("2026-10-01T04:30:00Z"),
        attendeeEmails: '["me@example.com","rahul@acme.com"]',
      },
    });
  }

  it("an own-only event can be approved in chat, is created, and Undo removes it", async () => {
    const { calendar, actions, activity } = fakes();
    const card = await actions.propose(userId, "calendar_create", { title: "Focus time", start: "2026-10-01T09:00:00Z", end: "2026-10-01T10:00:00Z" });
    expect(card).toMatchObject({ voiceApprovable: true, notifies: [] });

    const done = await actions.approve(userId, card.id, { via: "chat" });
    expect(done.status).toBe("done");
    expect(calendar.create).toHaveBeenCalledWith("tok", expect.objectContaining({ title: "Focus time", attendees: [] }));
    expect(await prisma.calendarEvent.findFirst({ where: { userId, providerEventId: "new-ev" } })).not.toBeNull();

    const [entry] = await activity.list(userId);
    expect(entry).toMatchObject({ kind: "calendar_created", canUndo: true });
    await activity.undo(userId, entry!.id);
    expect(calendar.cancel).toHaveBeenCalledWith("tok", "primary", "new-ev", false);
    expect(await prisma.calendarEvent.findFirst({ where: { userId, providerEventId: "new-ev" } })).toBeNull();
  });

  it("moving a shared meeting shows who's notified, needs a click, and Undo restores it", async () => {
    const { calendar, actions, activity } = fakes();
    const event = await seedEvent();
    const card = await actions.propose(userId, "calendar_update", {
      eventId: event.id,
      providerEventId: "gev-1",
      calendarId: "primary",
      start: "2026-10-01T05:00:00Z",
      end: "2026-10-01T05:30:00Z",
    });
    expect(card).toMatchObject({ notifies: ["rahul@acme.com"], voiceApprovable: false, before: expect.objectContaining({ title: "Standup" }) });
    await expect(actions.approve(userId, card.id, { via: "chat" })).rejects.toMatchObject({ statusCode: 409 });

    expect((await actions.approve(userId, card.id, { via: "click" })).status).toBe("done");
    expect(calendar.update).toHaveBeenCalledWith("tok", "primary", "gev-1", expect.objectContaining({ start: new Date("2026-10-01T05:00:00Z") }), true);

    const [entry] = await activity.list(userId);
    await activity.undo(userId, entry!.id);
    expect(calendar.update).toHaveBeenLastCalledWith(
      "tok",
      "primary",
      "gev-1",
      expect.objectContaining({ title: "Standup", start: new Date("2026-10-01T04:00:00Z") }),
      true,
    );
  });

  it("cancelling notifies attendees; Undo recreates the event", async () => {
    const { calendar, actions, activity } = fakes();
    const event = await seedEvent();
    const card = await actions.propose(userId, "calendar_cancel", { eventId: event.id, providerEventId: "gev-1", calendarId: "primary", title: "Standup" });
    await actions.approve(userId, card.id, { via: "click" });
    expect(calendar.cancel).toHaveBeenCalledWith("tok", "primary", "gev-1", true);
    expect(await prisma.calendarEvent.findFirst({ where: { id: event.id } })).toBeNull();

    const [entry] = await activity.list(userId);
    await activity.undo(userId, entry!.id);
    expect(calendar.create).toHaveBeenCalledWith("tok", expect.objectContaining({ title: "Standup", attendees: ["rahul@acme.com"] }));
  });
});

describe("Zara proposes, never sends (M7)", () => {
  it("draft_email shows a card in the chat and tells the model nothing was sent", async () => {
    const { actions, gmail } = fakes();
    const requests: ChatRequest[] = [];
    const turns = [
      { toolCalls: [{ id: "c1", name: "draft_email", arguments: JSON.stringify({ to: ["rahul@acme.com"], subject: "Deck", body: "Sharing the deck today." }) }] },
      { text: "I've drafted it — check the card and approve to send." },
    ];
    const provider: LlmProvider = {
      createStructuredCompletion: vi.fn(),
      transcribeAudio: vi.fn(),
      streamChat: vi.fn(async (request: ChatRequest, onDelta: (d: string) => void) => {
        requests.push(structuredClone(request));
        const turn = turns.shift()!;
        if (turn.text) onDelta(turn.text);
        return { content: turn.text ?? "", toolCalls: turn.toolCalls ?? [], provider: "openai" as const };
      }),
    };
    const events: ChatEvent[] = [];
    await createZaraAgentService({ provider, actions }).sendMessage(userId, { text: "email Rahul that I'm sharing the deck today" }, (e) => events.push(e));

    const card = events.find((event) => event.type === "action");
    expect(card).toMatchObject({ type: "action", action: { kind: "email_send", status: "pending" } });
    const toolResult = JSON.parse(requests[1]!.messages.at(-1)!.content);
    expect(toolResult).toMatchObject({ card: "shown", status: "waiting for the user's approval" });
    expect(gmail.send).not.toHaveBeenCalled();
  });
});

describe("actions routes (M7)", () => {
  it("reports permissions and writing style, and 404s unknown cards", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const headers = { "x-user-id": userId };
    try {
      const settings = await app.inject({ method: "GET", url: "/api/v1/actions/settings", headers });
      expect(settings.json()).toEqual({
        writingStyle: "",
        permissions: { connected: true, sendEmail: false, editCalendar: false, readDrive: false },
      });
      const saved = await app.inject({ method: "PATCH", url: "/api/v1/actions/settings", headers, payload: { writingStyle: "Short, warm, sign off 'Cheers, Shubham'" } });
      expect(saved.json().writingStyle).toMatch(/Cheers/);
      const missing = await app.inject({ method: "POST", url: "/api/v1/actions/nope/approve", headers, payload: {} });
      expect(missing.statusCode).toBe(404);
      const list = await app.inject({ method: "GET", url: "/api/v1/actions", headers });
      expect(list.json()).toEqual({ actions: [] });
    } finally {
      await app.close();
    }
  }, 30_000);
});
