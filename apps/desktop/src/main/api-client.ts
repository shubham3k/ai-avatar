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
  };
}
