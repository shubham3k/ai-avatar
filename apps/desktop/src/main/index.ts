import { app, BrowserWindow, ipcMain } from "electron";
import { loadConfig } from "./config.js";
import { createApiClient } from "./api-client.js";
import { createOverlayWindow } from "./windows/overlay-window.js";
import { registerIpc } from "./ipc/register-ipc.js";

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  const config = loadConfig();
  const api = createApiClient(config.apiUrl);

  mainWindow = createOverlayWindow({
    isDev: !app.isPackaged,
    devServerUrl: "http://localhost:5173",
  });

  registerIpc({
    ipcMain,
    getWindow: () => mainWindow,
    api,
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
