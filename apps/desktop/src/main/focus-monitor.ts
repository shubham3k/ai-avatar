import { spawn, type ChildProcess } from "node:child_process";

/**
 * ADR-006 M5: is the user busy — full-screen app, presentation, or a video
 * call? Windows already knows the first two (SHQueryUserNotificationState,
 * the same signal it uses to silence its own notifications); "another app
 * is using the microphone or camera" stands in for a call. A small
 * PowerShell helper (no native modules) prints one JSON line every few
 * seconds; this module parses it.
 */
export type FocusReason = "fullscreen" | "presentation" | "call";

export interface FocusState {
  busy: boolean;
  reason: FocusReason | null;
}

export const NOT_BUSY: FocusState = { busy: false, reason: null };

/** QUERY_USER_NOTIFICATION_STATE values (shellapi.h). */
const QUNS_BUSY = 2;
const QUNS_RUNNING_D3D_FULL_SCREEN = 3;
const QUNS_PRESENTATION_MODE = 4;

export interface FocusSample {
  /** SHQueryUserNotificationState result. */
  state: number;
  /** Registry key names of apps currently using the mic or camera. */
  inUse: string[];
}

/** Registry key name for an executable path (ConsentStore\...\NonPackaged uses the path with \ → #). */
export function consentKeyForPath(path: string): string {
  return path.replace(/\\/g, "#").toLowerCase();
}

export function interpretFocusSample(sample: unknown, ownKeys: string[]): FocusState {
  if (!sample || typeof sample !== "object") return NOT_BUSY;
  const { state, inUse } = sample as Partial<FocusSample>;
  const own = new Set(ownKeys.map((key) => key.toLowerCase()));
  const others = (Array.isArray(inUse) ? inUse : []).filter(
    (key): key is string => typeof key === "string" && !own.has(key.toLowerCase()),
  );
  if (state === QUNS_PRESENTATION_MODE) return { busy: true, reason: "presentation" };
  if (state === QUNS_BUSY || state === QUNS_RUNNING_D3D_FULL_SCREEN) return { busy: true, reason: "fullscreen" };
  if (others.length > 0) return { busy: true, reason: "call" };
  return NOT_BUSY;
}

export const FOCUS_POLL_SECONDS = 5;

/** The helper script — read-only: one Windows API call and a registry read per loop. */
export const FOCUS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace ZaraFocus -Name Native -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'
while ($true) {
  $state = 0
  [void][ZaraFocus.Native]::SHQueryUserNotificationState([ref]$state)
  $inUse = @()
  foreach ($cap in @('microphone', 'webcam')) {
    $base = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\$cap"
    Get-ChildItem -Path $base -Recurse | ForEach-Object {
      $p = Get-ItemProperty -Path $_.PSPath
      if ($p.LastUsedTimeStart -and $p.LastUsedTimeStop -eq 0) { $inUse += $_.PSChildName }
    }
  }
  [Console]::Out.WriteLine((@{ state = $state; inUse = @($inUse) } | ConvertTo-Json -Compress))
  Start-Sleep -Seconds ${FOCUS_POLL_SECONDS}
}
`;

export interface FocusMonitor {
  current(): FocusState;
  stop(): void;
}

/**
 * Runs the helper (Windows only; elsewhere it always reports "not busy")
 * and restarts it if it exits. A stale sample (helper hung) counts as not
 * busy, so pop-ups are never held forever by a broken helper.
 */
export function createFocusMonitor(options: {
  ownExecutablePath: string;
  onChange?: (state: FocusState) => void;
  platform?: NodeJS.Platform;
  spawnFn?: typeof spawn;
  logger?: { warn(message: string): void };
}): FocusMonitor {
  const platform = options.platform ?? process.platform;
  const spawnFn = options.spawnFn ?? spawn;
  const ownKeys = [consentKeyForPath(options.ownExecutablePath)];
  let state: FocusState = NOT_BUSY;
  let lastSampleAt = 0;
  let child: ChildProcess | null = null;
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function update(next: FocusState): void {
    if (next.busy === state.busy && next.reason === state.reason) return;
    state = next;
    options.onChange?.(state);
  }

  function start(): void {
    if (stopped || platform !== "win32") return;
    const encoded = Buffer.from(FOCUS_SCRIPT, "utf16le").toString("base64");
    child = spawnFn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          lastSampleAt = Date.now();
          update(interpretFocusSample(JSON.parse(line), ownKeys));
        } catch {
          // A malformed line is ignored; the next one arrives in a few seconds.
        }
      }
    });
    child.on("exit", () => {
      child = null;
      update(NOT_BUSY);
      if (stopped) return;
      options.logger?.warn("Focus helper exited — restarting in 30 s.");
      restartTimer = setTimeout(start, 30_000);
    });
    child.on("error", () => undefined);
  }

  start();

  return {
    current() {
      if (state.busy && Date.now() - lastSampleAt > FOCUS_POLL_SECONDS * 4 * 1000) return NOT_BUSY;
      return state;
    },
    stop() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      child?.kill();
      child = null;
    },
  };
}
