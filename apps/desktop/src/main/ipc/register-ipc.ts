import type { BrowserWindow, IpcMain } from "electron";
import { ApiClientError, type ApiClient } from "../api-client.js";
import { resizeOverlayToContent } from "../windows/overlay-window.js";

export interface ShellLike {
  openExternal(url: string): Promise<void>;
}

/** What chat IPC calls resolve with — a curated message on failure, never a raw error. */
export type ChatActionResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** The API's own curated message (400 input problems, 404, 409 e.g. "already undone", 502 provider problems), else the fallback. */
export function userFacingApiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError && err.apiMessage && [400, 404, 409, 502].includes(err.status)) {
    return err.apiMessage;
  }
  return fallback;
}

/** Runs an API call and settles it into a ChatActionResult — never rejects. */
export async function settle<T>(call: () => Promise<T>, fallback: string): Promise<ChatActionResult<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (err) {
    return { ok: false, message: userFacingApiMessage(err, fallback) };
  }
}

function requireId(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) throw new Error(`Invalid ${what}`);
  return value;
}

/** Incognito history from the renderer — validated and capped before it's forwarded. */
export function parseChatHistory(value: unknown): { role: "user" | "assistant"; content: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(
      (item): item is { role: "user" | "assistant"; content: string } =>
        !!item &&
        typeof item === "object" &&
        ((item as { role?: unknown }).role === "user" || (item as { role?: unknown }).role === "assistant") &&
        typeof (item as { content?: unknown }).content === "string",
    )
    .slice(-20)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }));
}

/** What the free-text/voice reminder IPC calls resolve with. */
export type ReminderCreateResult =
  | { ok: true; reminder: unknown }
  | { ok: false; message: string };

/**
 * Runs a reminder-creating API call, turning the API's own curated error
 * messages (400 input/setup problems, 502 Groq problems — e.g. "Your Groq
 * API key was rejected. Update it in Settings.") into a failure result the
 * renderer can show as-is. Anything else (500s, network errors) still
 * rejects, and the renderer falls back to a generic message.
 */
export async function toReminderCreateResult(
  call: () => Promise<unknown>,
): Promise<ReminderCreateResult> {
  try {
    return { ok: true, reminder: await call() };
  } catch (err) {
    if (
      err instanceof ApiClientError &&
      err.apiMessage &&
      (err.status === 400 || err.status === 502)
    ) {
      return { ok: false, message: err.apiMessage };
    }
    throw err;
  }
}

/**
 * ADR-006: OpenAI chat models offered in Settings, cheapest first, with the
 * default. Prices are Sept 28, 2026 estimates — shown as a guide only.
 */
export const OPENAI_MODEL_CHOICES = [
  { id: "gpt-5-nano", label: "gpt-5-nano — cheapest" },
  { id: "gpt-6-luna", label: "gpt-6-luna — recommended" },
  { id: "gpt-6-sol", label: "gpt-6-sol — most capable (~20× cost)" },
] as const;
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

export function isOpenAiModelChoice(value: unknown): value is (typeof OPENAI_MODEL_CHOICES)[number]["id"] {
  return OPENAI_MODEL_CHOICES.some((choice) => choice.id === value);
}

export function registerIpc(options: {
  ipcMain: IpcMain;
  getWindow: () => BrowserWindow | null;
  api: ApiClient;
  apiUrl: string;
  shell: ShellLike;
  /** Whether a Groq key is currently configured (via .env or the settings UI) — fixed for this process's lifetime. Since ADR-006 Groq is the optional fallback. */
  groqKeyConfigured: boolean;
  /** ADR-006: whether an OpenAI key (the primary provider) is configured — fixed for this process's lifetime. */
  openaiKeyConfigured: boolean;
  /** ADR-006: the OpenAI chat model in effect for this process. */
  openaiModel: string;
  /** Whether Google OAuth client credentials are currently configured (via .env or the settings UI) — fixed for this process's lifetime. See Phase 4.7. */
  googleOAuthConfigured: boolean;
  /** Whether secrets are actually OS-keychain-encrypted (false = platform/environment has no keychain; stored as plain base64 instead — Settings should warn). */
  secureStorageAvailable: boolean;
  /** Set if the embedded API failed to start — shown by the renderer instead of a silent blank overlay. */
  startupError: string | null;
  /** Reactive, unlike the flags above — can flip true mid-session if a sync call comes back 401/403 (expired/revoked Google auth). See index.ts's performCheckNow. */
  getGoogleAuthError: () => boolean;
  /** Reactive — epoch ms of the last check attempt (scheduled or manual), or null if none yet this session. Lets the renderer show "last checked Xm ago". */
  getLastCheckedAt: () => number | null;
  /** Persists the key and restarts the whole app so the embedded API picks it up (see docs/SINGLE_PROCESS_DESKTOP.md). */
  saveGroqKeyAndRestart: (key: string) => void;
  /** Same restart-required rationale as the Groq key. */
  saveOpenAiKeyAndRestart: (key: string) => void;
  saveOpenAiModelAndRestart: (model: string) => void;
  /** Same restart-required rationale as the Groq key — see docs/SINGLE_PROCESS_DESKTOP.md. */
  saveGoogleCredentialsAndRestart: (clientId: string, clientSecret: string) => void;
}): void {
  const {
    ipcMain,
    getWindow,
    api,
    apiUrl,
    shell,
    groqKeyConfigured,
    openaiKeyConfigured,
    openaiModel,
    googleOAuthConfigured,
    secureStorageAvailable,
    startupError,
    getGoogleAuthError,
    getLastCheckedAt,
    saveGroqKeyAndRestart,
    saveOpenAiKeyAndRestart,
    saveOpenAiModelAndRestart,
    saveGoogleCredentialsAndRestart,
  } = options;

  ipcMain.handle("inbox:get", async () => api.fetchInbox());

  ipcMain.handle("intervention:done", async (_event, id: unknown) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Invalid intervention id");
    }
    return api.resolve(id);
  });

  ipcMain.handle(
    "intervention:snooze",
    async (_event, id: unknown, minutes: unknown) => {
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("Invalid intervention id");
      }
      if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1) {
        throw new Error("Invalid snooze duration");
      }
      return api.snooze(id, minutes);
    },
  );

  ipcMain.handle("integrations:connect-google", async () => {
    await shell.openExternal(`${apiUrl}/api/v1/integrations/google/connect`);
  });

  ipcMain.handle("intervention:open-source", async (_event, url: unknown) => {
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("Invalid source URL");
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Invalid source URL");
    }
    // Only ever open http(s) — never file://, custom app schemes, etc.,
    // regardless of what the API happened to send.
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Unsupported URL protocol");
    }
    await shell.openExternal(url);
  });

  ipcMain.handle("settings:get", async () => ({
    groqKeyConfigured,
    openaiKeyConfigured,
    openaiModel,
    openaiModelChoices: OPENAI_MODEL_CHOICES,
    googleOAuthConfigured,
    secureStorageAvailable,
    startupError,
    googleAuthError: getGoogleAuthError(),
    lastCheckedAt: getLastCheckedAt(),
  }));

  ipcMain.handle("settings:save-openai-key", async (_event, key: unknown) => {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new Error("Invalid OpenAI API key");
    }
    saveOpenAiKeyAndRestart(key.trim());
  });

  ipcMain.handle("settings:save-openai-model", async (_event, model: unknown) => {
    if (!isOpenAiModelChoice(model)) {
      throw new Error("Unsupported OpenAI model");
    }
    saveOpenAiModelAndRestart(model);
  });

  ipcMain.handle("usage:summary", async () => api.usageSummary());

  // ADR-006 (M3): chat deletion, memory page, activity log.
  ipcMain.handle("chat:delete", async (_event, id: unknown) =>
    settle(() => api.deleteConversation(requireId(id, "conversation id")), "Couldn't delete that chat."),
  );
  ipcMain.handle("chat:delete-all", async () => settle(() => api.deleteAllConversations(), "Couldn't delete your chats."));
  ipcMain.handle("memory:list", async () => settle(() => api.listMemory(), "Couldn't load your memory."));
  ipcMain.handle("memory:update", async (_event, id: unknown, content: unknown) => {
    if (typeof content !== "string" || content.trim().length === 0) {
      return { ok: false, message: "A memory can't be empty." } satisfies ChatActionResult<never>;
    }
    return settle(() => api.updateMemory(requireId(id, "memory id"), content.trim()), "Couldn't update that memory.");
  });
  ipcMain.handle("memory:delete", async (_event, id: unknown) =>
    settle(() => api.deleteMemory(requireId(id, "memory id")), "Couldn't delete that memory."),
  );
  ipcMain.handle("memory:delete-all", async () => settle(() => api.deleteAllMemory(), "Couldn't clear your memory."));
  ipcMain.handle("activity:list", async () => settle(() => api.listActivity(), "Couldn't load the activity log."));
  ipcMain.handle("activity:undo", async (_event, id: unknown) =>
    settle(() => api.undoActivity(requireId(id, "activity id")), "Couldn't undo that."),
  );
  ipcMain.handle("activity:clear", async () => settle(() => api.clearActivity(), "Couldn't clear the activity log."));

  // ADR-006 (M2): Zara chat.
  ipcMain.handle("chat:list", async () => api.listConversations());

  ipcMain.handle("chat:messages", async (_event, conversationId: unknown) => {
    if (typeof conversationId !== "string" || conversationId.length === 0) {
      throw new Error("Invalid conversation id");
    }
    return api.getConversationMessages(conversationId);
  });

  ipcMain.handle(
    "chat:transcribe",
    async (_event, audioBase64: unknown, mimeType: unknown, durationSeconds: unknown): Promise<ChatActionResult<string>> => {
      if (typeof audioBase64 !== "string" || audioBase64.length === 0) return { ok: false, message: "No audio was recorded. Try again." };
      if (typeof mimeType !== "string" || mimeType.length === 0) return { ok: false, message: "Invalid audio format." };
      const duration =
        typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 600
          ? durationSeconds
          : undefined;
      try {
        const result = (await api.transcribe(audioBase64, mimeType, duration)) as { text?: unknown };
        return typeof result?.text === "string"
          ? { ok: true, value: result.text }
          : { ok: false, message: "Couldn't understand the recording. Try again." };
      } catch (err) {
        return { ok: false, message: userFacingApiMessage(err, "Couldn't transcribe that. Try again.") };
      }
    },
  );

  // Streams Zara's reply to the requesting window as "chat:event" messages
  // tagged with the renderer's requestId; resolves once the reply is complete.
  ipcMain.handle(
    "chat:send",
    async (
      event,
      requestId: unknown,
      conversationId: unknown,
      text: unknown,
      options: unknown,
    ): Promise<ChatActionResult<null>> => {
      if (typeof requestId !== "string" || requestId.length === 0) throw new Error("Invalid request id");
      if (typeof text !== "string" || text.trim().length === 0) return { ok: false, message: "Type a message first." };
      if (conversationId !== undefined && conversationId !== null && typeof conversationId !== "string") {
        throw new Error("Invalid conversation id");
      }
      const incognito = !!options && typeof options === "object" && (options as { incognito?: unknown }).incognito === true;
      try {
        await api.sendChatMessage(
          {
            conversationId: !incognito && typeof conversationId === "string" ? conversationId : undefined,
            text: text.trim(),
            ...(incognito
              ? { incognito: true, history: parseChatHistory((options as { history?: unknown }).history) ?? [] }
              : {}),
          },
          (chatEvent) => {
            if (!event.sender.isDestroyed()) event.sender.send("chat:event", requestId, chatEvent);
          },
        );
        return { ok: true, value: null };
      } catch (err) {
        return { ok: false, message: userFacingApiMessage(err, "Zara couldn't be reached. Please try again.") };
      }
    },
  );

  ipcMain.handle("settings:save-groq-key", async (_event, key: unknown) => {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new Error("Invalid Groq API key");
    }
    saveGroqKeyAndRestart(key.trim());
  });

  ipcMain.handle(
    "settings:save-google-credentials",
    async (_event, clientId: unknown, clientSecret: unknown) => {
      if (typeof clientId !== "string" || clientId.trim().length === 0) {
        throw new Error("Invalid Google Client ID");
      }
      if (typeof clientSecret !== "string" || clientSecret.trim().length === 0) {
        throw new Error("Invalid Google Client Secret");
      }
      saveGoogleCredentialsAndRestart(clientId.trim(), clientSecret.trim());
    },
  );

  ipcMain.handle("integrations:google-status", async () => api.googleStatus());

  ipcMain.handle("integrations:disconnect-google", async () => api.disconnectGoogle());

  ipcMain.handle("assistant:check-now", async () => api.checkNow());

  ipcMain.handle("reminders:create", async (_event, text: unknown, dueAt: unknown) => {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("Invalid reminder text");
    }
    if (typeof dueAt !== "string" || Number.isNaN(new Date(dueAt).getTime())) {
      throw new Error("Invalid reminder due date");
    }
    return api.createReminder(text, dueAt);
  });

  ipcMain.handle("reminders:create-from-text", async (_event, text: unknown) => {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("Invalid reminder text");
    }
    return toReminderCreateResult(() => api.createReminderFromText(text));
  });

  ipcMain.handle(
    "reminders:create-from-voice",
    async (_event, audioBase64: unknown, mimeType: unknown, durationSeconds: unknown) => {
      if (typeof audioBase64 !== "string" || audioBase64.length === 0) {
        throw new Error("Invalid audio data");
      }
      if (typeof mimeType !== "string" || mimeType.length === 0) {
        throw new Error("Invalid audio mime type");
      }
      // Only used for the usage estimate — drop anything implausible rather than reject the recording.
      const duration =
        typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 600
          ? durationSeconds
          : undefined;
      return toReminderCreateResult(() => api.createReminderFromVoice(audioBase64, mimeType, duration));
    },
  );

  ipcMain.on("overlay:set-interactive", (_event, interactive: unknown) => {
    const win = getWindow();
    if (!win) return;
    if (interactive === true) {
      win.setIgnoreMouseEvents(false);
    } else {
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  ipcMain.on("overlay:content-size", (_event, _width: unknown, height: unknown) => {
    const win = getWindow();
    if (!win || typeof height !== "number" || !Number.isFinite(height)) return;
    resizeOverlayToContent(win, height);
  });
}
