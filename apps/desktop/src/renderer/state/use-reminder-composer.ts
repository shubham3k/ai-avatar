import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeCreatedReminder,
  GENERIC_REMINDER_ERROR,
  microphoneErrorMessage,
  readReminderResult,
} from "../lib/reminder-results";
import { blobToBase64, createVoiceRecorder, type VoiceRecorder } from "../lib/voice-recorder";

/** How long a success confirmation stays up before the bubble tidies itself away. */
export const CONFIRMATION_DURATION_MS = 6_000;

export interface ReminderComposer {
  text: string;
  setText: (text: string) => void;
  /** Typed reminder being sent. */
  saving: boolean;
  /** Microphone is open. */
  recording: boolean;
  /** Recorded clip is being transcribed + scheduled. */
  transcribing: boolean;
  error: string | null;
  confirmation: string | null;
  submitText: () => Promise<void>;
  /** Starts recording, or stops and submits if already recording. */
  toggleRecording: () => void;
  /** Clears error/confirmation (e.g. when the composer closes). */
  clearFeedback: () => void;
}

/**
 * Reminder creation from the dock (typed via 💬, spoken via 🎤) — moved out
 * of Settings so setting a reminder never requires opening the settings
 * panel. Owns the recorder lifecycle: the microphone is released on
 * unmount even mid-recording.
 */
export function useReminderComposer(): ReminderComposer {
  const [text, setTextState] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    };
  }, []);

  const showConfirmation = useCallback((message: string) => {
    setConfirmation(message);
    if (confirmationTimer.current) clearTimeout(confirmationTimer.current);
    confirmationTimer.current = setTimeout(() => setConfirmation(null), CONFIRMATION_DURATION_MS);
  }, []);

  const clearFeedback = useCallback(() => {
    setError(null);
    setConfirmation(null);
  }, []);

  const setText = useCallback((next: string) => {
    setTextState(next);
    setConfirmation(null);
  }, []);

  const submitText = useCallback(async () => {
    const trimmed = text.trim();
    if (!window.desktopAPI || trimmed.length === 0) return;
    setSaving(true);
    clearFeedback();
    try {
      const result = readReminderResult(await window.desktopAPI.createReminderFromText(trimmed));
      if (result.ok) {
        setTextState("");
        showConfirmation(describeCreatedReminder(result.reminder));
      } else {
        setError(result.message);
      }
    } catch {
      setError(GENERIC_REMINDER_ERROR);
    } finally {
      setSaving(false);
    }
  }, [text, clearFeedback, showConfirmation]);

  const stopAndSubmit = useCallback(async () => {
    setRecording(false);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || !window.desktopAPI) return;

    const clip = await recorder.stop();
    if (!clip) {
      setError("No audio was recorded. Try again.");
      return;
    }

    setTranscribing(true);
    try {
      const audioBase64 = await blobToBase64(clip.blob);
      const result = readReminderResult(
        await window.desktopAPI.createReminderFromVoice(audioBase64, clip.mimeType),
      );
      if (result.ok) {
        showConfirmation(describeCreatedReminder(result.reminder));
      } else {
        setError(result.message);
      }
    } catch {
      setError(GENERIC_REMINDER_ERROR);
    } finally {
      setTranscribing(false);
    }
  }, [showConfirmation]);

  const toggleRecording = useCallback(() => {
    if (recording) {
      void stopAndSubmit();
      return;
    }
    clearFeedback();
    const recorder = createVoiceRecorder();
    recorder
      .start()
      .then(() => {
        recorderRef.current = recorder;
        setRecording(true);
      })
      .catch((err: unknown) => {
        setError(microphoneErrorMessage(err));
      });
  }, [recording, stopAndSubmit, clearFeedback]);

  return {
    text,
    setText,
    saving,
    recording,
    transcribing,
    error,
    confirmation,
    submitText,
    toggleRecording,
    clearFeedback,
  };
}
