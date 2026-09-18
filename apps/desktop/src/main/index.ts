import { join } from "node:path";
import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { loadConfig } from "./config.js";
import { createApiClient } from "./api-client.js";
import { resolveApiRoot } from "./api-location.js";
import { startEmbeddedApiServer, type EmbeddedApiServer } from "./api-server.js";
import { ensureEncryptionKey, loadUserConfig, saveUserConfig } from "./app-config.js";
import { runMigrations } from "./migrate.js";
import { createOverlayWindow } from "./windows/overlay-window.js";
import { registerIpc } from "./ipc/register-ipc.js";

let mainWindow: BrowserWindow | null = null;
let embeddedApi: EmbeddedApiServer | null = null;

app.whenReady().then(async () => {
  const config = loadConfig();
  const userDataDir = app.getPath("userData");
  const userConfig = loadUserConfig(userDataDir, safeStorage);

  // A Groq key saved through the settings UI takes precedence over
  // whatever (if anything) is in .env — set before the embedded API's env
  // validation runs (see api-server.ts for why that's a dynamic import).
  if (userConfig.groqApiKey) {
    process.env.GROQ_API_KEY = userConfig.groqApiKey;
  }
  const groqKeyConfigured = Boolean(userConfig.groqApiKey ?? process.env.GROQ_API_KEY);

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

  mainWindow = createOverlayWindow({
    isDev: !app.isPackaged,
    devServerUrl: "http://localhost:5173",
  });

  registerIpc({
    ipcMain,
    getWindow: () => mainWindow,
    api,
    apiUrl,
    shell,
    groqKeyConfigured,
    googleOAuthConfigured,
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    startupError,
    saveGroqKeyAndRestart: (key) => {
      saveUserConfig(userDataDir, safeStorage, { groqApiKey: key });
      app.relaunch();
      app.exit(0);
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
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (!embeddedApi) return;
  const server = embeddedApi;
  embeddedApi = null;
  event.preventDefault();
  server
    .close()
    .catch(() => {})
    .finally(() => app.quit());
});
