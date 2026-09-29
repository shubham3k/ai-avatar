import { describe, expect, it } from "vitest";
import { ApiClientError } from "../api-client";
import { isOpenAiModelChoice, OPENAI_MODEL_CHOICES, toReminderCreateResult } from "./register-ipc";

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
