import { beforeEach, describe, expect, it, vi } from "vitest";

const loadFile = vi.fn();
const loadURL = vi.fn();
const setVisibleOnAllWorkspaces = vi.fn();
const setAlwaysOnTop = vi.fn();

vi.mock("electron", () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadFile,
    loadURL,
    setPosition: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setVisibleOnAllWorkspaces,
    setAlwaysOnTop,
    once: vi.fn(),
    show: vi.fn(),
  })),
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));

describe("createOverlayWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("in production, loads the renderer's index.html from dist/renderer/ — a sibling of dist/main/, not nested inside it", async () => {
    // Regression test: an earlier version resolved this one directory level
    // short (dist/main/renderer/index.html, which doesn't exist), so
    // loadFile() silently failed, "ready-to-show" never fired, and the
    // window — created with `show: false` — never appeared at all. A real
    // Electron process running with zero visible window, only caught by a
    // human actually launching the packaged app (dev mode never exercises
    // this path — it loads the Vite dev server URL instead).
    const { createOverlayWindow } = await import("./overlay-window.js");
    createOverlayWindow({ isDev: false, devServerUrl: "http://localhost:5173" });

    expect(loadFile).toHaveBeenCalledTimes(1);
    const [path] = loadFile.mock.calls[0] as [string];
    const normalized = path.replace(/\\/g, "/");
    expect(normalized).toMatch(/\/renderer\/index\.html$/);
    expect(normalized).not.toMatch(/\/main\/renderer\//);
  });

  it("in dev, loads the Vite dev server URL instead of a file path", async () => {
    const { createOverlayWindow } = await import("./overlay-window.js");
    createOverlayWindow({ isDev: true, devServerUrl: "http://localhost:5173" });

    expect(loadURL).toHaveBeenCalledWith("http://localhost:5173");
    expect(loadFile).not.toHaveBeenCalled();
  });

  it("on macOS, stays visible on every Space and over full-screen apps (ADR-007); Windows is unchanged", async () => {
    const { createOverlayWindow } = await import("./overlay-window.js");
    createOverlayWindow({ isDev: true, devServerUrl: "http://localhost:5173", platform: "win32" });
    expect(setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    expect(setAlwaysOnTop).not.toHaveBeenCalled();

    createOverlayWindow({ isDev: true, devServerUrl: "http://localhost:5173", platform: "darwin" });
    expect(setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
  });
});

describe("resizeOverlayToContent", () => {
  function fakeWindow(overrides: Partial<{ isDestroyed: () => boolean }> = {}) {
    return {
      isDestroyed: () => false,
      setBounds: vi.fn(),
      ...overrides,
    };
  }

  it("resizes and repositions the window so its bottom-right corner stays anchored", async () => {
    const { resizeOverlayToContent } = await import("./overlay-window.js");
    const win = fakeWindow();

    resizeOverlayToContent(win as never, 300);

    expect(win.setBounds).toHaveBeenCalledWith({
      x: 1920 - 380 - 24,
      y: 1080 - 300 - 24,
      width: 380,
      height: 300,
    });
  });

  it("clamps below a minimum content height", async () => {
    const { resizeOverlayToContent } = await import("./overlay-window.js");
    const win = fakeWindow();

    resizeOverlayToContent(win as never, 10);

    expect(win.setBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 48 }));
  });

  it("clamps above a maximum fraction of the work area height", async () => {
    const { resizeOverlayToContent } = await import("./overlay-window.js");
    const win = fakeWindow();

    resizeOverlayToContent(win as never, 5000);

    expect(win.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ height: Math.floor(1080 * 0.92) }),
    );
  });

  it("does nothing once the window has been destroyed", async () => {
    const { resizeOverlayToContent } = await import("./overlay-window.js");
    const win = fakeWindow({ isDestroyed: () => true });

    resizeOverlayToContent(win as never, 300);

    expect(win.setBounds).not.toHaveBeenCalled();
  });
});
