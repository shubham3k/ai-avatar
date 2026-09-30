import { describe, expect, it } from "vitest";
import { extractOwnText, messageBodyText, SENT_BODY_MAX_CHARS } from "./gmail-sent.service.js";

const b64 = (text: string) => Buffer.from(text).toString("base64url");

describe("sent mail body extraction (M5)", () => {
  it("keeps only what the user wrote — no quoted thread, no signature", () => {
    const raw = [
      "Hi Rahul,",
      "",
      "I'll send the deck by Friday.",
      "",
      "-- ",
      "Mayank | Digipanda",
      "",
      "On Mon, 28 Sep 2026 at 10:00, Rahul <rahul@acme.com> wrote:",
      "> Can you send the deck?",
    ].join("\n");
    expect(extractOwnText(raw)).toBe("Hi Rahul,\n\nI'll send the deck by Friday.");
  });

  it("stops at an Outlook-style original message and caps the length", () => {
    expect(extractOwnText("Sure.\n-----Original Message-----\nFrom: x")).toBe("Sure.");
    expect(extractOwnText("a".repeat(SENT_BODY_MAX_CHARS + 50))!.length).toBe(SENT_BODY_MAX_CHARS);
    expect(extractOwnText("> only quoted")).toBeNull();
  });

  it("prefers text/plain and falls back to HTML", () => {
    expect(
      messageBodyText({
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/html", body: { data: b64("<p>HTML</p>") } },
          { mimeType: "text/plain", body: { data: b64("Plain text") } },
        ],
      }),
    ).toBe("Plain text");
    expect(messageBodyText({ mimeType: "text/html", body: { data: b64("<p>Kal tak&nbsp;bhej dunga</p><style>x{}</style>") } })).toBe(
      "Kal tak bhej dunga",
    );
  });
});
