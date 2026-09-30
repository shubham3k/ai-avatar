import { describe, expect, it } from "vitest";
import { cleanForSpeech, createSentenceChunker, isMostlyDevanagari, MAX_CHUNK_CHARS } from "./speech-text";

function feed(deltas: string[]) {
  const chunker = createSentenceChunker();
  const spoken: string[] = [];
  for (const delta of deltas) spoken.push(...chunker.push(delta));
  return { spoken, rest: chunker.flush() };
}

describe("sentence chunker (M4)", () => {
  it("releases a sentence as soon as it's complete, even mid-stream", () => {
    const chunker = createSentenceChunker();
    expect(chunker.push("You have three meetings to")).toEqual([]);
    expect(chunker.push("day. The first is at 10")).toEqual(["You have three meetings today."]);
    expect(chunker.flush()).toEqual(["The first is at 10"]);
  });

  it("merges very short sentences so tiny chunks aren't sent alone", () => {
    const { spoken, rest } = feed(["Sure! ", "Done. ", "I set a reminder for 4 pm today. "]);
    expect(spoken).toEqual(["Sure! Done. I set a reminder for 4 pm today."]);
    expect(rest).toEqual([]);
  });

  it("splits on the Hindi danda and keeps Devanagari intact", () => {
    const { spoken, rest } = feed(["आपकी आज तीन मीटिंग्स हैं। पहली मीटिंग दस बजे है।"]);
    expect(spoken).toEqual(["आपकी आज तीन मीटिंग्स हैं।"]);
    expect(rest).toEqual(["पहली मीटिंग दस बजे है।"]);
  });

  it("cuts very long run-on text below the API limit", () => {
    const { spoken, rest } = feed([`${"word ".repeat(200)}`]);
    for (const chunk of [...spoken, ...rest]) expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });

  it("treats line breaks as boundaries", () => {
    const { spoken, rest } = feed(["Here is your list for today\n- Call Rahul about the budget\n- Send the report"]);
    expect([...spoken, ...rest]).toEqual(["Here is your list for today", "Call Rahul about the budget", "Send the report"]);
  });
});

describe("cleanForSpeech", () => {
  it("drops bullets, markdown symbols, and URLs", () => {
    expect(cleanForSpeech("- **Call** Rahul, see https://example.com/x now")).toBe("Call Rahul, see now");
  });
});

describe("isMostlyDevanagari", () => {
  it("detects Hindi script but not Hinglish in Latin letters", () => {
    expect(isMostlyDevanagari("आपकी meeting 3 बजे है")).toBe(true);
    expect(isMostlyDevanagari("Aapki meeting 3 baje hai")).toBe(false);
    expect(isMostlyDevanagari("123")).toBe(false);
  });
});
