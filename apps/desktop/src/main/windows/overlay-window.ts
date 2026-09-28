import { fileURLToPath } from "node:url";
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WINDOW_WIDTH = 380;
// Only the first paint, before the renderer's first real content-size
// report arrives (see resizeOverlayToContent below) — small enough that
// the brief flash-then-shrink is barely noticeable, rather than the old
// fixed 540px that made the window cover most of the screen's height
// (and, since the window is always mouse-interactive — see App.tsx's
// setInteractive comment — block clicks to the desktop through that
// entire, mostly-empty rectangle) regardless of what was actually showing.
const INITIAL_WINDOW_HEIGHT = 220;
// Low enough for the idle state, which is just the dock pill (~54px).
const MIN_CONTENT_HEIGHT = 48;
// Settings/onboarding is the tallest screen; never let content-driven
// resizing exceed most of the work area even there. The Settings card
// itself is capped and internally scrollable (see styles.css's
// .settings-card) specifically so it never actually needs to hit this —
// this is a backstop, not the real fix for "content taller than the
// screen" (a real bug found in testing: content was silently clipped by
// the window's own edge, not just visually cut off but genuinely
// unreachable/unclickable below the fold).
const MAX_HEIGHT_RATIO = 0.92;
const MARGIN = 24;

export function createOverlayWindow(options: {
  isDev: boolean;
  devServerUrl: string;
}): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: INITIAL_WINDOW_HEIGHT,
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
    workArea.y + workArea.height - INITIAL_WINDOW_HEIGHT - MARGIN,
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

/**
 * The window is always mouse-interactive (see App.tsx's setInteractive
 * comment), so its whole rectangle blocks clicks to whatever's behind it —
 * not just the area actually painted with content. Resizes it to match
 * what the renderer just reported it actually rendered (see
 * use-report-content-size.ts / register-ipc.ts's "overlay:content-size"
 * handler), instead of always occupying its original fixed size regardless
 * of which screen (a short intervention card vs. the taller Settings
 * panel) is showing. Width is left alone — every screen's layout is
 * already designed around the fixed WINDOW_WIDTH; only height varies
 * enough across screens to be worth resizing for.
 */
export function resizeOverlayToContent(win: BrowserWindow, contentHeight: number): void {
  if (win.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  const maxHeight = Math.floor(workArea.height * MAX_HEIGHT_RATIO);
  const targetHeight = Math.min(maxHeight, Math.max(MIN_CONTENT_HEIGHT, Math.ceil(contentHeight)));
  const bottom = workArea.y + workArea.height - MARGIN;
  const right = workArea.x + workArea.width - MARGIN;
  win.setBounds({
    x: right - WINDOW_WIDTH,
    y: bottom - targetHeight,
    width: WINDOW_WIDTH,
    height: targetHeight,
  });
}
