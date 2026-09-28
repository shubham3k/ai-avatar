import { describe, expect, it } from "vitest";
import { blobToBase64, pickSupportedMimeType } from "./voice-recorder";

describe("pickSupportedMimeType", () => {
  it("returns the first supported candidate in preference order", () => {
    const supported = new Set(["audio/ogg;codecs=opus", "audio/mp4"]);
    expect(pickSupportedMimeType((type) => supported.has(type))).toBe("audio/ogg;codecs=opus");
  });

  it("prefers audio/webm;codecs=opus when it's supported", () => {
    expect(pickSupportedMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to audio/webm when nothing on the list is supported", () => {
    expect(pickSupportedMimeType(() => false)).toBe("audio/webm");
  });
});

describe("blobToBase64", () => {
  it("strips the data: URI prefix, leaving just the base64 payload", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const result = await blobToBase64(blob);
    // jsdom's FileReader does implement readAsDataURL; just assert we get
    // back a plausible base64 string, not a data: URI.
    expect(result.startsWith("data:")).toBe(false);
    expect(result.length).toBeGreaterThan(0);
  });
});
