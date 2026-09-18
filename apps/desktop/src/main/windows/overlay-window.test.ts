import { beforeEach, describe, expect, it, vi } from "vitest";

const loadFile = vi.fn();
const loadURL = vi.fn();

vi.mock("electron", () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadFile,
    loadURL,
    setPosition: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
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
});
