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
  chatTranscribe(audioBase64: string, mimeType: string, durationSeconds?: number): Promise<unknown>;
  /** Streams Zara's reply through onEvent; resolves `{ ok, value | message }` when the reply is complete. */
  chatSend(conversationId: string | null, text: string, onEvent: (event: unknown) => void): Promise<unknown>;
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
  chatTranscribe: (audioBase64, mimeType, durationSeconds) =>
    ipcRenderer.invoke("chat:transcribe", audioBase64, mimeType, durationSeconds),
  chatSend: (conversationId, text, onEvent) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: unknown, id: unknown, chatEvent: unknown) => {
      if (id === requestId) onEvent(chatEvent);
    };
    ipcRenderer.on("chat:event", listener);
    return ipcRenderer
      .invoke("chat:send", requestId, conversationId, text)
      .finally(() => ipcRenderer.removeListener("chat:event", listener));
  },
};

contextBridge.exposeInMainWorld("desktopAPI", bridge);
