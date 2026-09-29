import { describe, expect, it } from "vitest";
import { ApiClientError } from "../api-client";
import {
  isOpenAiModelChoice,
  OPENAI_MODEL_CHOICES,
  toReminderCreateResult,
  userFacingApiMessage,
} from "./register-ipc";

describe("userFacingApiMessage (chat IPC)", () => {
  it("passes through the API's curated messages for 400/404/502", () => {
    for (const status of [400, 404, 502]) {
      expect(userFacingApiMessage(new ApiClientError("x", status, "Curated."), "fallback")).toBe("Curated.");
    }
  });

  it("falls back for 500s, missing messages, and non-API errors", () => {
    expect(userFacingApiMessage(new ApiClientError("x", 500, "Internal server error"), "fallback")).toBe("fallback");
    expect(userFacingApiMessage(new ApiClientError("x", 400, null), "fallback")).toBe("fallback");
    expect(userFacingApiMessage(new Error("fetch failed"), "fallback")).toBe("fallback");
  });
});

describe("OpenAI model choices (ADR-006)", () => {
  it("offers the cheapest, the recommended default, and the most capable model", () => {
    expect(OPENAI_MODEL_CHOICES.map((c) => c.id)).toEqual(["gpt-5-nano", "gpt-6-luna", "gpt-6-sol"]);
  });

  it("only accepts listed models from the renderer", () => {
    expect(isOpenAiModelChoice("gpt-6-luna")).toBe(true);
    expect(isOpenAiModelChoice("gpt-4-anything")).toBe(false);
    expect(isOpenAiModelChoice(42)).toBe(false);
  });
});

describe("toReminderCreateResult", () => {
  it("wraps a created reminder", async () => {
    await expect(toReminderCreateResult(async () => ({ id: "r1" }))).resolves.toEqual({
      ok: true,
      reminder: { id: "r1" },
    });
  });

  it.each([400, 502])("turns the API's curated %i message into a failure result", async (status) => {
    const result = await toReminderCreateResult(async () => {
      throw new ApiClientError("API request failed", status, "When should I remind you?");
    });
    expect(result).toEqual({ ok: false, message: "When should I remind you?" });
  });

  it("still rejects for a 500 or an error without an API message", async () => {
    await expect(
      toReminderCreateResult(async () => {
        throw new ApiClientError("API request failed", 500, "Internal server error");
      }),
    ).rejects.toBeInstanceOf(ApiClientError);
    await expect(
      toReminderCreateResult(async () => {
        throw new ApiClientError("API request failed", 400, null);
      }),
    ).rejects.toBeInstanceOf(ApiClientError);
    await expect(
      toReminderCreateResult(async () => {
        throw new Error("fetch failed");
      }),
    ).rejects.toThrow("fetch failed");
  });
});
