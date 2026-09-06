import type { BrowserWindow, IpcMain } from "electron";
import type { ApiClient } from "../api-client.js";

export function registerIpc(options: {
  ipcMain: IpcMain;
  getWindow: () => BrowserWindow | null;
  api: ApiClient;
}): void {
  const { ipcMain, getWindow, api } = options;

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
