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
  saveGoogleCredentials(clientId: string, clientSecret: string): Promise<void>;
  googleStatus(): Promise<unknown>;
  disconnectGoogle(): Promise<unknown>;
  checkNow(): Promise<unknown>;
  createReminder(text: string, dueAt: string): Promise<unknown>;
  createReminderFromText(text: string): Promise<unknown>;
  createReminderFromVoice(audioBase64: string, mimeType: string): Promise<unknown>;
  /** Fires when the main process's background scheduler finishes a check; returns an unsubscribe function. */
  onInboxChanged(callback: () => void): () => void;
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
  saveGoogleCredentials: (clientId, clientSecret) =>
    ipcRenderer.invoke("settings:save-google-credentials", clientId, clientSecret),
  googleStatus: () => ipcRenderer.invoke("integrations:google-status"),
  disconnectGoogle: () => ipcRenderer.invoke("integrations:disconnect-google"),
  checkNow: () => ipcRenderer.invoke("assistant:check-now"),
  createReminder: (text, dueAt) => ipcRenderer.invoke("reminders:create", text, dueAt),
  createReminderFromText: (text) => ipcRenderer.invoke("reminders:create-from-text", text),
  createReminderFromVoice: (audioBase64, mimeType) =>
    ipcRenderer.invoke("reminders:create-from-voice", audioBase64, mimeType),
  onInboxChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("inbox:changed", listener);
    return () => ipcRenderer.removeListener("inbox:changed", listener);
  },
};

contextBridge.exposeInMainWorld("desktopAPI", bridge);
