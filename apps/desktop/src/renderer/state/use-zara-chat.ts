import { useCallback, useEffect, useRef, useState } from "react";
import { createHandsFreeListener, type HandsFreeListener } from "../lib/hands-free-listener";
import { microphoneErrorMessage } from "../lib/microphone";
import { getVoicePreferences } from "../lib/preferences";
import { createBrowserSpeechOutput } from "../lib/speech-output";
import { createSpeaker, type Speaker } from "../lib/speech-player";
import { createSentenceChunker } from "../lib/speech-text";
import {
  blobToBase64,
  createVoiceRecorder,
  type RecordingResult,
  type VoiceRecorder,
} from "../lib/voice-recorder";

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

/** M4: OpenAI TTS through the API. A failure's message becomes the reason shown when falling back to a Windows voice. */
async function synthesizeViaBridge(text: string, voice: string): Promise<string> {
  const speak = window.desktopAPI?.chatSpeak;
  if (!speak) throw new Error("Zara's OpenAI voice isn't available.");
  const result = readResult(await speak(text, voice));
  if (!result.ok) throw new Error(result.message);
  if (typeof result.value !== "string") throw new Error("Zara's OpenAI voice isn't available.");
  return result.value;
}

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
  /** spoken: the user said it (M4), so Zara answers aloud. */
  send: (text: string, options?: { spoken?: boolean }) => Promise<void>;
  newChat: () => void;
  /** M3: a fresh chat that isn't saved and teaches Zara nothing. */
  incognito: boolean;
  startIncognito: () => void;
  deleteConversation: (id: string) => Promise<void>;
  showHistory: () => Promise<void>;
  showChat: () => void;
  openConversation: (id: string) => Promise<void>;
  /**
   * Click-to-talk: start listening, or stop and send what was said.
   * Hands-free (Settings → Voice): open or close a listening session.
   * Either way it interrupts Zara if she's speaking.
   */
  toggleRecording: () => void;
  /** M4: Zara is reading her reply aloud. */
  speaking: boolean;
  /** M4: interrupt her — typing, the mic, and the hotkey call this. */
  stopSpeaking: () => void;
  /** M4: a hands-free listening session is open. */
  handsFree: boolean;
  /** M4: close the mic (e.g. the panel is closing). */
  stopListening: () => void;
  /** M4: e.g. why a Windows voice is speaking instead of OpenAI's. */
  voiceNotice: string | null;
  /** True while anything is in flight, the mic is open, or Zara is speaking — the panel must not auto-hide then. */
  busy: boolean;
}

/**
 * Zara chat state (ADR-006): one conversation at a time, streamed replies,
 * history, voice input (M2), and voice output (M4) — replies to spoken
 * messages are read aloud sentence by sentence as they stream in, and
 * anything the user does next interrupts her. The microphone and speech
 * are released on unmount.
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
  const [incognito, setIncognito] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const listenerRef = useRef<HandsFreeListener | null>(null);
  const conversationRef = useRef<string | null>(null);
  const incognitoRef = useRef(false);
  const sendingRef = useRef(false);
  // Hands-free: something said while Zara was still answering waits here.
  const pendingSpokenRef = useRef<string | null>(null);
  // Incognito chats aren't stored server-side, so the history travels with each message.
  const messagesRef = useRef<ChatMessage[]>([]);
  const speakerRef = useRef<Speaker | null>(null);
  if (speakerRef.current === null) {
    speakerRef.current = createSpeaker({
      output: createBrowserSpeechOutput(synthesizeViaBridge),
      getSettings: () => getVoicePreferences(),
      onSpeakingChange: setSpeaking,
      onNotice: setVoiceNotice,
    });
  }

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      listenerRef.current?.stop();
      listenerRef.current = null;
      speakerRef.current?.stop();
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    speakerRef.current?.stop();
  }, []);

  const send = useCallback(async (rawText: string, options?: { spoken?: boolean }): Promise<void> => {
    const text = rawText.trim();
    const bridge = window.desktopAPI;
    if (!text || !bridge?.chatSend) return;
    const spoken = options?.spoken === true;
    const speaker = speakerRef.current!;
    // A new message always interrupts whatever she was saying.
    speaker.stop();
    const chunker = spoken ? createSentenceChunker() : null;

    setView("chat");
    setError(null);
    setStatus(null);
    setVoiceNotice(null);
    setSending(true);
    sendingRef.current = true;
    const history = messagesRef.current
      .filter((m) => !m.streaming && m.content.trim() !== "")
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev.filter((m) => m.id !== STREAMING_ID),
      { id: `local-${Date.now()}`, role: "user", content: text },
      { id: STREAMING_ID, role: "assistant", content: "", streaming: true },
    ]);

    const onEvent = (raw: unknown) => {
      if (!isChatEvent(raw)) return;
      if (raw.type === "conversation") {
        if (incognitoRef.current) return;
        conversationRef.current = raw.id;
        setConversationId(raw.id);
      } else if (raw.type === "status") {
        setStatus(raw.text);
      } else if (raw.type === "delta") {
        setStatus(null);
        chunker?.push(raw.text).forEach((chunk) => speaker.say(chunk));
        setMessages((prev) =>
          prev.map((m) => (m.id === STREAMING_ID ? { ...m, content: m.content + raw.text } : m)),
        );
      } else if (raw.type === "done") {
        chunker?.flush().forEach((chunk) => speaker.say(chunk));
        setMessages((prev) => prev.map((m) => (m.id === STREAMING_ID ? { ...raw.message, streaming: false } : m)));
      } else if (raw.type === "error") {
        setError(raw.message);
      }
    };

    try {
      let raw: unknown;
      if (incognitoRef.current) {
        raw = await bridge.chatSend(null, text, onEvent, {
          incognito: true,
          history: history.slice(-20),
          ...(spoken ? { spoken: true } : {}),
        });
      } else if (spoken) {
        raw = await bridge.chatSend(conversationRef.current, text, onEvent, { spoken: true });
      } else {
        raw = await bridge.chatSend(conversationRef.current, text, onEvent);
      }
      const result = readResult(raw);
      if (!result.ok) setError(result.message);
    } catch {
      setError("Zara couldn't be reached. Please try again.");
    } finally {
      setSending(false);
      sendingRef.current = false;
      setStatus(null);
      // Drop an empty placeholder left behind by an error.
      setMessages((prev) =>
        prev.filter((m) => !(m.id === STREAMING_ID && m.content.trim() === "")).map((m) =>
          m.id === STREAMING_ID ? { ...m, streaming: false } : m,
        ),
      );
    }

    const pending = pendingSpokenRef.current;
    pendingSpokenRef.current = null;
    if (pending) await send(pending, { spoken: true });
  }, []);

  const resetChat = useCallback((asIncognito: boolean) => {
    speakerRef.current?.stop();
    conversationRef.current = null;
    incognitoRef.current = asIncognito;
    setIncognito(asIncognito);
    setConversationId(null);
    setMessages([]);
    setError(null);
    setStatus(null);
    setView("chat");
  }, []);

  const newChat = useCallback(() => resetChat(false), [resetChat]);
  const startIncognito = useCallback(() => resetChat(true), [resetChat]);

  const deleteConversation = useCallback(
    async (id: string) => {
      const result = readResult(await window.desktopAPI?.chatDelete?.(id).catch(() => null));
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationRef.current === id) resetChat(false);
    },
    [resetChat],
  );

  const showHistory = useCallback(async () => {
    setView("history");
    const raw = await window.desktopAPI?.chatList?.().catch(() => null);
    const list = raw && typeof raw === "object" ? (raw as { conversations?: unknown }).conversations : null;
    setConversations(Array.isArray(list) ? (list as ConversationSummary[]) : []);
  }, []);

  const showChat = useCallback(() => setView("chat"), []);

  const openConversation = useCallback(async (id: string) => {
    speakerRef.current?.stop();
    setError(null);
    incognitoRef.current = false;
    setIncognito(false);
    const raw = await window.desktopAPI?.chatMessages?.(id).catch(() => null);
    const list = raw && typeof raw === "object" ? (raw as { messages?: unknown }).messages : null;
    conversationRef.current = id;
    setConversationId(id);
    setMessages(Array.isArray(list) ? (list as ChatMessage[]) : []);
    setView("chat");
  }, []);

  /** Speech → text → sent as a spoken message, so Zara answers aloud. */
  const transcribeAndSend = useCallback(
    async (clip: RecordingResult, options: { handsFree?: boolean } = {}) => {
      const bridge = window.desktopAPI;
      if (!bridge?.chatTranscribe) return;
      setTranscribing(true);
      try {
        const result = readResult(
          await bridge.chatTranscribe(await blobToBase64(clip.blob), clip.mimeType, clip.durationSeconds),
        );
        if (!result.ok) {
          // Hands-free also hears coughs and door slams — don't nag about those.
          if (!(options.handsFree && /catch anything/i.test(result.message))) setError(result.message);
          return;
        }
        const text = typeof result.value === "string" ? result.value : "";
        if (!text.trim()) {
          if (!options.handsFree) setError("Didn't catch anything — try again.");
          return;
        }
        setTranscribing(false);
        if (sendingRef.current) {
          pendingSpokenRef.current = text;
          return;
        }
        await send(text, { spoken: true });
      } catch {
        setError("Couldn't transcribe that. Try again.");
      } finally {
        setTranscribing(false);
      }
    },
    [send],
  );

  const stopListening = useCallback(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setHandsFree(false);
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const startHandsFree = useCallback(() => {
    setError(null);
    setVoiceNotice(null);
    setView("chat");
    const listener = createHandsFreeListener({
      // Talking over Zara interrupts her.
      onSpeechStart: () => speakerRef.current?.stop(),
      onUtterance: (clip) => void transcribeAndSend(clip, { handsFree: true }),
      isZaraSpeaking: () => speakerRef.current?.isSpeaking() ?? false,
      onIdleTimeout: () => {
        listenerRef.current?.stop();
        listenerRef.current = null;
        setHandsFree(false);
        setVoiceNotice("Hands-free paused after a minute of quiet — press 🎤 to talk again.");
      },
    });
    listener
      .start()
      .then(() => {
        listenerRef.current = listener;
        setHandsFree(true);
      })
      .catch((err: unknown) => {
        listener.stop();
        setError(microphoneErrorMessage(err));
      });
  }, [transcribeAndSend]);

  const stopAndSend = useCallback(async () => {
    setRecording(false);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    const clip = await recorder.stop();
    if (!clip) {
      setError("No audio was recorded. Try again.");
      return;
    }
    await transcribeAndSend(clip);
  }, [transcribeAndSend]);

  const toggleRecording = useCallback(() => {
    speakerRef.current?.stop();
    if (handsFree) {
      stopListening();
      return;
    }
    if (recording) {
      void stopAndSend();
      return;
    }
    if (getVoicePreferences().inputMode === "handsfree") {
      startHandsFree();
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
  }, [handsFree, recording, stopAndSend, stopListening, startHandsFree]);

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
    incognito,
    startIncognito,
    deleteConversation,
    showHistory,
    showChat,
    openConversation,
    toggleRecording,
    speaking,
    stopSpeaking,
    handsFree,
    stopListening,
    voiceNotice,
    busy: sending || recording || transcribing || handsFree || speaking,
  };
}
