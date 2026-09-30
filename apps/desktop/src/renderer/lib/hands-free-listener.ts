import { createVoiceActivityDetector } from "./voice-activity";
import { pickSupportedMimeType, type RecordingResult } from "./voice-recorder";

export interface HandsFreeListener {
  /** Opens the mic (throws like getUserMedia if it can't). */
  start(): Promise<void>;
  /** Closes the mic and drops anything half-heard. */
  stop(): void;
}

const FRAME_MS = 50;
/** With nobody talking, the running recording is restarted this often so a clip never carries much silence (transcription is billed per minute). */
const MAX_LEADING_SILENCE_MS = 8_000;
/** One turn can't run forever (matches click-to-talk's safety cap). */
const MAX_UTTERANCE_MS = 30_000;

interface Segment {
  recorder: MediaRecorder;
  chunks: BlobPart[];
  startedAt: number;
}

/**
 * ADR-006 M4 hands-free: keeps the mic open while Zara's chat is open and
 * turns each thing the user says into a clip — no clicking. A recording
 * always runs in the background (so the first syllable isn't lost); the
 * voice-activity detector decides where a turn ends. Echo cancellation is
 * on so Zara's own voice is mostly removed; the detector also demands
 * louder, longer speech to interrupt her.
 */
export function createHandsFreeListener(options: {
  onSpeechStart: () => void;
  onUtterance: (clip: RecordingResult) => void;
  isZaraSpeaking: () => boolean;
  /** No speech for idleTimeoutMs — the caller turns hands-free off (privacy, cost). */
  onIdleTimeout: () => void;
  idleTimeoutMs?: number;
}): HandsFreeListener {
  const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let segment: Segment | null = null;
  let lastSpeechAt = 0;
  let speechStartedAt = 0;

  function startSegment(): void {
    if (!stream) return;
    const mimeType = pickSupportedMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    const next: Segment = { recorder, chunks: [], startedAt: Date.now() };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) next.chunks.push(event.data);
    };
    recorder.start();
    segment = next;
  }

  function discardSegment(): void {
    if (!segment) return;
    segment.recorder.ondataavailable = null;
    if (segment.recorder.state !== "inactive") segment.recorder.stop();
    segment = null;
  }

  function finishSegment(): void {
    const done = segment;
    if (!done) return;
    segment = null;
    const mimeType = done.recorder.mimeType;
    done.recorder.onstop = () => {
      const blob = new Blob(done.chunks, { type: mimeType });
      if (blob.size > 0) {
        options.onUtterance({ blob, mimeType, durationSeconds: (Date.now() - done.startedAt) / 1000 });
      }
    };
    done.recorder.stop();
    startSegment();
  }

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const vad = createVoiceActivityDetector();
      lastSpeechAt = Date.now();
      startSegment();

      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const level = Math.sqrt(sum / samples.length);
        const now = Date.now();
        const event = vad.feed(level, now, options.isZaraSpeaking());

        if (event === "speech-start") {
          speechStartedAt = now;
          options.onSpeechStart();
        } else if (event === "speech-end") {
          lastSpeechAt = now;
          finishSegment();
        } else if (vad.inSpeech()) {
          lastSpeechAt = now;
          if (now - speechStartedAt > MAX_UTTERANCE_MS) finishSegment();
        } else if (segment && now - segment.startedAt > MAX_LEADING_SILENCE_MS) {
          discardSegment();
          startSegment();
        }

        if (!vad.inSpeech() && now - lastSpeechAt > idleTimeoutMs) options.onIdleTimeout();
      }, FRAME_MS);
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      discardSegment();
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      void context?.close().catch(() => undefined);
      context = null;
    },
  };
}
