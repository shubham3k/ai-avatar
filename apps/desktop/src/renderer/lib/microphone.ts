/** Distinguishes "blocked" from "no microphone" — getUserMedia's DOMException names. */
export function microphoneErrorMessage(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? (err as { name: unknown }).name : null;
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Plug one in and try again.";
  }
  if (name === "NotReadableError") {
    return "The microphone is busy in another app. Close it and try again.";
  }
  return "Could not access the microphone — check this app's permission in Windows Settings → Privacy → Microphone.";
}
