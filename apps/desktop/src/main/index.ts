import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  powerMonitor,
  safeStorage,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { loadConfig } from "./config.js";
import { ApiClientError, createApiClient, type ApiClient } from "./api-client.js";
import { resolveApiRoot } from "./api-location.js";
import { startEmbeddedApiServer, type EmbeddedApiServer } from "./api-server.js";
import { ensureEncryptionKey, loadUserConfig, saveUserConfig } from "./app-config.js";
import { formatClockTime } from "./format-time.js";
import { createHotkeyManager, defaultChatHotkey, type HotkeyManager } from "./hotkey.js";
import { macToolPath } from "./mac-path.js";
import { createFocusMonitor, type FocusMonitor } from "./focus-monitor.js";
import { createProactiveScheduler, type ProactiveScheduler } from "./proactive-scheduler.js";
import { runMigrations } from "./migrate.js";
import { createPauseState } from "./pause-state.js";
import { createSyncScheduler, type SyncScheduler } from "./sync-scheduler.js";
import { TRAY_ICON_DATA_URL } from "./tray-icon.js";
import { createOverlayWindow } from "./windows/overlay-window.js";
import { DEFAULT_OPENAI_MODEL, registerIpc } from "./ipc/register-ipc.js";

const PAUSE_DURATIONS_MS: Array<{ label: string; ms: number }> = [
  { label: "For 30 minutes", ms: 30 * 60_000 },
  { label: "For 1 hour", ms: 60 * 60_000 },
  { label: "For 4 hours", ms: 4 * 60 * 60_000 },
];

let mainWindow: BrowserWindow | null = null;
let embeddedApi: EmbeddedApiServer | null = null;
let syncScheduler: SyncScheduler | null = null;
let hotkeys: HotkeyManager | null = null;
let focusMonitor: FocusMonitor | null = null;
let proactive: ProactiveScheduler | null = null;
// Module-level, not local to whenReady(): Electron garbage-collects a Tray
// with no other references, silently removing the icon from the system
// tray — a bug that's invisible until someone actually looks for the icon,
// not something a startup smoke test would catch.
let tray: Tray | null = null;
const pauseState = createPauseState();
// Reactive state surfaced to the renderer via settings:get (see
// register-ipc.ts) — unlike groqKeyConfigured/googleOAuthConfigured, these
// can change mid-session, so they're read through getters, not captured
// once at startup.
let googleAuthError = false;
let lastCheckedAt: number | null = null;

const isMac = process.platform === "darwin";

app.whenReady().then(async () => {
  if (isMac) {
    // ADR-007: Finder-launched apps get a minimal PATH — add Homebrew/nvm so
    // `npx` connections work; and Zara is a menu-bar app, not a Dock app
    // (LSUIElement does this in the packaged app; this covers dev).
    process.env.PATH = macToolPath(process.env.PATH, app.getPath("home"));
    app.dock?.hide();
  }

  // Electron denies media (mic/camera) permission requests by default —
  // without this, getUserMedia() in the renderer (voice reminders) rejects
  // silently with no OS-level prompt at all, which looks identical to "the
  // user said no" from the renderer's side. This only grants Electron's
  // own permission gate; the OS's own mic privacy setting (Windows
  // Settings > Privacy > Microphone) is a separate, unavoidable gate this
  // can't do anything about — getUserMedia still rejects if that's off,
  // and the renderer needs to show a clear error for that case too.
  // On macOS the OS gate is a one-time prompt (needs NSMicrophoneUsageDescription
  // in Info.plist and the audio-input entitlement — ADR-007); ask for it here so
  // the first recording triggers it rather than failing silently.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission !== "media") return callback(false);
    if (!isMac) return callback(true);
    systemPreferences.askForMediaAccess("microphone").then(callback, () => callback(false));
  });

  const config = loadConfig();
  const userDataDir = app.getPath("userData");
  // ADR-006 M6: the local search model (~120 MB) is downloaded once, into app data.
  if (!process.env.RECALL_MODEL_DIR) process.env.RECALL_MODEL_DIR = join(userDataDir, "models");
  const userConfig = loadUserConfig(userDataDir, safeStorage);

  // A Groq key saved through the settings UI takes precedence over
  // whatever (if anything) is in .env — set before the embedded API's env
  // validation runs (see api-server.ts for why that's a dynamic import).
  if (userConfig.groqApiKey) {
    process.env.GROQ_API_KEY = userConfig.groqApiKey;
  }
  const groqKeyConfigured = Boolean(userConfig.groqApiKey ?? process.env.GROQ_API_KEY);

  // ADR-006: OpenAI is the primary provider (Groq the optional fallback).
  // Same precedence: values saved through Settings win over .env.
  if (userConfig.openaiApiKey) {
    process.env.OPENAI_API_KEY = userConfig.openaiApiKey;
  }
  if (userConfig.openaiModel) {
    process.env.OPENAI_MODEL = userConfig.openaiModel;
  }
  const openaiKeyConfigured = Boolean(userConfig.openaiApiKey ?? process.env.OPENAI_API_KEY);
  const openaiModel = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;

  // Phase 4.7: same precedence as the Groq key — a value saved through
  // Settings wins over whatever (if anything) is in .env. Deliberately
  // never baked into source/the packaged binary (see app-config.ts's
  // UserConfig.googleClientId comment for why) — the user pastes in their
  // own already-registered OAuth client's credentials through Settings.
  if (userConfig.googleClientId) {
    process.env.GOOGLE_CLIENT_ID = userConfig.googleClientId;
  }
  if (userConfig.googleClientSecret) {
    process.env.GOOGLE_CLIENT_SECRET = userConfig.googleClientSecret;
  }
  // The redirect URI itself isn't a secret and doesn't need Settings
  // input — it's derived from the embedded API's own fixed port (see
  // api-server.ts's DEFAULT_PORT comment for why that port is fixed, not
  // dynamic). Dev keeps whatever .env already provides.
  if (!process.env.GOOGLE_REDIRECT_URI) {
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:4000/api/v1/integrations/google/callback";
  }
  const googleOAuthConfigured = Boolean(
    (userConfig.googleClientId ?? process.env.GOOGLE_CLIENT_ID) &&
      (userConfig.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET),
  );

  // ENCRYPTION_KEY precedence is different and deliberate: never silently
  // replace an already-working key (that would make previously-encrypted
  // Google refresh tokens undecryptable). Order: (1) already in the
  // OS-keychain-backed store from a previous run — use it; (2) present in
  // .env (a developer's own value) — use it, and persist it into the
  // store so the app is self-sufficient even without .env later; (3)
  // neither — generate a fresh random one and persist it, removing the
  // manual `openssl rand -base64 32` step entirely.
  if (userConfig.encryptionKey) {
    process.env.ENCRYPTION_KEY = userConfig.encryptionKey;
  } else if (process.env.ENCRYPTION_KEY) {
    saveUserConfig(userDataDir, safeStorage, { encryptionKey: process.env.ENCRYPTION_KEY });
  } else {
    const { encryptionKey } = ensureEncryptionKey(userDataDir, safeStorage);
    process.env.ENCRYPTION_KEY = encryptionKey;
  }

  let apiUrl: string;
  let startupError: string | null = null;
  if (config.apiUrl) {
    // Escape hatch: DESKTOP_API_URL points at an already-running external
    // API instance — nothing to start or own the lifecycle of here.
    apiUrl = config.apiUrl;
  } else {
    try {
      // Phase 4.6: same api package root for both steps below — dev's
      // monorepo-sibling apps/api, or (when packaged) the standalone copy
      // electron-builder placed at resources/api. See api-location.ts.
      const apiRoot = resolveApiRoot({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });

      // Phase 4.7: DATABASE_URL was never actually set anywhere in this
      // process for a packaged build — only migrate.ts's own child-process
      // spawn got an explicit value. That went unnoticed until now because
      // nothing the embedded (in-process) API did at startup touched
      // Prisma; the first thing that does throws
      // "environment variable not found: DATABASE_URL" immediately. Dev
      // keeps using whatever .env already provides (a relative path,
      // resolved against apps/api/prisma/ — the existing, real dev
      // database with real synced Gmail/Calendar data; never touch that
      // resolution). Packaged gets an absolute path into this OS user's
      // own app-data directory — not inside the install directory, which
      // has its own permission/update/uninstall problems for a database
      // that needs to persist and grow.
      if (app.isPackaged && !process.env.DATABASE_URL) {
        const dbPath = join(userDataDir, "dev.db").replace(/\\/g, "/");
        process.env.DATABASE_URL = `file:${dbPath}`;
      }

      // Phase 4.5: apply any pending Prisma migrations before the API
      // starts, so a fresh clone/install no longer needs a manual
      // `pnpm db:migrate` step. Safe to run every launch (see migrate.ts).
      await runMigrations({ apiRoot });
      embeddedApi = await startEmbeddedApiServer({ apiRoot });
      apiUrl = embeddedApi.url;
    } catch (err) {
      // Don't crash the whole app with a native dialog — show a proper
      // in-app startup error screen instead (Phase 4.3).
      startupError = err instanceof Error ? err.message : String(err);
      apiUrl = "http://127.0.0.1:0";
    }
  }

  const api = createApiClient(apiUrl);

  // Wraps the real checkNow() with the bookkeeping every caller (the
  // scheduled tick, the renderer's Check now button, and the tray's Check
  // now item) needs: when it last ran, and whether the last attempt failed
  // specifically because Google's authorization is gone (401/403 — see
  // google-api-error.ts's mapGoogleApiError), as opposed to some other
  // transient failure. All three callers route through this one function
  // (see instrumentedApi below) so none of them have to duplicate the
  // logic, and "last checked" / "needs reconnecting" stay consistent
  // regardless of which of the three triggered the check.
  async function performCheckNow(): Promise<unknown> {
    lastCheckedAt = Date.now();
    try {
      const result = await api.checkNow();
      googleAuthError = false;
      return result;
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        googleAuthError = true;
      }
      throw err;
    }
  }
  const instrumentedApi: ApiClient = { ...api, checkNow: performCheckNow };

  mainWindow = createOverlayWindow({
    isDev: !app.isPackaged,
    devServerUrl: "http://localhost:5173",
  });

  // ADR-006 M4: the global shortcut brings Zara up from anywhere. The
  // renderer decides what a press means (open chat, or start/stop talking
  // when it's already open).
  hotkeys = createHotkeyManager({
    globalShortcut,
    initial: userConfig.chatHotkey ?? defaultChatHotkey(),
    onPress: () => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) return;
      if (!win.isVisible()) win.show();
      win.focus();
      win.webContents.send("zara:hotkey");
    },
    logger: { warn: (message) => console.warn(`[hotkey] ${message}`) },
  });

  registerIpc({
    ipcMain,
    getWindow: () => mainWindow,
    api: instrumentedApi,
    apiUrl,
    shell,
    groqKeyConfigured,
    openaiKeyConfigured,
    openaiModel,
    googleOAuthConfigured,
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    startupError,
    getGoogleAuthError: () => googleAuthError,
    getLastCheckedAt: () => lastCheckedAt,
    saveGroqKeyAndRestart: (key) => {
      saveUserConfig(userDataDir, safeStorage, { groqApiKey: key });
      app.relaunch();
      app.exit(0);
    },
    saveOpenAiKeyAndRestart: (key) => {
      saveUserConfig(userDataDir, safeStorage, { openaiApiKey: key });
      app.relaunch();
      app.exit(0);
    },
    saveOpenAiModelAndRestart: (model) => {
      saveUserConfig(userDataDir, safeStorage, { openaiModel: model });
      app.relaunch();
      app.exit(0);
    },
    getHoldState: () => proactive?.hold() ?? { holding: false, reason: null },
    chooseFolders: async () => {
      const options = {
        title: "Choose the folders Zara may read",
        properties: ["openDirectory" as const, "multiSelections" as const],
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    },
    chooseFolder: async () => {
      const options = { title: "Choose the folder Zara should read", properties: ["openDirectory" as const, "createDirectory" as const] };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    onProactiveSettingsChanged: () => proactive?.userReturned(),
    getChatHotkey: () => hotkeys?.current() ?? null,
    changeChatHotkey: (accelerator) => {
      if (!hotkeys) return { ok: false, message: "Shortcuts aren't available." };
      const result = hotkeys.change(accelerator);
      if (result.ok) saveUserConfig(userDataDir, safeStorage, { chatHotkey: result.accelerator });
      return result;
    },
    saveGoogleCredentialsAndRestart: (clientId, clientSecret) => {
      saveUserConfig(userDataDir, safeStorage, {
        googleClientId: clientId,
        googleClientSecret: clientSecret,
      });
      app.relaunch();
      app.exit(0);
    },
  });

  // The overlay window is deliberately not a normal taskbar app (see
  // overlay-window.ts's skipTaskbar — a frameless, transparent,
  // always-on-top window would look broken as a taskbar entry/preview).
  // A system tray icon is the actual "the app is running, and here's how
  // to close it" affordance instead — there's otherwise no way to quit the
  // app at all short of Task Manager, including when startupError is set.
  function buildTrayMenu(): Menu {
    const paused = pauseState.isPaused();
    const items: MenuItemConstructorOptions[] = [
      {
        label: "Check now",
        enabled: !startupError,
        click: () => {
          instrumentedApi.checkNow().catch(() => {
            // Same as the renderer's own Check now button — a failed manual
            // check just means nothing new was found this time; the next
            // scheduled or manual check will retry.
          });
        },
      },
      { type: "separator" },
    ];
    if (paused) {
      const until = pauseState.pausedUntil();
      items.push({
        label: until ? `Paused until ${formatClockTime(until)}` : "Paused",
        enabled: false,
      });
      items.push({
        label: "Resume notifications",
        click: () => {
          pauseState.resume();
          refreshTray();
        },
      });
    } else {
      items.push({
        label: "Pause notifications",
        submenu: PAUSE_DURATIONS_MS.map(({ label, ms }) => ({
          label,
          click: () => {
            pauseState.pause(ms);
            refreshTray();
          },
        })),
      });
    }
    items.push({ type: "separator" }, { label: "Quit", click: () => app.quit() });
    return Menu.buildFromTemplate(items);
  }

  function refreshTray(): void {
    if (!tray) return;
    tray.setContextMenu(buildTrayMenu());
    tray.setToolTip(
      pauseState.isPaused() ? "AI Executive Agent — notifications paused" : "AI Executive Agent",
    );
  }

  const trayImage = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  // ADR-007: a menu-bar icon on macOS — menu-bar sized, and a template image
  // so macOS draws it black or white to match the menu bar.
  const menuBarImage = isMac ? trayImage.resize({ width: 16, height: 16 }) : trayImage;
  if (isMac) menuBarImage.setTemplateImage(true);
  tray = new Tray(menuBarImage);
  refreshTray();
  // Windows convention: left-click on a tray icon opens its menu too, not
  // just right-click. (macOS already opens the menu on click.)
  if (!isMac) tray.on("click", () => tray?.popUpContextMenu());

  // Continuous sync (replaces having to click "Check now" yourself): only
  // meaningful once the embedded API actually started. Runs regardless of
  // whether Google is connected yet — it checks status each tick and skips
  // the sync itself until it is (see sync-scheduler.ts) — so it starts
  // working automatically the moment onboarding finishes, no restart
  // needed. The renderer's own inbox poll (use-intervention-polling.ts)
  // picks up anything this creates; no IPC/renderer wiring needed here.
  // Also skips entirely while paused (see pause-state.ts) — a manual Check
  // now (button or tray) still works during a pause; only the automatic
  // background checks are silenced. The scheduler additionally runs a
  // 1-minute local-only delivery tick (checkDue — ADR-005) so reminders and
  // meeting alerts land on time, Google connected or not.
  if (!startupError) {
    syncScheduler = createSyncScheduler({
      api: instrumentedApi,
      intervalMs: config.syncIntervalMinutes * 60_000,
      isPaused: () => pauseState.isPaused(),
      // Push-style refresh: a reminder or email picked up in the background
      // shows immediately, instead of after the renderer's next 15s poll.
      onTickComplete: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("inbox:changed");
        }
      },
      logger: {
        error: (message, err) => console.error(`[sync-scheduler] ${message}`, err),
      },
    });
    syncScheduler.start();

    // ADR-006 M5: hold pop-ups while the user is presenting, full-screen,
    // or on a call (or in quiet hours), and deliver the morning briefing /
    // wrap-up when they're at the PC.
    const sendToWindow = (channel: string, payload: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    };
    focusMonitor = createFocusMonitor({
      ownExecutablePath: process.execPath,
      onChange: () => proactive?.hold(),
      logger: { warn: (message) => console.warn(`[focus] ${message}`) },
    });
    proactive = createProactiveScheduler({
      api: instrumentedApi,
      focus: () => focusMonitor?.current() ?? { busy: false, reason: null },
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      isPaused: () => pauseState.isPaused(),
      onHoldChange: (state) => sendToWindow("proactive:hold", state),
      onBriefing: (briefing) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
        sendToWindow("zara:briefing", briefing);
      },
      logger: { error: (message, err) => console.error(`[proactive] ${message}`, err) },
    });
    proactive.start();
    powerMonitor.on("unlock-screen", () => proactive?.userReturned());
    powerMonitor.on("resume", () => proactive?.userReturned());
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("before-quit", (event) => {
  syncScheduler?.stop();
  proactive?.stop();
  focusMonitor?.stop();
  tray?.destroy();
  tray = null;
  if (!embeddedApi) return;
  const server = embeddedApi;
  embeddedApi = null;
  event.preventDefault();
  server
    .close()
    .catch(() => {})
    .finally(() => app.quit());
});
