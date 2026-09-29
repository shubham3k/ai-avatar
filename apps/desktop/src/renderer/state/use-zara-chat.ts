import { useCallback, useEffect, useRef, useState } from "react";
import { microphoneErrorMessage } from "../lib/microphone";
import { blobToBase64, createVoiceRecorder, type VoiceRecorder } from "../lib/voice-recorder";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** "groq" marks a reply produced by the backup provider. */
  provider?: "openai" | "groq" | null;
  /** True while Zara's reply is still streaming in. */
  streaming?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

type ChatEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };

function isChatEvent(value: unknown): value is ChatEvent {
  return !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

function readResult(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Zara couldn't be reached. Please try again." };
}

const STREAMING_ID = "streaming-reply";

export interface ZaraChat {
  conversationId: string | null;
  messages: ChatMessage[];
  /** Tool activity while Zara works, e.g. "Checking your calendar…". */
  status: string | null;
  error: string | null;
  sending: boolean;
  recording: boolean;
  transcribing: boolean;
  view: "chat" | "history";
  conversations: ConversationSummary[];
  send: (text: string) => Promise<void>;
  newChat: () => void;
  showHistory: () => Promise<void>;
  showChat: () => void;
  openConversation: (id: string) => Promise<void>;
  /** Start listening, or stop and send what was said. */
  toggleRecording: () => void;
  /** True while anything is in flight — the panel must not auto-hide then. */
  busy: boolean;
}

/**
 * Zara chat state (ADR-006, M2): one conversation at a time, streamed
 * replies, history, and voice input (speech → text → sent as a message).
 * The microphone is released on unmount even mid-recording.
 */
export function useZaraChat(): ZaraChat {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const conversationRef = useRef<string | null>(null);

  useEffect(() => {
    conversationRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  const send = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    const bridge = window.desktopAPI;
    if (!text || !bridge?.chatSend) return;

    setView("chat");
    setError(null);
    setStatus(null);
    setSending(true);
    setMessages((prev) => [
      ...prev.filter((m) => m.id !== STREAMING_ID),
      { id: `local-${Date.now()}`, role: "user", content: text },
      { id: STREAMING_ID, role: "assistant", content: "", streaming: true },
    ]);

    const onEvent = (raw: unknown) => {
      if (!isChatEvent(raw)) return;
      if (raw.type === "conversation") {
        conversationRef.current = raw.id;
        setConversationId(raw.id);
      } else if (raw.type === "status") {
        setStatus(raw.text);
      } else if (raw.type === "delta") {
        setStatus(null);
        setMessages((prev) =>
          prev.map((m) => (m.id === STREAMING_ID ? { ...m, content: m.content + raw.text } : m)),
        );
      } else if (raw.type === "done") {
        setMessages((prev) => prev.map((m) => (m.id === STREAMING_ID ? { ...raw.message, streaming: false } : m)));
      } else if (raw.type === "error") {
        setError(raw.message);
      }
    };

    try {
      const result = readResult(await bridge.chatSend(conversationRef.current, text, onEvent));
      if (!result.ok) setError(result.message);
    } catch {
      setError("Zara couldn't be reached. Please try again.");
    } finally {
      setSending(false);
      setStatus(null);
      // Drop an empty placeholder left behind by an error.
      setMessages((prev) =>
        prev.filter((m) => !(m.id === STREAMING_ID && m.content.trim() === "")).map((m) =>
          m.id === STREAMING_ID ? { ...m, streaming: false } : m,
        ),
      );
    }
  }, []);

  const newChat = useCallback(() => {
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
    setError(null);
    setStatus(null);
    setView("chat");
  }, []);

  const showHistory = useCallback(async () => {
    setView("history");
    const raw = await window.desktopAPI?.chatList?.().catch(() => null);
    const list = raw && typeof raw === "object" ? (raw as { conversations?: unknown }).conversations : null;
    setConversations(Array.isArray(list) ? (list as ConversationSummary[]) : []);
  }, []);

  const showChat = useCallback(() => setView("chat"), []);

  const openConversation = useCallback(async (id: string) => {
    setError(null);
    const raw = await window.desktopAPI?.chatMessages?.(id).catch(() => null);
    const list = raw && typeof raw === "object" ? (raw as { messages?: unknown }).messages : null;
    conversationRef.current = id;
    setConversationId(id);
    setMessages(Array.isArray(list) ? (list as ChatMessage[]) : []);
    setView("chat");
  }, []);

  const stopAndSend = useCallback(async () => {
    setRecording(false);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    const bridge = window.desktopAPI;
    if (!recorder || !bridge?.chatTranscribe) return;

    const clip = await recorder.stop();
    if (!clip) {
      setError("No audio was recorded. Try again.");
      return;
    }
    setTranscribing(true);
    try {
      const result = readResult(
        await bridge.chatTranscribe(await blobToBase64(clip.blob), clip.mimeType, clip.durationSeconds),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const text = typeof result.value === "string" ? result.value : "";
      if (!text.trim()) {
        setError("Didn't catch anything — try again.");
        return;
      }
      setTranscribing(false);
      await send(text);
    } catch {
      setError("Couldn't transcribe that. Try again.");
    } finally {
      setTranscribing(false);
    }
  }, [send]);

  const toggleRecording = useCallback(() => {
    if (recording) {
      void stopAndSend();
      return;
    }
    setError(null);
    setView("chat");
    const recorder = createVoiceRecorder();
    recorder
      .start()
      .then(() => {
        recorderRef.current = recorder;
        setRecording(true);
      })
      .catch((err: unknown) => setError(microphoneErrorMessage(err)));
  }, [recording, stopAndSend]);

  return {
    conversationId,
    messages,
    status,
    error,
    sending,
    recording,
    transcribing,
    view,
    conversations,
    send,
    newChat,
    showHistory,
    showChat,
    openConversation,
    toggleRecording,
    busy: sending || recording || transcribing,
  };
}
