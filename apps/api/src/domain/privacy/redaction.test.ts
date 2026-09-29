import { describe, expect, it } from "vitest";
import { containsSensitive, redact, redactSensitive } from "./redaction.js";

describe("redactSensitive (ADR-006 §1)", () => {
  it.each([
    ["my password is hunter2!", "my password is [redacted]"],
    ["PIN: 4821 for the locker", "PIN: [redacted] for the locker"],
    ["Your OTP is 482913. Do not share.", "Your OTP is [redacted]. Do not share."],
    ["one-time password: 9981", "one-time password: [redacted]"],
    ["verification code 552130 for login", "verification code [redacted] for login"],
    ["card 4111 1111 1111 1111 exp 12/29", "card [redacted] exp 12/29"],
    ["aadhaar 1234 5678 9012", "aadhaar [redacted]"],
    ["PAN is ABCDE1234F", "PAN is [redacted]"],
    ["account number 123456789012345", "account number [redacted]"],
    ["passport no. K1234567", "passport no. [redacted]"],
  ])("masks %j", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("reports which kinds of detail were masked", () => {
    expect(redactSensitive("OTP 123456 and PAN ABCDE1234F").found.sort()).toEqual(["otp", "pan"]);
  });

  it("leaves ordinary text, times, dates, and short numbers alone", () => {
    for (const text of [
      "remind me at 4:30 pm to call Rahul",
      "meeting on 2026-09-30 with 3 people",
      "order #48213 shipped",
      "call me at extension 1234",
      "Invoice INV-2026-0042 is attached",
    ]) {
      expect(redact(text)).toBe(text);
      expect(containsSensitive(text)).toBe(false);
    }
  });

  it("doesn't treat an arbitrary long number that fails the card checksum as a card", () => {
    expect(redact("tracking 4111 1111 1111 1112")).toBe("tracking 4111 1111 1111 1112");
  });
});
