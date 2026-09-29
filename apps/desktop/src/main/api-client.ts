export interface InboxItem {
  [key: string]: unknown;
}

export class ApiClientError extends Error {
  readonly status: number;
  /** The API's own `error.message` from the response body, when it sent one — curated, user-facing text (e.g. "Your Groq API key was rejected. Update it in Settings."). */
  readonly apiMessage: string | null;

  constructor(message: string, status: number, apiMessage: string | null = null) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

/** Pulls `error.message` out of the API's standard `{ error: { code, message } }` error body, if present. */
async function readApiErrorMessage(response: { json(): Promise<unknown> }): Promise<string | null> {
  try {
    const body = await response.json();
    if (!body || typeof body !== "object") return null;
    const error = (body as { error?: unknown }).error;
    if (!error || typeof error !== "object") return null;
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && message.trim().length > 0 ? message : null;
  } catch {
    return null;
  }
}

export interface ApiClient {
  fetchInbox(): Promise<unknown>;
  resolve(interventionId: string): Promise<unknown>;
  snooze(interventionId: string, minutes: number): Promise<unknown>;
  googleStatus(): Promise<unknown>;
  disconnectGoogle(): Promise<unknown>;
  createReminder(text: string, dueAt: string): Promise<unknown>;
  /**
   * Parses free text ("remind me to drink water at 4pm") via Groq into a
   * reminder that fires some time before the deadline it mentions, not at
   * it — see docs on reminders.service.ts's createReminderFromText.
   */
  createReminderFromText(text: string): Promise<unknown>;
  /** Same as createReminderFromText, but starting from a recorded voice clip (base64-encoded, no data: URI prefix) — transcribed by Groq, then parsed exactly the same way. */
  createReminderFromVoice(audioBase64: string, mimeType: string, durationSeconds?: number): Promise<unknown>;
  /**
   * Runs the same sequence the background scheduler runs on its own
   * interval (see sync-scheduler.ts): check due reminders, sync Gmail,
   * detect Gmail signals, sync Calendar, detect Calendar signals, then
   * evaluate — sequentially, so each step sees the previous step's
   * results. Returns the evaluate step's result; the caller re-fetches the
   * inbox separately to pick up any interventions it created.
   *
   * The scheduler skips this whole sequence while Google isn't connected;
   * due reminders are still delivered by checkDue's separate tick.
   */
  checkNow(): Promise<unknown>;
  /**
   * Local-only delivery check (ADR-005): turns due reminders and
   * already-synced meetings starting within 10 minutes into interventions.
   * Reads only the local database — no Google or Groq calls — so the
   * scheduler can run it every minute for on-time alerts.
   */
  checkDue(): Promise<unknown>;
  /** ADR-006: estimated AI usage for the current month (Settings). */
  usageSummary(): Promise<unknown>;
}

export interface FetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export function createApiClient(baseUrl: string, fetchImpl: FetchLike = fetch as FetchLike): ApiClient {
  const normalizedBase = baseUrl.replace(/\/+$/, "");

  async function request(
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<unknown> {
    const response = await fetchImpl(`${normalizedBase}/api/v1${path}`, {
      method: init?.method ?? "GET",
      ...(init?.body !== undefined
        ? { headers: { "content-type": "application/json" }, body: init.body }
        : {}),
    });
    if (!response.ok) {
      throw new ApiClientError(
        `API request failed (${response.status}) ${init?.method ?? "GET"} ${path}`,
        response.status,
        await readApiErrorMessage(response),
      );
    }
    return response.json();
  }

  return {
    fetchInbox() {
      return request("/interventions");
    },
    resolve(interventionId) {
      return request(`/interventions/${encodeURIComponent(interventionId)}/done`, {
        method: "POST",
        body: "{}",
      });
    },
    snooze(interventionId, minutes) {
      return request(`/interventions/${encodeURIComponent(interventionId)}/snooze`, {
        method: "POST",
        body: JSON.stringify({ minutes }),
      });
    },
    googleStatus() {
      return request("/integrations/google/status");
    },
    disconnectGoogle() {
      return request("/integrations/google/disconnect", { method: "POST", body: "{}" });
    },
    createReminder(text, dueAt) {
      return request("/reminders", { method: "POST", body: JSON.stringify({ text, dueAt }) });
    },
    createReminderFromText(text) {
      return request("/reminders/from-text", { method: "POST", body: JSON.stringify({ text }) });
    },
    createReminderFromVoice(audioBase64, mimeType, durationSeconds) {
      return request("/reminders/from-voice", {
        method: "POST",
        body: JSON.stringify({
          audioBase64,
          mimeType,
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        }),
      });
    },
    usageSummary() {
      return request("/usage/summary");
    },
    async checkNow() {
      await request("/reminders/detect-signals", { method: "POST", body: "{}" });
      await request("/integrations/google/gmail/sync", { method: "POST", body: "{}" });
      await request("/integrations/google/gmail/detect-signals", { method: "POST", body: "{}" });
      await request("/integrations/google/calendar/sync", { method: "POST", body: "{}" });
      await request("/integrations/google/calendar/detect-signals", {
        method: "POST",
        body: "{}",
      });
      return request("/assistant/evaluate", { method: "POST", body: "{}" });
    },
    async checkDue() {
      await request("/reminders/detect-signals", { method: "POST", body: "{}" });
      return request("/integrations/google/calendar/detect-signals", {
        method: "POST",
        body: "{}",
      });
    },
  };
}
