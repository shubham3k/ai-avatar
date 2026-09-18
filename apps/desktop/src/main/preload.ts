import { contextBridge, ipcRenderer } from "electron";

export interface DesktopApiBridge {
  fetchInbox(): Promise<unknown>;
  markDone(interventionId: string): Promise<unknown>;
  snooze(interventionId: string, minutes: number): Promise<unknown>;
  setInteractive(interactive: boolean): void;
  connectGoogle(): Promise<void>;
  openSource(url: string): Promise<void>;
  getSettings(): Promise<unknown>;
  saveGroqKey(key: string): Promise<void>;
  saveGoogleCredentials(clientId: string, clientSecret: string): Promise<void>;
  googleStatus(): Promise<unknown>;
  disconnectGoogle(): Promise<unknown>;
  checkNow(): Promise<unknown>;
}

const bridge: DesktopApiBridge = {
  fetchInbox: () => ipcRenderer.invoke("inbox:get"),
  markDone: (interventionId) => ipcRenderer.invoke("intervention:done", interventionId),
  snooze: (interventionId, minutes) =>
    ipcRenderer.invoke("intervention:snooze", interventionId, minutes),
  setInteractive: (interactive) => ipcRenderer.send("overlay:set-interactive", interactive),
  connectGoogle: () => ipcRenderer.invoke("integrations:connect-google"),
  openSource: (url) => ipcRenderer.invoke("intervention:open-source", url),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveGroqKey: (key) => ipcRenderer.invoke("settings:save-groq-key", key),
  saveGoogleCredentials: (clientId, clientSecret) =>
    ipcRenderer.invoke("settings:save-google-credentials", clientId, clientSecret),
  googleStatus: () => ipcRenderer.invoke("integrations:google-status"),
  disconnectGoogle: () => ipcRenderer.invoke("integrations:disconnect-google"),
  checkNow: () => ipcRenderer.invoke("assistant:check-now"),
};

contextBridge.exposeInMainWorld("desktopAPI", bridge);
