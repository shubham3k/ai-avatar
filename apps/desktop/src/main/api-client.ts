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
  /** ADR-006 (M2): Zara chat — past conversations, a conversation's messages, and speech → text for the chat box. */
  listConversations(): Promise<unknown>;
  getConversationMessages(conversationId: string): Promise<unknown>;
  transcribe(audioBase64: string, mimeType: string, durationSeconds?: number): Promise<unknown>;
  /** ADR-006 (M5): proactive settings, briefings, sent-mail follow-ups/promises. */
  proactiveSettings(): Promise<unknown>;
  updateProactiveSettings(patch: Record<string, unknown>): Promise<unknown>;
  deliverBriefing(kind: "morning" | "wrap_up", force?: boolean): Promise<unknown>;
  /** M4: one chunk of Zara's reply as MP3 (`{ audioBase64, mimeType }`) in the given OpenAI voice. */
  speak(text: string, voice: string): Promise<unknown>;
  /** Sends a message and streams Zara's reply; resolves when the stream ends. Omit conversationId to start a new chat. */
  sendChatMessage(request: ChatSendRequest, onEvent: (event: unknown) => void): Promise<void>;
  /** ADR-006 (M3): chat deletion, memory page, activity log. */
  deleteConversation(conversationId: string): Promise<unknown>;
  deleteAllConversations(): Promise<unknown>;
  listMemory(): Promise<unknown>;
  updateMemory(factId: string, content: string): Promise<unknown>;
  deleteMemory(factId: string): Promise<unknown>;
  deleteAllMemory(): Promise<unknown>;
  listActivity(): Promise<unknown>;
  undoActivity(entryId: string): Promise<unknown>;
  clearActivity(): Promise<unknown>;
}

export interface ChatSendRequest {
  conversationId?: string | undefined;
  text: string;
  /** Incognito (M3): nothing stored or learned — the client supplies the history. */
  incognito?: boolean | undefined;
  history?: { role: "user" | "assistant"; content: string }[] | undefined;
  /** M4: the user spoke this message — Zara's reply will be read aloud. */
  spoken?: boolean | undefined;
}

export interface FetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    /** Present on real fetch responses — read incrementally for streamed chat replies. */
    body?: ReadableStream<Uint8Array> | null;
  }>;
}

/**
 * Reads a Server-Sent Events body (`data: <json>\n\n` blocks — the chat
 * route's format) and hands each parsed event to onEvent as it arrives.
 * Malformed blocks are skipped rather than aborting the whole reply.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    try {
      onEvent(JSON.parse(data));
    } catch {
      // Skip a malformed block.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      flush(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) flush(buffer);
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
    listConversations() {
      return request("/chat/conversations");
    },
    getConversationMessages(conversationId) {
      return request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
    },
    transcribe(audioBase64, mimeType, durationSeconds) {
      return request("/chat/transcribe", {
        method: "POST",
        body: JSON.stringify({
          audioBase64,
          mimeType,
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        }),
      });
    },
    proactiveSettings() {
      return request("/proactive/settings");
    },
    updateProactiveSettings(patch) {
      return request("/proactive/settings", { method: "PATCH", body: JSON.stringify(patch) });
    },
    deliverBriefing(kind, force) {
      return request("/proactive/briefing", { method: "POST", body: JSON.stringify({ kind, ...(force ? { force: true } : {}) }) });
    },
    speak(text, voice) {
      return request("/chat/speak", { method: "POST", body: JSON.stringify({ text, voice }) });
    },
    async sendChatMessage(body, onEvent) {
      const response = await fetchImpl(`${normalizedBase}/api/v1/chat/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new ApiClientError(
          `API request failed (${response.status}) POST /chat/messages`,
          response.status,
          await readApiErrorMessage(response),
        );
      }
      if (!response.body) throw new ApiClientError("Chat reply had no body", response.status);
      await readSseStream(response.body, onEvent);
    },
    deleteConversation(conversationId) {
      return request(`/chat/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
    },
    deleteAllConversations() {
      return request("/chat/conversations", { method: "DELETE" });
    },
    listMemory() {
      return request("/memory/facts");
    },
    updateMemory(factId, content) {
      return request(`/memory/facts/${encodeURIComponent(factId)}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      });
    },
    deleteMemory(factId) {
      return request(`/memory/facts/${encodeURIComponent(factId)}`, { method: "DELETE" });
    },
    deleteAllMemory() {
      return request("/memory/facts", { method: "DELETE" });
    },
    listActivity() {
      return request("/activity?limit=100");
    },
    undoActivity(entryId) {
      return request(`/activity/${encodeURIComponent(entryId)}/undo`, { method: "POST", body: "{}" });
    },
    clearActivity() {
      return request("/activity", { method: "DELETE" });
    },
    async checkNow() {
      await request("/reminders/detect-signals", { method: "POST", body: "{}" });
      await request("/integrations/google/gmail/sync", { method: "POST", body: "{}" });
      await request("/integrations/google/gmail/detect-signals", { method: "POST", body: "{}" });
      // ADR-006 M5: sent mail → promise reminders + follow-up nudges. Best
      // effort: a problem here (e.g. the AI is down) mustn't stop the sync.
      await request("/proactive/sent-mail", { method: "POST", body: "{}" }).catch(() => undefined);
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
