export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  /** Wall-clock recording length — transcription is billed per minute (usage estimate). */
  durationSeconds: number;
}

const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** The first mime type this browser's MediaRecorder actually supports, falling back to a plain guess if the check itself isn't available. */
export function pickSupportedMimeType(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): string {
  return CANDIDATE_MIME_TYPES.find((type) => isTypeSupported(type)) ?? "audio/webm";
}

/** Strips the "data:<mime>;base64," prefix FileReader.readAsDataURL adds, leaving just the base64 payload the API expects. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read audio data."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read audio data."));
    reader.readAsDataURL(blob);
  });
}

export interface VoiceRecorder {
  /** Requests mic access and starts recording. Throws if permission is denied (Electron-level or the OS's own privacy setting) or no microphone is available. */
  start(): Promise<void>;
  /** Stops recording and resolves with the clip, or null if nothing was ever recorded (e.g. stop() called without a prior start()). */
  stop(): Promise<RecordingResult | null>;
  /** Stops and discards without producing a result — used on unmount so a recording in progress doesn't keep the mic open. */
  cancel(): void;
}

/**
 * Thin wrapper over getUserMedia + MediaRecorder. Auto-stops after
 * maxDurationMs so a forgotten "still listening" state can't record
 * indefinitely or balloon the upload — a short spoken reminder needs a few
 * seconds, not minutes.
 */
export function createVoiceRecorder(options?: { maxDurationMs?: number }): VoiceRecorder {
  const maxDurationMs = options?.maxDurationMs ?? 20_000;

  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  let startedAt: number | null = null;

  function releaseStream(): void {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType();
      chunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      mediaRecorder.start();
      startedAt = Date.now();
      autoStopTimer = setTimeout(() => {
        if (mediaRecorder?.state === "recording") mediaRecorder.stop();
      }, maxDurationMs);
    },

    stop() {
      return new Promise((resolve) => {
        if (autoStopTimer) {
          clearTimeout(autoStopTimer);
          autoStopTimer = null;
        }
        if (!mediaRecorder || mediaRecorder.state === "inactive") {
          resolve(null);
          return;
        }
        const mimeType = mediaRecorder.mimeType;
        mediaRecorder.onstop = () => {
          releaseStream();
          const blob = new Blob(chunks, { type: mimeType });
          const durationSeconds = startedAt === null ? 0 : (Date.now() - startedAt) / 1000;
          chunks = [];
          resolve(blob.size > 0 ? { blob, mimeType, durationSeconds } : null);
        };
        mediaRecorder.stop();
      });
    },

    cancel() {
      if (autoStopTimer) {
        clearTimeout(autoStopTimer);
        autoStopTimer = null;
      }
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
      }
      releaseStream();
      chunks = [];
    },
  };
}
