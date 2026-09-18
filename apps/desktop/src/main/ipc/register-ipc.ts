import type { BrowserWindow, IpcMain } from "electron";
import type { ApiClient } from "../api-client.js";

export interface ShellLike {
  openExternal(url: string): Promise<void>;
}

export function registerIpc(options: {
  ipcMain: IpcMain;
  getWindow: () => BrowserWindow | null;
  api: ApiClient;
  apiUrl: string;
  shell: ShellLike;
  /** Whether a Groq key is currently configured (via .env or the settings UI) — fixed for this process's lifetime. */
  groqKeyConfigured: boolean;
  /** Whether Google OAuth client credentials are currently configured (via .env or the settings UI) — fixed for this process's lifetime. See Phase 4.7. */
  googleOAuthConfigured: boolean;
  /** Whether secrets are actually OS-keychain-encrypted (false = platform/environment has no keychain; stored as plain base64 instead — Settings should warn). */
  secureStorageAvailable: boolean;
  /** Set if the embedded API failed to start — shown by the renderer instead of a silent blank overlay. */
  startupError: string | null;
  /** Persists the key and restarts the whole app so the embedded API picks it up (see docs/SINGLE_PROCESS_DESKTOP.md). */
  saveGroqKeyAndRestart: (key: string) => void;
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
    googleOAuthConfigured,
    secureStorageAvailable,
    startupError,
    saveGroqKeyAndRestart,
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
    googleOAuthConfigured,
    secureStorageAvailable,
    startupError,
  }));

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

  ipcMain.on("overlay:set-interactive", (_event, interactive: unknown) => {
    const win = getWindow();
    if (!win) return;
    if (interactive === true) {
      win.setIgnoreMouseEvents(false);
    } else {
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  });
}
