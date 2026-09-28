import { describe, expect, it } from "vitest";
import { detectActionableEmail } from "./actionable-email.detector.js";
import type { ActionableEmailInput } from "./actionable-email.types.js";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function makeInput(overrides: Partial<ActionableEmailInput> = {}): ActionableEmailInput {
  return {
    fromEmail: "colleague@example.com",
    fromName: "Jamie",
    subject: "Quick question",
    snippet: "Hope you're doing well.",
    isRead: false,
    labels: ["INBOX", "UNREAD"],
    receivedAt: new Date("2026-09-14T10:00:00.000Z"),
    ...overrides,
  };
}

describe("detectActionableEmail — positive cases", () => {
  it("flags an unread email asking for feedback as high confidence", () => {
    const result = detectActionableEmail(
      makeInput({ subject: "Need your feedback", snippet: "Can you send this by tomorrow?" }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.matchedRules).toContain("need_your_feedback");
  });

  it("flags an email asking the user to respond", () => {
    const result = detectActionableEmail(
      makeInput({ subject: "Following up", snippet: "Please respond when you get a chance." }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.matchedRules).toContain("please_respond");
  });

  it("flags 'waiting for your response' as high confidence", () => {
    const result = detectActionableEmail(
      makeInput({ snippet: "I'm still waiting for your response on this." }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.matchedRules).toContain("waiting_for_response");
  });

  it("flags a confirmation request", () => {
    const result = detectActionableEmail(
      makeInput({ snippet: "Please confirm you received the documents." }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.matchedRules).toContain("please_confirm");
  });

  it("flags 'can you...' as medium confidence", () => {
    const result = detectActionableEmail(
      makeInput({ snippet: "Can you take a look at the attached proposal?" }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.matchedRules).toContain("can_you");
  });

  it("flags 'please let me know...' as medium confidence", () => {
    const result = detectActionableEmail(
      makeInput({ snippet: "Please let me know your thoughts whenever you have time." }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.matchedRules).toContain("let_me_know");
  });

  it("prefers HIGH confidence when both high and medium phrases are present", () => {
    const result = detectActionableEmail(
      makeInput({ snippet: "Can you please confirm the details? Waiting for your response." }),
      NOW,
    );
    expect(result.confidence).toBe("high");
    expect(result.matchedRules).toEqual(
      expect.arrayContaining(["please_confirm", "waiting_for_response"]),
    );
  });

  it("produces a human-readable, non-generic reason mentioning the sender and subject", () => {
    const result = detectActionableEmail(
      makeInput({
        fromName: "John",
        subject: "Proposal review",
        snippet: "Can you review this proposal?",
      }),
      NOW,
    );
    expect(result.reason).toBe('John appears to need a response about "Proposal review".');
    expect(result.reason).not.toMatch(/you have a new email/i);
  });
});

describe("detectActionableEmail — every other unread email is still surfaced generically", () => {
  it("flags a normal informational email as generic (medium confidence), not an explicit request", () => {
    const result = detectActionableEmail(
      makeInput({ subject: "Team update", snippet: "Here's what happened this week." }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.matchedRules).toEqual(["new_email"]);
  });

  it("builds a generic reason with the sender, subject, and snippet as context — not an implied request", () => {
    const result = detectActionableEmail(
      makeInput({
        fromName: "Priya",
        subject: "Team update",
        snippet: "Here's what happened this week.",
      }),
      NOW,
    );
    expect(result.reason).toBe('New email from Priya about "Team update". Here\'s what happened this week.');
  });

  it("does not flag 'please' alone as an explicit request, but still surfaces the email generically", () => {
    const result = detectActionableEmail(
      makeInput({ snippet: "Please note this is an automated confirmation of receipt." }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("medium");
    expect(result.matchedRules).toEqual(["new_email"]);
  });
});

describe("detectActionableEmail — negative cases (genuinely excluded, not just non-matching)", () => {
  it("does not flag a newsletter (Gmail promotions category)", () => {
    const result = detectActionableEmail(
      makeInput({
        fromEmail: "newsletter@brand.com",
        subject: "This week's picks",
        snippet: "Can you believe these deals? Let me know what you think!",
        labels: ["INBOX", "CATEGORY_PROMOTIONS"],
      }),
      NOW,
    );
    expect(result.actionable).toBe(false);
  });

  it("does not flag a marketing email by sender address alone", () => {
    const result = detectActionableEmail(
      makeInput({
        fromEmail: "marketing@brand.com",
        snippet: "Can you take advantage of this offer before it's gone?",
        labels: ["INBOX"],
      }),
      NOW,
    );
    expect(result.actionable).toBe(false);
  });

  it("does not flag a no-reply automated email", () => {
    const result = detectActionableEmail(
      makeInput({
        fromEmail: "no-reply@service.com",
        subject: "Please confirm your subscription",
        snippet: "Click here to confirm. We are waiting for your response.",
      }),
      NOW,
    );
    expect(result.actionable).toBe(false);
  });

  it("does not flag an automated notification sender", () => {
    const result = detectActionableEmail(
      makeInput({ fromEmail: "notifications+security@example.com", snippet: "Can you verify this login?" }),
      NOW,
    );
    expect(result.actionable).toBe(false);
  });

  it("does not flag an already-read email", () => {
    const result = detectActionableEmail(
      makeInput({ isRead: true, snippet: "Can you confirm? Waiting for your response." }),
      NOW,
    );
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/already been read/i);
  });

  it("does not flag an old email outside the attention window", () => {
    const result = detectActionableEmail(
      makeInput({
        snippet: "Can you confirm? Waiting for your response.",
        receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      NOW,
    );
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/attention window/i);
  });
});

describe("detectActionableEmail — edge cases (must never throw)", () => {
  it("handles a missing sender gracefully", () => {
    const result = detectActionableEmail(
      makeInput({ fromEmail: null, snippet: "Can you confirm?" }),
      NOW,
    );
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/no identifiable sender/i);
  });

  it("handles a missing subject gracefully", () => {
    const result = detectActionableEmail(
      makeInput({ subject: null, snippet: "Please confirm you're attending." }),
      NOW,
    );
    expect(result.actionable).toBe(true);
  });

  it("handles a missing snippet gracefully", () => {
    const result = detectActionableEmail(
      makeInput({ subject: "Please confirm attendance", snippet: null }),
      NOW,
    );
    expect(result.actionable).toBe(true);
  });

  it("handles empty-string subject and snippet without throwing, still surfaced generically", () => {
    const result = detectActionableEmail(makeInput({ subject: "", snippet: "" }), NOW);
    expect(result.actionable).toBe(true);
    expect(result.reason).toBe("New email from Jamie.");
  });

  it("handles a null receivedAt without throwing", () => {
    const result = detectActionableEmail(
      makeInput({ receivedAt: null, snippet: "Can you confirm?" }),
      NOW,
    );
    expect(result.actionable).toBe(false);
    expect(result.reason).toMatch(/received date/i);
  });

  it("handles an invalid Date object without throwing", () => {
    const result = detectActionableEmail(
      makeInput({ receivedAt: new Date("not-a-date"), snippet: "Can you confirm?" }),
      NOW,
    );
    expect(result.actionable).toBe(false);
  });

  it("handles unusual capitalization", () => {
    const result = detectActionableEmail(
      makeInput({ snippet: "CAN YOU PLEASE CONFIRM THIS ASAP???" }),
      NOW,
    );
    expect(result.actionable).toBe(true);
  });

  it("handles heavy punctuation and duplicate phrases without duplicate rule ids", () => {
    const result = detectActionableEmail(
      makeInput({
        snippet: "Can you...?! Can you take a look?! Can you get back to me?!",
      }),
      NOW,
    );
    expect(result.actionable).toBe(true);
    expect(result.confidence).toBe("medium");
    // "can_you" appears 3x in the text but should be reported once.
    expect(result.matchedRules.filter((id) => id === "can_you")).toHaveLength(1);
    expect(result.matchedRules).toEqual(["can_you"]);
  });

  it("handles an empty labels array without throwing", () => {
    const result = detectActionableEmail(
      makeInput({ labels: [], snippet: "Can you confirm?" }),
      NOW,
    );
    expect(result.actionable).toBe(true);
  });

  it("is deterministic: identical input always produces identical output", () => {
    const input = makeInput({ snippet: "Can you confirm? Waiting for your response." });
    const first = detectActionableEmail(input, NOW);
    const second = detectActionableEmail(input, NOW);
    expect(first).toEqual(second);
  });
});
