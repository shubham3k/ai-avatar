import { useCallback, useEffect, useState } from "react";

export interface SetupStatus {
  groqKeyConfigured: boolean;
  googleConnected: boolean;
}

const POLL_INTERVAL_MS = 15_000;

function isSettingsResponse(value: unknown): value is { groqKeyConfigured: boolean } {
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
 * Polls whether the two setup steps (Groq key, Google connection) are
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
    const groqKeyConfigured =
      settingsResult.status === "fulfilled" && isSettingsResponse(settingsResult.value)
        ? settingsResult.value.groqKeyConfigured
        : false;
    const googleConnected =
      googleResult.status === "fulfilled" && isGoogleStatusResponse(googleResult.value)
        ? googleResult.value.connected
        : false;
    setStatus({ groqKeyConfigured, googleConnected });
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
