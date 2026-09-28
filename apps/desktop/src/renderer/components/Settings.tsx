import { useCallback, useEffect, useState } from "react";

interface SettingsStatus {
  groqKeyConfigured: boolean;
  googleOAuthConfigured: boolean;
  secureStorageAvailable: boolean;
  startupError: string | null;
  googleAuthError?: boolean;
}

interface GoogleStatus {
  connected: boolean;
  email: string | null;
}

function isSettingsStatus(value: unknown): value is SettingsStatus {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).groqKeyConfigured === "boolean"
  );
}

function isGoogleStatus(value: unknown): value is GoogleStatus {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).connected === "boolean"
  );
}

export interface SettingsProps {
  /**
   * Omit to render as the first-run "get started" screen (no way to
   * dismiss it — there's nothing to go back to yet, since setup isn't
   * done). Pass it when opened from the gear icon after setup is
   * complete, to render as a normal, closable Settings panel.
   */
  onClose?: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [googleClientIdInput, setGoogleClientIdInput] = useState("");
  const [googleClientSecretInput, setGoogleClientSecretInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!window.desktopAPI) return;
    const [settingsRaw, googleRaw] = await Promise.allSettled([
      window.desktopAPI.getSettings(),
      window.desktopAPI.googleStatus(),
    ]);
    if (settingsRaw.status === "fulfilled" && isSettingsStatus(settingsRaw.value)) {
      setStatus(settingsRaw.value);
    }
    if (googleRaw.status === "fulfilled" && isGoogleStatus(googleRaw.value)) {
      setGoogle(googleRaw.value);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveGroqKey = useCallback(async () => {
    if (!window.desktopAPI || groqKeyInput.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Saving restarts the whole app (see docs/SINGLE_PROCESS_DESKTOP.md) —
      // this call does not resolve normally in the success case.
      await window.desktopAPI.saveGroqKey(groqKeyInput.trim());
    } catch {
      setError("Could not save the Groq API key. Please try again.");
      setSaving(false);
    }
  }, [groqKeyInput]);

  const handleSaveGoogleCredentials = useCallback(async () => {
    if (
      !window.desktopAPI ||
      googleClientIdInput.trim().length === 0 ||
      googleClientSecretInput.trim().length === 0
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Also restarts the app — same reason as the Groq key.
      await window.desktopAPI.saveGoogleCredentials(
        googleClientIdInput.trim(),
        googleClientSecretInput.trim(),
      );
    } catch {
      setError("Could not save the Google OAuth credentials. Please try again.");
      setSaving(false);
    }
  }, [googleClientIdInput, googleClientSecretInput]);

  const handleConnectGoogle = useCallback(async () => {
    if (!window.desktopAPI) return;
    setError(null);
    try {
      await window.desktopAPI.connectGoogle();
    } catch {
      setError("Could not open the Google sign-in page.");
    }
  }, []);

  const handleDisconnectGoogle = useCallback(async () => {
    if (!window.desktopAPI) return;
    setError(null);
    try {
      await window.desktopAPI.disconnectGoogle();
      await load();
    } catch {
      setError("Could not disconnect Google. Please try again.");
    }
  }, [load]);

  return (
    <div className="card settings-card" data-testid="settings-card">
      <div className="card-title">{onClose ? "Settings" : "Get started"}</div>
      {!onClose && (
        <p className="card-message">
          Add a Groq API key and connect your Google account to start getting
          interventions.
        </p>
      )}

      {status?.startupError && (
        <div className="card-error" role="alert">
          Local server failed to start: {status.startupError}
        </div>
      )}
      {error && (
        <div className="card-error" role="alert">
          {error}
        </div>
      )}
      {status && !status.secureStorageAvailable && (
        <div className="card-error" role="alert">
          This device has no OS-level secure storage available — the Groq
          key is stored as plain text instead of encrypted.
        </div>
      )}
      {status?.googleAuthError && (
        <div className="card-error" role="alert">
          Your Google connection has expired or was revoked — reconnect
          below to keep syncing.
        </div>
      )}

      <div className="settings-section">
        <div className="settings-label">Groq API key</div>
        {status?.groqKeyConfigured ? (
          <div className="settings-status settings-status-ok">Configured</div>
        ) : (
          <div className="settings-status">Not configured</div>
        )}
        <input
          className="settings-input"
          type="password"
          placeholder="gsk_..."
          value={groqKeyInput}
          onChange={(e) => setGroqKeyInput(e.target.value)}
          disabled={saving}
        />
        <button
          type="button"
          className="button button-done"
          onClick={() => void handleSaveGroqKey()}
          disabled={saving || groqKeyInput.trim().length === 0}
        >
          {saving ? "Saving — restarting…" : "Save (restarts the app)"}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-label">Google OAuth credentials</div>
        {status?.googleOAuthConfigured ? (
          <div className="settings-status settings-status-ok">Configured</div>
        ) : (
          <div className="settings-status">
            Not configured — paste in your own Google Cloud OAuth client's
            Client ID and Secret.
          </div>
        )}
        <input
          className="settings-input"
          type="text"
          placeholder="Client ID"
          value={googleClientIdInput}
          onChange={(e) => setGoogleClientIdInput(e.target.value)}
          disabled={saving}
        />
        <input
          className="settings-input"
          type="password"
          placeholder="Client Secret"
          value={googleClientSecretInput}
          onChange={(e) => setGoogleClientSecretInput(e.target.value)}
          disabled={saving}
        />
        <button
          type="button"
          className="button button-done"
          onClick={() => void handleSaveGoogleCredentials()}
          disabled={
            saving ||
            googleClientIdInput.trim().length === 0 ||
            googleClientSecretInput.trim().length === 0
          }
        >
          {saving ? "Saving — restarting…" : "Save (restarts the app)"}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-label">Google account</div>
        {google?.connected && !status?.googleAuthError ? (
          <>
            <div className="settings-status settings-status-ok">
              Connected{google.email ? ` as ${google.email}` : ""}
            </div>
            <button
              type="button"
              className="button button-snooze"
              onClick={() => void handleDisconnectGoogle()}
            >
              Disconnect
            </button>
          </>
        ) : (
          <>
            <div className="settings-status">
              {status?.googleAuthError
                ? "Connection expired or was revoked — reconnect to keep syncing."
                : "Not connected"}
            </div>
            <button
              type="button"
              className="button button-done"
              onClick={() => void handleConnectGoogle()}
              disabled={!status?.googleOAuthConfigured}
              title={
                status?.googleOAuthConfigured
                  ? undefined
                  : "Add your Google OAuth credentials above first"
              }
            >
              {status?.googleAuthError ? "Reconnect Google" : "Sign in with Google"}
            </button>
          </>
        )}
      </div>

      {onClose && (
        <button type="button" className="button button-snooze settings-close" onClick={onClose}>
          Close
        </button>
      )}
    </div>
  );
}
