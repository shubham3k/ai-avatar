import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createApiClient, type FetchLike } from "./api-client";

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const intervention = {
  id: "int_1",
  signalId: "sig_1",
  status: "pending",
  priority: "high",
  title: "Design team is waiting for your feedback",
  message: "The design team is waiting for your feedback. The launch is tomorrow.",
  reason: "Time-sensitive approval.",
  actionType: "none",
  actionPayload: null,
  snoozedUntil: null,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  lastDeliveredAt: new Date().toISOString(),
};

describe("desktop api client", () => {
  it("fetches the inbox via GET /api/v1/interventions", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse({ items: [intervention] }));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    const result = await client.fetchInbox();

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/interventions",
      { method: "GET" },
    );
    expect(result).toEqual({ items: [intervention] });
  });

  it("maps the inbox item into the shared DTO shape", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse({ items: [intervention] }));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    const raw = (await client.fetchInbox()) as { items: Array<Record<string, unknown>> };
    // The renderer validates with the shared Zod schema; here we assert the
    // client passes the DTO through untouched.
    expect(raw.items[0]).toMatchObject({
      id: "int_1",
      priority: "high",
      title: "Design team is waiting for your feedback",
    });
  });

  it("resolves an intervention via POST /api/v1/interventions/:id/done", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse(intervention));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await client.resolve("int_1");

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/interventions/int_1/done",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
  });

  it("snoozes an intervention via POST /api/v1/interventions/:id/snooze", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse(intervention));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await client.snooze("int_2", 60);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/interventions/int_2/snooze",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes: 60 }),
      },
    );
  });

  it("throws a typed error when the API responds with a failure", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: "internal_error", message: "boom" } }),
    });
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await expect(client.fetchInbox()).rejects.toBeInstanceOf(ApiClientError);
    await expect(client.resolve("int_1")).rejects.toMatchObject({ status: 500 });
  });

  it("fetches Google connection status via GET /api/v1/integrations/google/status", async () => {
    const status = { connected: true, provider: "google", email: "a@b.com", scopes: [] };
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse(status));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    const result = await client.googleStatus();

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/integrations/google/status",
      { method: "GET" },
    );
    expect(result).toEqual(status);
  });

  it("disconnects Google via POST /api/v1/integrations/google/disconnect", async () => {
    const status = { connected: false, provider: "google", email: null, scopes: [] };
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse(status));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    const result = await client.disconnectGoogle();

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/integrations/google/disconnect",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(result).toEqual(status);
  });

  it("checkNow runs reminders -> sync -> detect-signals -> sent mail -> sync -> detect-signals -> evaluate in order and returns the evaluate result", async () => {
    const evaluateResult = { results: [{ situationId: "sit_1", created: true }] };
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(okResponse({ analyzed: 0, interventionsCreated: 0 })) // reminders detect-signals
      .mockResolvedValueOnce(okResponse({ fetched: 1, created: 1, updated: 0 })) // gmail sync
      .mockResolvedValueOnce(okResponse({ created: 0 })) // gmail detect-signals
      .mockResolvedValueOnce(okResponse({ synced: 1, analyzed: 1, promiseReminders: 0, followUps: 0 })) // M5 sent mail
      .mockResolvedValueOnce(okResponse({ started: true })) // M6 recall index
      .mockResolvedValueOnce(okResponse({ fetched: 1, created: 1, updated: 0 })) // calendar sync
      .mockResolvedValueOnce(okResponse({ created: 0 })) // calendar detect-signals
      .mockResolvedValueOnce(okResponse(evaluateResult)); // assistant evaluate
    const client = createApiClient("http://localhost:4000", fetchImpl);

    const result = await client.checkNow();

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "http://localhost:4000/api/v1/reminders/detect-signals",
      "http://localhost:4000/api/v1/integrations/google/gmail/sync",
      "http://localhost:4000/api/v1/integrations/google/gmail/detect-signals",
      "http://localhost:4000/api/v1/proactive/sent-mail",
      "http://localhost:4000/api/v1/recall/index",
      "http://localhost:4000/api/v1/integrations/google/calendar/sync",
      "http://localhost:4000/api/v1/integrations/google/calendar/detect-signals",
      "http://localhost:4000/api/v1/assistant/evaluate",
    ]);
    expect(fetchImpl.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(result).toEqual(evaluateResult);
  });

  it("checkNow carries on when the sent-mail and recall steps fail (M5/M6, best effort)", async () => {
    const fail = { ok: false, status: 502, json: async () => ({ error: { code: "provider_error", message: "AI down" } }) };
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({ results: [] }));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await expect(client.checkNow()).resolves.toEqual({ results: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("checkNow stops and throws at the first step that fails, without calling later steps", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(okResponse({ analyzed: 0, interventionsCreated: 0 })) // reminders ok
      .mockResolvedValueOnce(okResponse({ fetched: 1, created: 1, updated: 0 })) // gmail sync ok
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: { code: "provider_error", message: "Gmail unreachable" } }),
      }); // gmail detect-signals fails
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await expect(client.checkNow()).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("creates a reminder via POST /api/v1/reminders", async () => {
    const reminder = { id: "rem_1", text: "Call the vendor", dueAt: new Date().toISOString() };
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse(reminder));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    const result = await client.createReminder("Call the vendor", "2026-09-25T09:00:00.000Z");

    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:4000/api/v1/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Call the vendor", dueAt: "2026-09-25T09:00:00.000Z" }),
    });
    expect(result).toEqual(reminder);
  });

  it("creates a reminder from free text via POST /api/v1/reminders/from-text", async () => {
    const reminder = {
      id: "rem_2",
      text: "Drink water",
      dueAt: "2026-09-24T16:00:00.000Z",
      remindAt: "2026-09-24T15:50:00.000Z",
    };
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse(reminder));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    const result = await client.createReminderFromText("remind me to drink water at 4pm");

    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:4000/api/v1/reminders/from-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "remind me to drink water at 4pm" }),
    });
    expect(result).toEqual(reminder);
  });

  it("creates a reminder from a voice clip via POST /api/v1/reminders/from-voice", async () => {
    const reminder = {
      id: "rem_3",
      text: "Drink water",
      dueAt: "2026-09-24T16:00:00.000Z",
      remindAt: "2026-09-24T15:50:00.000Z",
    };
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse(reminder));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    const result = await client.createReminderFromVoice("ZmFrZS1hdWRpbw==", "audio/webm");

    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:4000/api/v1/reminders/from-voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64: "ZmFrZS1hdWRpbw==", mimeType: "audio/webm" }),
    });
    expect(result).toEqual(reminder);
  });

  it("keeps the API's own error message on the thrown error", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: { code: "upstream_error", message: "Your Groq API key was rejected. Update it in Settings." },
      }),
    });
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await expect(client.createReminderFromText("remind me at 4pm")).rejects.toMatchObject({
      status: 502,
      apiMessage: "Your Groq API key was rejected. Update it in Settings.",
    });
  });

  it("leaves apiMessage null when the error body isn't the API's standard shape", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await expect(client.fetchInbox()).rejects.toMatchObject({ status: 500, apiMessage: null });
  });

  it("checkDue runs only local steps, in order — reminders, due approved emails (M7 backup), due routines (M9), calendar detection", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse({}));
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await client.checkDue();

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "http://localhost:4000/api/v1/reminders/detect-signals",
      "http://localhost:4000/api/v1/actions/execute-due",
      "http://localhost:4000/api/v1/routines/run-due",
      "http://localhost:4000/api/v1/integrations/google/calendar/detect-signals",
    ]);
  });

  it("streams a chat reply, handing each Server-Sent Event over as it arrives (chunks may split events)", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"type":"conversation","id":"c1","title":"hi"}\n\ndata: {"type":"del',
      'ta","text":"Hel"}\n\n',
      'data: {"type":"delta","text":"lo"}\r\n\r\ndata: not-json\n\n',
      'data: {"type":"done","message":{"id":"m1"}}',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body });
    const client = createApiClient("http://localhost:4000", fetchImpl);
    const events: unknown[] = [];

    await client.sendChatMessage({ text: "hi" }, (e) => events.push(e));

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/api/v1/chat/messages",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "hi" }) }),
    );
    expect(events).toEqual([
      { type: "conversation", id: "c1", title: "hi" },
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "done", message: { id: "m1" } },
    ]);
  });

  it("throws the API's message when a chat request is rejected before streaming", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "not_found", message: "Conversation not found." } }),
    });
    const client = createApiClient("http://localhost:4000", fetchImpl);

    await expect(client.sendChatMessage({ conversationId: "x", text: "hi" }, () => {})).rejects.toMatchObject({
      status: 404,
      apiMessage: "Conversation not found.",
    });
  });

  it("encodes intervention ids in URLs", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(okResponse(intervention));
    const client = createApiClient("http://localhost:4000/", fetchImpl);

    await client.snooze("a/b c", 30);

    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall?.[0]).toBe(
      "http://localhost:4000/api/v1/interventions/a%2Fb%20c/snooze",
    );
  });
});
