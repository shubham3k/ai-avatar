/**
 * ADR-006 M4 hands-free mode: a small volume-based voice-activity detector.
 * Fed one microphone level (RMS, 0–1) every ~50 ms; reports when the user
 * starts talking and when they've finished (a pause long enough to mean
 * "your turn, Zara"). Pure — no audio APIs — so it's unit-tested with
 * simulated levels.
 */
export interface VadOptions {
  /** Speech must stay above the threshold this long to count (filters clicks and bumps). */
  onsetMs: number;
  /** While Zara is speaking, interrupting takes longer, sustained speech — her own voice leaking into the mic shouldn't cut her off. */
  bargeInOnsetMs: number;
  /** Silence this long ends the user's turn. */
  endSilenceMs: number;
  /** Levels below this are never speech, however quiet the room. */
  minLevel: number;
  /** Speech must be this many times louder than the room's background noise. */
  noiseRatio: number;
  /** While Zara speaks, the bar is raised by this factor too. */
  bargeInRatio: number;
}

export const DEFAULT_VAD_OPTIONS: VadOptions = {
  onsetMs: 150,
  bargeInOnsetMs: 400,
  endSilenceMs: 1200,
  minLevel: 0.015,
  noiseRatio: 3,
  bargeInRatio: 2,
};

export type VadEvent = "speech-start" | "speech-end" | null;

export interface VoiceActivityDetector {
  feed(level: number, nowMs: number, zaraSpeaking?: boolean): VadEvent;
  inSpeech(): boolean;
}

/** How quickly the background-noise estimate follows the room (per frame). */
const NOISE_ADAPT = 0.05;
/** Short dips below the threshold during onset don't restart the count. */
const ONSET_GAP_MS = 100;

export function createVoiceActivityDetector(overrides?: Partial<VadOptions>): VoiceActivityDetector {
  const options = { ...DEFAULT_VAD_OPTIONS, ...overrides };
  let noiseFloor: number | null = null;
  let speaking = false;
  let aboveSince: number | null = null;
  let lastAbove = 0;

  return {
    feed(level, nowMs, zaraSpeaking = false) {
      const floor = noiseFloor ?? level;
      let threshold = Math.max(options.minLevel, floor * options.noiseRatio);
      if (zaraSpeaking) threshold *= options.bargeInRatio;
      const loud = level >= threshold;

      if (speaking) {
        if (loud) lastAbove = nowMs;
        if (nowMs - lastAbove >= options.endSilenceMs) {
          speaking = false;
          aboveSince = null;
          return "speech-end";
        }
        return null;
      }

      if (loud) {
        if (aboveSince === null || nowMs - lastAbove > ONSET_GAP_MS) aboveSince = nowMs;
        lastAbove = nowMs;
        const needed = zaraSpeaking ? options.bargeInOnsetMs : options.onsetMs;
        if (nowMs - aboveSince >= needed) {
          speaking = true;
          return "speech-start";
        }
        return null;
      }

      if (aboveSince !== null && nowMs - lastAbove > ONSET_GAP_MS) aboveSince = null;
      // Only quiet frames teach the detector what "background" sounds like.
      noiseFloor = noiseFloor === null ? level : noiseFloor + (level - noiseFloor) * NOISE_ADAPT;
      return null;
    },
    inSpeech: () => speaking,
  };
}
