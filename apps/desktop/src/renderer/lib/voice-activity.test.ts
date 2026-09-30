import { describe, expect, it } from "vitest";
import { createVoiceActivityDetector, type VadEvent } from "./voice-activity";

const FRAME_MS = 50;

/** Feeds `ms` worth of frames at one level; returns the events emitted (with their time). */
function run(
  vad: ReturnType<typeof createVoiceActivityDetector>,
  clock: { now: number },
  level: number,
  ms: number,
  zaraSpeaking = false,
) {
  const events: { event: Exclude<VadEvent, null>; at: number }[] = [];
  for (let t = 0; t < ms; t += FRAME_MS) {
    clock.now += FRAME_MS;
    const event = vad.feed(level, clock.now, zaraSpeaking);
    if (event) events.push({ event, at: clock.now });
  }
  return events;
}

describe("voice-activity detector (M4 hands-free)", () => {
  it("detects the start of speech and the end after a pause", () => {
    const vad = createVoiceActivityDetector();
    const clock = { now: 0 };
    expect(run(vad, clock, 0.005, 1000)).toEqual([]); // quiet room
    const start = run(vad, clock, 0.1, 2000);
    expect(start.map((e) => e.event)).toEqual(["speech-start"]);
    expect(start[0]!.at - 1000).toBeLessThanOrEqual(250);
    expect(run(vad, clock, 0.005, 1000)).toEqual([]); // a short pause mid-sentence
    expect(vad.inSpeech()).toBe(true);
    expect(run(vad, clock, 0.005, 500).map((e) => e.event)).toEqual(["speech-end"]);
  });

  it("ignores short clicks and bumps", () => {
    const vad = createVoiceActivityDetector();
    const clock = { now: 0 };
    run(vad, clock, 0.005, 500);
    expect(run(vad, clock, 0.3, 100)).toEqual([]);
    expect(run(vad, clock, 0.005, 500)).toEqual([]);
  });

  it("adapts to a noisy room — steady background noise isn't speech", () => {
    const vad = createVoiceActivityDetector();
    const clock = { now: 0 };
    expect(run(vad, clock, 0.03, 3000)).toEqual([]);
    expect(run(vad, clock, 0.2, 500).map((e) => e.event)).toEqual(["speech-start"]);
  });

  it("needs louder, longer speech to interrupt while Zara is talking", () => {
    const vad = createVoiceActivityDetector();
    const clock = { now: 0 };
    run(vad, clock, 0.005, 1000);
    // Her voice leaking into the mic: moderately loud, not enough to cut her off.
    expect(run(vad, clock, 0.025, 1000, true)).toEqual([]);
    // The user clearly talking over her.
    const barge = run(vad, clock, 0.2, 600, true);
    expect(barge.map((e) => e.event)).toEqual(["speech-start"]);
  });
});
