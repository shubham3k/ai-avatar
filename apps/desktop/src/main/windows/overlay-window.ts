import { fileURLToPath } from "node:url";
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 540;
const MARGIN = 24;

export function createOverlayWindow(options: {
  isDev: boolean;
  devServerUrl: string;
}): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "..", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const { workArea } = screen.getPrimaryDisplay();
  win.setPosition(
    workArea.x + workArea.width - WINDOW_WIDTH - MARGIN,
    workArea.y + workArea.height - WINDOW_HEIGHT - MARGIN,
  );

  // The overlay starts idle; the renderer enables mouse events when an
  // intervention card becomes visible.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.once("ready-to-show", () => win.show());

  if (options.isDev) {
    void win.loadURL(options.devServerUrl);
  } else {
    // This file compiles to dist/main/windows/overlay-window.js; the
    // renderer's vite build output is a sibling of dist/main (dist/renderer/),
    // not nested inside it — two levels up, not one. Getting this wrong
    // means loadFile() silently fails to find the page: the window is
    // created but never shows (`ready-to-show` never fires, and it starts
    // with `show: false`), so it's a real, running Electron process with
    // truly no visible window at all — not just a transparent/empty one.
    void win.loadFile(join(__dirname, "..", "..", "renderer", "index.html"));
  }

  return win;
}
