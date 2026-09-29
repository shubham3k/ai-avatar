import { contextBridge, ipcRenderer } from "electron";

export interface DesktopApiBridge {
  fetchInbox(): Promise<unknown>;
  markDone(interventionId: string): Promise<unknown>;
  snooze(interventionId: string, minutes: number): Promise<unknown>;
  setInteractive(interactive: boolean): void;
  reportContentSize(width: number, height: number): void;
  connectGoogle(): Promise<void>;
  openSource(url: string): Promise<void>;
  getSettings(): Promise<unknown>;
  saveGroqKey(key: string): Promise<void>;
  /** ADR-006: primary AI provider key; saving restarts the app. */
  saveOpenAiKey(key: string): Promise<void>;
  saveOpenAiModel(model: string): Promise<void>;
  getUsageSummary(): Promise<unknown>;
  saveGoogleCredentials(clientId: string, clientSecret: string): Promise<void>;
  googleStatus(): Promise<unknown>;
  disconnectGoogle(): Promise<unknown>;
  checkNow(): Promise<unknown>;
  createReminder(text: string, dueAt: string): Promise<unknown>;
  createReminderFromText(text: string): Promise<unknown>;
  createReminderFromVoice(audioBase64: string, mimeType: string, durationSeconds?: number): Promise<unknown>;
  /** Fires when the main process's background scheduler finishes a check; returns an unsubscribe function. */
  onInboxChanged(callback: () => void): () => void;
  /** ADR-006 (M2): Zara chat. */
  chatList(): Promise<unknown>;
  chatMessages(conversationId: string): Promise<unknown>;
  chatTranscribe(
    audioBase64: string,
    mimeType: string,
    durationSeconds?: number,
    script?: "latin" | "devanagari",
  ): Promise<unknown>;
  /** Streams Zara's reply through onEvent; resolves `{ ok, value | message }` when the reply is complete. */
  chatSend(
    conversationId: string | null,
    text: string,
    onEvent: (event: unknown) => void,
    options?: ChatSendOptions,
  ): Promise<unknown>;
  /** ADR-006 (M3): each resolves `{ ok, value | message }`. */
  chatDelete(conversationId: string): Promise<unknown>;
  chatDeleteAll(): Promise<unknown>;
  memoryList(): Promise<unknown>;
  memoryUpdate(factId: string, content: string): Promise<unknown>;
  memoryDelete(factId: string): Promise<unknown>;
  memoryDeleteAll(): Promise<unknown>;
  activityList(): Promise<unknown>;
  activityUndo(entryId: string): Promise<unknown>;
  activityClear(): Promise<unknown>;
  /** ADR-006 (M4): voice. chatSpeak resolves `{ ok, value: base64 MP3 | message }`. */
  chatSpeak(text: string, voice: string): Promise<unknown>;
  saveChatHotkey(accelerator: string): Promise<unknown>;
  /** Fires when the global Zara shortcut is pressed; returns an unsubscribe function. */
  onHotkey(callback: () => void): () => void;
  /** ADR-006 (M5): proactive settings, briefing now, hold state, briefing delivery. */
  proactiveGetSettings(): Promise<unknown>;
  proactiveUpdateSettings(patch: Record<string, unknown>): Promise<unknown>;
  proactiveBriefingNow(kind: "morning" | "wrap_up"): Promise<unknown>;
  onHoldChanged(callback: (state: unknown) => void): () => void;
  onBriefing(callback: (briefing: unknown) => void): () => void;
}

export interface ChatSendOptions {
  incognito?: boolean;
  /** M4: the user spoke this message. */
  spoken?: boolean;
  history?: { role: "user" | "assistant"; content: string }[];
}

const bridge: DesktopApiBridge = {
  fetchInbox: () => ipcRenderer.invoke("inbox:get"),
  markDone: (interventionId) => ipcRenderer.invoke("intervention:done", interventionId),
  snooze: (interventionId, minutes) =>
    ipcRenderer.invoke("intervention:snooze", interventionId, minutes),
  setInteractive: (interactive) => ipcRenderer.send("overlay:set-interactive", interactive),
  reportContentSize: (width, height) => ipcRenderer.send("overlay:content-size", width, height),
  connectGoogle: () => ipcRenderer.invoke("integrations:connect-google"),
  openSource: (url) => ipcRenderer.invoke("intervention:open-source", url),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveGroqKey: (key) => ipcRenderer.invoke("settings:save-groq-key", key),
  saveOpenAiKey: (key) => ipcRenderer.invoke("settings:save-openai-key", key),
  saveOpenAiModel: (model) => ipcRenderer.invoke("settings:save-openai-model", model),
  getUsageSummary: () => ipcRenderer.invoke("usage:summary"),
  saveGoogleCredentials: (clientId, clientSecret) =>
    ipcRenderer.invoke("settings:save-google-credentials", clientId, clientSecret),
  googleStatus: () => ipcRenderer.invoke("integrations:google-status"),
  disconnectGoogle: () => ipcRenderer.invoke("integrations:disconnect-google"),
  checkNow: () => ipcRenderer.invoke("assistant:check-now"),
  createReminder: (text, dueAt) => ipcRenderer.invoke("reminders:create", text, dueAt),
  createReminderFromText: (text) => ipcRenderer.invoke("reminders:create-from-text", text),
  createReminderFromVoice: (audioBase64, mimeType, durationSeconds) =>
    ipcRenderer.invoke("reminders:create-from-voice", audioBase64, mimeType, durationSeconds),
  onInboxChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("inbox:changed", listener);
    return () => ipcRenderer.removeListener("inbox:changed", listener);
  },
  chatList: () => ipcRenderer.invoke("chat:list"),
  chatMessages: (conversationId) => ipcRenderer.invoke("chat:messages", conversationId),
  chatTranscribe: (audioBase64, mimeType, durationSeconds, script) =>
    ipcRenderer.invoke("chat:transcribe", audioBase64, mimeType, durationSeconds, script),
  chatSend: (conversationId, text, onEvent, options) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: unknown, chatEvent: unknown) => {
      if (id === requestId) onEvent(chatEvent);
    };
    ipcRenderer.on("chat:event", listener);
    return ipcRenderer
      .invoke("chat:send", requestId, conversationId, text, options)
      .finally(() => ipcRenderer.removeListener("chat:event", listener));
  },
  chatDelete: (conversationId) => ipcRenderer.invoke("chat:delete", conversationId),
  chatDeleteAll: () => ipcRenderer.invoke("chat:delete-all"),
  memoryList: () => ipcRenderer.invoke("memory:list"),
  memoryUpdate: (factId, content) => ipcRenderer.invoke("memory:update", factId, content),
  memoryDelete: (factId) => ipcRenderer.invoke("memory:delete", factId),
  memoryDeleteAll: () => ipcRenderer.invoke("memory:delete-all"),
  activityList: () => ipcRenderer.invoke("activity:list"),
  activityUndo: (entryId) => ipcRenderer.invoke("activity:undo", entryId),
  activityClear: () => ipcRenderer.invoke("activity:clear"),
  chatSpeak: (text, voice) => ipcRenderer.invoke("chat:speak", text, voice),
  saveChatHotkey: (accelerator) => ipcRenderer.invoke("settings:save-hotkey", accelerator),
  onHotkey: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("zara:hotkey", listener);
    return () => ipcRenderer.removeListener("zara:hotkey", listener);
  },
  proactiveGetSettings: () => ipcRenderer.invoke("proactive:get-settings"),
  proactiveUpdateSettings: (patch) => ipcRenderer.invoke("proactive:update-settings", patch),
  proactiveBriefingNow: (kind) => ipcRenderer.invoke("proactive:briefing-now", kind),
  onHoldChanged: (callback) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("proactive:hold", listener);
    return () => ipcRenderer.removeListener("proactive:hold", listener);
  },
  onBriefing: (callback) => {
    const listener = (_event: unknown, briefing: unknown) => callback(briefing);
    ipcRenderer.on("zara:briefing", listener);
    return () => ipcRenderer.removeListener("zara:briefing", listener);
  },
};

contextBridge.exposeInMainWorld("desktopAPI", bridge);
