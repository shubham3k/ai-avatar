import { useCallback, useEffect, useState } from "react";

export interface SetupStatus {
  /** ADR-006: an AI key is set — OpenAI (primary) or, for installs from before it, Groq alone. */
  aiKeyConfigured: boolean;
  googleConnected: boolean;
  /** True once a sync call has come back 401/403 — Google's authorization was revoked or expired and needs reconnecting. Distinct from googleConnected: the stored connection row still exists, it just no longer works. */
  googleAuthError: boolean;
  /** Epoch ms of the last check attempt (scheduled or manual) this session, or null if none yet. */
  lastCheckedAt: number | null;
}

const POLL_INTERVAL_MS = 15_000;

interface SettingsResponse {
  groqKeyConfigured: boolean;
  openaiKeyConfigured?: boolean;
  googleAuthError?: boolean;
  lastCheckedAt?: number | null;
}

function isSettingsResponse(value: unknown): value is SettingsResponse {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).groqKeyConfigured === "boolean"
  );
}

function isGoogleStatusResponse(value: unknown): value is { connected: boolean } {
  return (
    !!value && typeof value === "object" && typeof (value as Record<string, unknown>).connected === "boolean"
  );
}

/**
 * Polls whether the two setup steps (an AI key, Google connection) are
 * done, on the same interval as intervention polling. Connecting Google
 * happens in the system browser, outside this window, so there's no push
 * signal when it finishes — polling is what lets the UI flip itself from
 * the "get started" screen to the normal view within POLL_INTERVAL_MS of
 * the user finishing the OAuth flow, without them having to do anything
 * themselves to refresh it.
 */
export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!window.desktopAPI) return;
    const [settingsResult, googleResult] = await Promise.allSettled([
      window.desktopAPI.getSettings(),
      window.desktopAPI.googleStatus(),
    ]);
    const settings =
      settingsResult.status === "fulfilled" && isSettingsResponse(settingsResult.value)
        ? settingsResult.value
        : null;
    const aiKeyConfigured = Boolean(settings?.openaiKeyConfigured || settings?.groqKeyConfigured);
    const googleAuthError = settings?.googleAuthError ?? false;
    const lastCheckedAt = settings?.lastCheckedAt ?? null;
    const googleConnected =
      googleResult.status === "fulfilled" && isGoogleStatusResponse(googleResult.value)
        ? googleResult.value.connected
        : false;
    setStatus({ aiKeyConfigured, googleConnected, googleAuthError, lastCheckedAt });
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { status, refresh };
}
