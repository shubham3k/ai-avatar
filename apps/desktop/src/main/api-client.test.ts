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
