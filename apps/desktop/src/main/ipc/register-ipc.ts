import type { BrowserWindow, IpcMain } from "electron";
import { ApiClientError, type ApiClient } from "../api-client.js";
import { resizeOverlayToContent } from "../windows/overlay-window.js";

export interface ShellLike {
  openExternal(url: string): Promise<void>;
  /** M6: open the documents folder in Explorer. Resolves "" on success, else an error message. */
  openPath?(path: string): Promise<string>;
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

/** M4: a chunk of Zara's reply to speak — trimmed, non-empty, within the API's limit. */
export function parseSpeakRequest(text: unknown, voice: unknown): { text: string; voice: string } | null {
  if (typeof text !== "string" || typeof voice !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 1000 || !/^[a-z]{2,20}$/.test(voice)) return null;
  return { text: trimmed, voice };
}

const PROACTIVE_FIELDS: Record<string, "boolean" | "number" | "string"> = {
  briefingEnabled: "boolean",
  briefingMode: "string",
  briefingWeekdaysOnly: "boolean",
  wrapUpEnabled: "boolean",
  wrapUpTime: "string",
  preMeetingBriefEnabled: "boolean",
  followUpEnabled: "boolean",
  followUpDays: "number",
  promiseRemindersEnabled: "boolean",
  promiseRemindTime: "string",
  promiseSameDayLeadHours: "number",
  holdDuringFocus: "boolean",
  quietHoursEnabled: "boolean",
  quietHoursStart: "string",
  quietHoursEnd: "string",
};

const PRESET_IDS = ["local_files", "google_drive", "web_search", "github", "notion", "slack", "browser", "custom"];

function stringRecord(value: unknown, maxKeys: number): Record<string, string> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maxKeys) return null;
  const out: Record<string, string> = {};
  for (const [key, field] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || typeof field !== "string" || field.length > 2000) return null;
    out[key] = field;
  }
  return out;
}

/** M8: a new connection from the renderer — known preset, string secrets, optional custom command/args. Folders are never taken from here. */
export function parseConnectionInput(value: unknown): { preset: string; name?: string; secrets: Record<string, string>; command?: string; args?: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.preset !== "string" || !PRESET_IDS.includes(input.preset)) return null;
  const secrets = stringRecord(input.secrets, 20);
  if (!secrets) return null;
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 60)) return null;
  if (input.command !== undefined && (typeof input.command !== "string" || input.command.length > 300)) return null;
  if (input.args !== undefined && (!Array.isArray(input.args) || input.args.length > 30 || input.args.some((arg) => typeof arg !== "string" || arg.length > 300))) return null;
  return {
    preset: input.preset,
    secrets,
    ...(typeof input.name === "string" ? { name: input.name } : {}),
    ...(typeof input.command === "string" ? { command: input.command } : {}),
    ...(Array.isArray(input.args) ? { args: input.args as string[] } : {}),
  };
}

export function parseConnectionPatch(value: unknown): { enabled?: boolean; secrets?: Record<string, string> } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const out: { enabled?: boolean; secrets?: Record<string, string> } = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") return null;
    out.enabled = input.enabled;
  }
  if (input.secrets !== undefined) {
    const secrets = stringRecord(input.secrets, 20);
    if (!secrets) return null;
    out.secrets = secrets;
  }
  return Object.keys(out).length ? out : null;
}

const INVALID = Symbol("invalid");

/** M7: the user's edits to a card — a plain object of modest size, or nothing (approve as is). The API validates the fields. */
export function parseApprovePayload(value: unknown): unknown | typeof INVALID {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return INVALID;
  try {
    return JSON.stringify(value).length <= 30_000 ? value : INVALID;
  } catch {
    return INVALID;
  }
}

/** M6: recall settings patch from the renderer — toggles and the history length only (folders come from the picker). */
export function parseRecallPatch(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  for (const [key, field] of entries) {
    if (key === "documentsEnabled" || key === "peopleEnabled") {
      if (typeof field !== "boolean") return null;
    } else if (key === "emailHistoryDays") {
      if (field !== 30 && field !== 90) return null;
    } else if (key === "documentsFolder") {
      if (field !== null) return null; // only "reset to default"
    } else {
      return null;
    }
  }
  return Object.fromEntries(entries);
}

/** M5: a settings patch from the renderer — known fields with the right types only (the API validates values). */
export function parseProactivePatch(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  for (const [key, field] of entries) {
    const expected = PROACTIVE_FIELDS[key];
    if (!expected || typeof field !== expected) return null;
    if (typeof field === "string" && field.length > 20) return null;
  }
  return Object.fromEntries(entries);
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
  /** M6: native folder picker for the documents folder; null when cancelled. */
  chooseFolder?: () => Promise<string | null>;
  /** M8: native picker for one or more folders (Local files connection); [] when cancelled. */
  chooseFolders?: () => Promise<string[]>;
  /** M5: whether pop-ups are held right now (full-screen, presentation, call, quiet hours). */
  getHoldState: () => { holding: boolean; reason: string | null };
  /** M5: settings changed — re-evaluate holds right away. */
  onProactiveSettingsChanged?: () => void;
  /** M4: the Zara shortcut currently registered (null if another app holds it). */
  getChatHotkey: () => string | null;
  /** M4: validates, re-registers, and persists a new shortcut — takes effect immediately. */
  changeChatHotkey: (accelerator: unknown) => { ok: true; accelerator: string } | { ok: false; message: string };
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
    getChatHotkey,
    changeChatHotkey,
    getHoldState,
    onProactiveSettingsChanged,
    chooseFolder,
    chooseFolders,
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
    chatHotkey: getChatHotkey(),
    hold: getHoldState(),
  }));

  // ADR-006 (M7): approval cards. Approve/cancel only ever come from the user's click here.
  ipcMain.handle("actions:list", async () => settle(() => api.listActions(), "Couldn't load your approval cards."));
  ipcMain.handle("actions:approve", async (_event, id: unknown, payload: unknown, trustTool: unknown) => {
    const parsed = parseApprovePayload(payload);
    if (parsed === INVALID) return { ok: false, message: "Those edits aren't valid." } satisfies ChatActionResult<never>;
    return settle(
      () => api.approveAction(requireId(id, "action id"), parsed, trustTool === true),
      "Couldn't approve that — try again.",
    );
  });

  // ADR-006 (M8): connections. Folders come from the native picker here, never from the renderer.
  ipcMain.handle("connections:list", async () => settle(() => api.listConnections(), "Couldn't load your connections."));
  ipcMain.handle("connections:add", async (_event, input: unknown) => {
    const parsed = parseConnectionInput(input);
    if (!parsed) return { ok: false, message: "That connection isn't valid." } satisfies ChatActionResult<never>;
    if (parsed.preset === "local_files") {
      const folders = (await chooseFolders?.()) ?? [];
      if (folders.length === 0) return { ok: true, value: null } satisfies ChatActionResult<null>;
      return settle(() => api.addConnection({ ...parsed, folders }), "Couldn't add that connection.");
    }
    return settle(() => api.addConnection(parsed), "Couldn't add that connection.");
  });
  ipcMain.handle("connections:update", async (_event, id: unknown, patch: unknown) => {
    const parsed = parseConnectionPatch(patch);
    if (!parsed) return { ok: false, message: "That change isn't valid." } satisfies ChatActionResult<never>;
    return settle(() => api.updateConnection(requireId(id, "connection id"), parsed), "Couldn't update that connection.");
  });
  ipcMain.handle("connections:restart", async (_event, id: unknown) =>
    settle(() => api.restartConnection(requireId(id, "connection id")), "Couldn't restart it."),
  );
  ipcMain.handle("connections:remove", async (_event, id: unknown) =>
    settle(() => api.removeConnection(requireId(id, "connection id")), "Couldn't remove it."),
  );
  ipcMain.handle("connections:tool-policy", async (_event, id: unknown, tool: unknown, patch: unknown) => {
    if (typeof tool !== "string" || tool.length === 0 || tool.length > 128) return { ok: false, message: "Unknown tool." } satisfies ChatActionResult<never>;
    const value = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
    const clean = {
      ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
      ...(typeof value.trusted === "boolean" ? { trusted: value.trusted } : {}),
    };
    if (Object.keys(clean).length === 0) return { ok: false, message: "Nothing to change." } satisfies ChatActionResult<never>;
    return settle(() => api.setToolPolicy(requireId(id, "connection id"), tool, clean), "Couldn't change that tool.");
  });
  ipcMain.handle("actions:cancel", async (_event, id: unknown) =>
    settle(() => api.cancelAction(requireId(id, "action id")), "Couldn't cancel that."),
  );
  ipcMain.handle("actions:get-settings", async () => settle(() => api.actionSettings(), "Couldn't load these settings."));
  ipcMain.handle("actions:update-settings", async (_event, writingStyle: unknown) => {
    if (typeof writingStyle !== "string" || writingStyle.length > 4000) {
      return { ok: false, message: "Keep the style notes under 4,000 characters." } satisfies ChatActionResult<never>;
    }
    return settle(() => api.updateActionSettings(writingStyle), "Couldn't save that.");
  });

  // ADR-006 (M6): recall settings, status, re-index, documents folder.
  ipcMain.handle("recall:get-settings", async () => settle(() => api.recallSettings(), "Couldn't load recall settings."));
  ipcMain.handle("recall:status", async () => settle(() => api.recallStatus(), "Couldn't load the index status."));
  ipcMain.handle("recall:index", async () => settle(() => api.recallIndex(), "Couldn't start indexing."));
  ipcMain.handle("recall:update-settings", async (_event, patch: unknown) => {
    const parsed = parseRecallPatch(patch);
    if (!parsed) return { ok: false, message: "Those settings aren't valid." } satisfies ChatActionResult<never>;
    return settle(() => api.updateRecallSettings(parsed), "Couldn't save that.");
  });
  // The folder comes from the native picker in the main process — the renderer never sends a path.
  ipcMain.handle("recall:choose-folder", async () => {
    const folder = (await chooseFolder?.()) ?? null;
    if (!folder) return { ok: true, value: null } satisfies ChatActionResult<null>;
    return settle(() => api.updateRecallSettings({ documentsFolder: folder }), "Couldn't use that folder.");
  });
  ipcMain.handle("recall:open-folder", async () => {
    const result = await settle(() => api.recallSettings(), "Couldn't find the folder.");
    if (!result.ok) return result;
    const folder = (result.value as { documentsFolder?: unknown }).documentsFolder;
    if (typeof folder !== "string" || !shell.openPath) return { ok: false, message: "Couldn't open the folder." };
    const error = await shell.openPath(folder);
    return error ? { ok: false, message: "Couldn't open the folder." } : { ok: true, value: null };
  });

  // ADR-006 (M5): proactive settings and "show the briefing now".
  ipcMain.handle("proactive:get-settings", async () => settle(() => api.proactiveSettings(), "Couldn't load these settings."));
  ipcMain.handle("proactive:update-settings", async (_event, patch: unknown) => {
    const parsed = parseProactivePatch(patch);
    if (!parsed) return { ok: false, message: "Those settings aren't valid." } satisfies ChatActionResult<never>;
    const result = await settle(() => api.updateProactiveSettings(parsed), "Couldn't save that — check the times (HH:MM).");
    if (result.ok) onProactiveSettingsChanged?.();
    return result;
  });
  ipcMain.handle("proactive:briefing-now", async (_event, kind: unknown) => {
    if (kind !== "morning" && kind !== "wrap_up") return { ok: false, message: "Unknown briefing." } satisfies ChatActionResult<never>;
    return settle(() => api.deliverBriefing(kind, true), "Couldn't prepare the briefing right now.");
  });

  ipcMain.handle("settings:save-hotkey", async (_event, accelerator: unknown) => changeChatHotkey(accelerator));

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
    async (
      _event,
      audioBase64: unknown,
      mimeType: unknown,
      durationSeconds: unknown,
      script: unknown,
    ): Promise<ChatActionResult<string>> => {
      if (typeof audioBase64 !== "string" || audioBase64.length === 0) return { ok: false, message: "No audio was recorded. Try again." };
      if (typeof mimeType !== "string" || mimeType.length === 0) return { ok: false, message: "Invalid audio format." };
      const duration =
        typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 600
          ? durationSeconds
          : undefined;
      try {
        const hindiScript = script === "devanagari" ? "devanagari" : "latin";
        const result = (await api.transcribe(audioBase64, mimeType, duration, hindiScript)) as { text?: unknown };
        return typeof result?.text === "string"
          ? { ok: true, value: result.text }
          : { ok: false, message: "Couldn't understand the recording. Try again." };
      } catch (err) {
        return { ok: false, message: userFacingApiMessage(err, "Couldn't transcribe that. Try again.") };
      }
    },
  );

  // M4: one chunk of Zara's reply → MP3. On failure the renderer falls back
  // to a local Windows voice and shows the message once.
  ipcMain.handle("chat:speak", async (_event, text: unknown, voice: unknown) => {
    const parsed = parseSpeakRequest(text, voice);
    if (!parsed) return { ok: false, message: "Nothing to say." } satisfies ChatActionResult<never>;
    return settle(async () => {
      const result = (await api.speak(parsed.text, parsed.voice)) as { audioBase64?: unknown };
      if (typeof result?.audioBase64 !== "string") throw new Error("No audio returned");
      return result.audioBase64;
    }, "Zara's OpenAI voice isn't available right now.");
  });

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
      const spoken = !!options && typeof options === "object" && (options as { spoken?: unknown }).spoken === true;
      const continueRaw = options && typeof options === "object" ? (options as { continueActionId?: unknown }).continueActionId : undefined;
      const continueActionId = typeof continueRaw === "string" && continueRaw.length > 0 && continueRaw.length <= 100 ? continueRaw : undefined;
      try {
        await api.sendChatMessage(
          {
            conversationId: !incognito && typeof conversationId === "string" ? conversationId : undefined,
            text: text.trim(),
            ...(spoken ? { spoken: true } : {}),
            ...(continueActionId ? { continueActionId } : {}),
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
