import { describe, expect, it } from "vitest";
import { deriveInterventionActions, sourceUrlOf } from "./intervention-actions";
import type { InterventionDto } from "@ai-agent/shared";

const base: InterventionDto = {
  id: "int_1",
  signalId: "sig_1",
  status: "pending",
  priority: "high",
  title: "Title",
  message: "Message",
  reason: "Reason",
  actionType: "none",
  actionPayload: null,
  snoozedUntil: null,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  lastDeliveredAt: new Date().toISOString(),
};

describe("deriveInterventionActions", () => {
  it("always includes Done (primary) and Remind me later (secondary)", () => {
    const actions = deriveInterventionActions(base);
    expect(actions).toEqual([
      { id: "done", label: "Done", variant: "primary" },
      { id: "remind", label: "Remind me later", variant: "secondary" },
    ]);
  });

  it("includes Open (outline) first when the intervention has a source URL", () => {
    const withSource: InterventionDto = {
      ...base,
      actionType: "open_source",
      actionPayload: { sourceUrl: "https://example.com/event" },
    };
    const actions = deriveInterventionActions(withSource);
    expect(actions[0]).toEqual({ id: "open", label: "Open", variant: "outline" });
    expect(actions).toHaveLength(3);
  });

  it("does not include Open when actionType is open_source but the payload has no sourceUrl", () => {
    const missingUrl: InterventionDto = {
      ...base,
      actionType: "open_source",
      actionPayload: {},
    };
    expect(deriveInterventionActions(missingUrl)).toHaveLength(2);
  });
});

describe("sourceUrlOf", () => {
  it("returns null for a non-open_source intervention even with a sourceUrl-shaped payload", () => {
    expect(sourceUrlOf({ ...base, actionPayload: { sourceUrl: "https://x" } })).toBeNull();
  });

  it("returns the URL for a valid open_source intervention", () => {
    expect(
      sourceUrlOf({
        ...base,
        actionType: "open_source",
        actionPayload: { sourceUrl: "https://x.com" },
      }),
    ).toBe("https://x.com");
  });
});
