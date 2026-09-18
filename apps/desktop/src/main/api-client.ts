export interface InboxItem {
  [key: string]: unknown;
}

export class ApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

export interface ApiClient {
  fetchInbox(): Promise<unknown>;
  resolve(interventionId: string): Promise<unknown>;
  snooze(interventionId: string, minutes: number): Promise<unknown>;
  googleStatus(): Promise<unknown>;
  disconnectGoogle(): Promise<unknown>;
  /**
   * Manual stand-in for the not-yet-built scheduler (see docs/ROADMAP —
   * "automatic/scheduled assistant evaluation" is still unbuilt): runs the
   * same sequence a background poll would — sync Gmail, detect Gmail
   * signals, sync Calendar, detect Calendar signals, then evaluate —
   * sequentially, so each step sees the previous step's results. Returns
   * the evaluate step's result; the caller re-fetches the inbox separately
   * to pick up any interventions it created.
   */
  checkNow(): Promise<unknown>;
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
    async checkNow() {
      await request("/integrations/google/gmail/sync", { method: "POST", body: "{}" });
      await request("/integrations/google/gmail/detect-signals", { method: "POST", body: "{}" });
      await request("/integrations/google/calendar/sync", { method: "POST", body: "{}" });
      await request("/integrations/google/calendar/detect-signals", {
        method: "POST",
        body: "{}",
      });
      return request("/assistant/evaluate", { method: "POST", body: "{}" });
    },
  };
}
