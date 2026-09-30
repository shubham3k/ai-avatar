import type { VoiceEngine } from "./preferences";

/** Where audio actually comes from and goes to — browser glue lives in speech-output.ts. */
export interface SpeechOutput {
  /** OpenAI TTS: resolves base64 MP3, or rejects with a user-facing message. */
  synthesize(text: string, voice: string): Promise<string>;
  /** Plays MP3; resolves when it ends or is stopped. */
  playMp3(base64: string): Promise<void>;
  /** A local Windows voice; resolves when done or stopped. */
  speakLocally(text: string, voiceName: string | null): Promise<void>;
  /** Silences whatever is playing, immediately. */
  stopAll(): void;
}

export interface SpeakerSettings {
  engine: VoiceEngine;
  openaiVoice: string;
  windowsVoice: string | null;
}

export interface Speaker {
  /** Queues one chunk of the reply; OpenAI audio is fetched straight away so playback has no gaps. */
  say(text: string): void;
  /** Stops speaking now and drops everything queued (interruption). */
  stop(): void;
  isSpeaking(): boolean;
}

interface QueueItem {
  text: string;
  audio: Promise<string> | null;
}

/**
 * ADR-006 M4: plays Zara's reply chunk by chunk, in order. If OpenAI's
 * voice fails (no key, outage) the rest is spoken with a Windows voice and
 * the reason is reported once through onNotice.
 */
export function createSpeaker(options: {
  output: SpeechOutput;
  getSettings: () => SpeakerSettings;
  onSpeakingChange?: (speaking: boolean) => void;
  onNotice?: (message: string) => void;
}): Speaker {
  const { output, getSettings } = options;
  let queue: QueueItem[] = [];
  let generation = 0;
  let running = false;
  let useLocal = false;
  let noticeShown = false;

  function setSpeaking(value: boolean): void {
    if (running === value) return;
    running = value;
    options.onSpeakingChange?.(value);
  }

  async function playItem(item: QueueItem, settings: SpeakerSettings, myGeneration: number): Promise<void> {
    if (item.audio && !useLocal) {
      try {
        const audio = await item.audio;
        if (myGeneration !== generation) return;
        await output.playMp3(audio);
        return;
      } catch (err) {
        if (myGeneration !== generation) return;
        useLocal = true;
        if (!noticeShown) {
          noticeShown = true;
          const reason = err instanceof Error && err.message ? err.message : "OpenAI's voice isn't available.";
          options.onNotice?.(`${reason} Using a Windows voice instead.`);
        }
      }
    }
    if (myGeneration !== generation) return;
    await output.speakLocally(item.text, settings.windowsVoice);
  }

  async function drain(myGeneration: number): Promise<void> {
    setSpeaking(true);
    try {
      while (queue.length > 0 && myGeneration === generation) {
        const item = queue.shift()!;
        try {
          await playItem(item, getSettings(), myGeneration);
        } catch {
          // A chunk that can't be played is skipped; the text is on screen anyway.
        }
      }
    } finally {
      if (myGeneration === generation) setSpeaking(false);
    }
  }

  return {
    say(text) {
      const settings = getSettings();
      const trimmed = text.trim();
      if (settings.engine === "off" || !trimmed) return;
      const wantsOpenAi = settings.engine === "openai" && !useLocal;
      const item: QueueItem = {
        text: trimmed,
        audio: wantsOpenAi ? output.synthesize(trimmed, settings.openaiVoice) : null,
      };
      // A failed prefetch is handled when the item is played; don't let it surface as unhandled.
      item.audio?.catch(() => undefined);
      queue.push(item);
      if (!running) void drain(generation);
    },
    stop() {
      generation += 1;
      queue = [];
      useLocal = false;
      output.stopAll();
      setSpeaking(false);
    },
    isSpeaking: () => running,
  };
}
