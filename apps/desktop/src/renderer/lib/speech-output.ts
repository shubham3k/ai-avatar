import { isMostlyDevanagari } from "./speech-text";
import type { SpeechOutput } from "./speech-player";

/** Installed Windows voices (Chromium's Web Speech API uses them offline); they load asynchronously. */
export function listLocalVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 1500);
  });
}

/**
 * Picks the local voice for a chunk: Devanagari text gets an installed Hindi
 * voice when there is one; otherwise the chosen voice (or the system default).
 */
export function pickLocalVoice(
  voices: Pick<SpeechSynthesisVoice, "name" | "lang">[],
  text: string,
  preferredName: string | null,
): Pick<SpeechSynthesisVoice, "name" | "lang"> | null {
  if (isMostlyDevanagari(text)) {
    const hindi = voices.find((voice) => voice.lang.toLowerCase().startsWith("hi"));
    if (hindi) return hindi;
  }
  return voices.find((voice) => voice.name === preferredName) ?? null;
}

/**
 * The real audio glue: OpenAI MP3 through an <audio> element, Windows voices
 * through speechSynthesis. `synthesize` is the IPC call to the API.
 */
export function createBrowserSpeechOutput(synthesize: SpeechOutput["synthesize"]): SpeechOutput {
  let current: { audio: HTMLAudioElement; finish: () => void } | null = null;
  let finishLocal: (() => void) | null = null;

  return {
    synthesize,
    playMp3(base64) {
      return new Promise((resolve) => {
        const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
        const finish = () => {
          if (current?.audio === audio) current = null;
          resolve();
        };
        current = { audio, finish };
        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(finish);
      });
    },
    async speakLocally(text, voiceName) {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const synth = window.speechSynthesis;
      const voices = await listLocalVoices();
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = pickLocalVoice(voices, text, voiceName) as SpeechSynthesisVoice | null;
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        const finish = () => {
          if (finishLocal === finish) finishLocal = null;
          resolve();
        };
        finishLocal = finish;
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);
      });
    },
    stopAll() {
      if (current) {
        current.audio.pause();
        current.finish();
      }
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      finishLocal?.();
    },
  };
}
