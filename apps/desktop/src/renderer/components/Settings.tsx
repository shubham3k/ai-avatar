import { useCallback, useEffect, useState } from "react";
import { ActivitySettings } from "./ActivitySettings";
import { MemorySettings } from "./MemorySettings";
import { ProactiveSettings } from "./ProactiveSettings";
import { RecallSettings } from "./RecallSettings";
import { ActionSettings } from "./ActionSettings";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { RoutinesSettings } from "./RoutinesSettings";
import { VoiceSettings } from "./VoiceSettings";
import {
  getChatAutoHideSeconds,
  MAX_CHAT_AUTO_HIDE_SECONDS,
  setChatAutoHideSeconds,
} from "../lib/preferences";

interface ModelChoice {
  id: string;
  label: string;
}

interface SettingsStatus {
  groqKeyConfigured: boolean;
  /** ADR-006: OpenAI is the primary provider. */
  openaiKeyConfigured?: boolean;
  openaiModel?: string;
  openaiModelChoices?: ModelChoice[];
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

interface ProviderUsage {
  calls: number;
  costUsd: number | null;
}

interface UsageSummary {
  calls: number;
  estimatedCostUsd: number;
  openai: ProviderUsage;
  groq: ProviderUsage;
}

function isUsageSummary(value: unknown): value is UsageSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.calls === "number" && typeof record.estimatedCostUsd === "number";
}

/** "This month: about $0.42 · 120 AI calls (3 by the Groq backup)". */
export function describeUsage(usage: UsageSummary): string {
  if (usage.calls === 0) return "This month: no AI usage yet.";
  const cost =
    usage.estimatedCostUsd === 0
      ? "no cost"
      : usage.estimatedCostUsd < 0.01
        ? "under $0.01"
        : `about $${usage.estimatedCostUsd.toFixed(2)}`;
  const calls = `${usage.calls} AI call${usage.calls === 1 ? "" : "s"}`;
  const backup = usage.groq.calls > 0 ? ` (${usage.groq.calls} by the Groq backup)` : "";
  return `This month: ${cost} · ${calls}${backup}.`;
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
  /** M5: "Show now" in the Proactive tab hands the briefing to the app to display/speak. */
  onShowBriefing?: (briefing: unknown) => void;
}

export function Settings({ onClose, onShowBriefing }: SettingsProps) {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [autoHideSeconds, setAutoHideSeconds] = useState(getChatAutoHideSeconds);
  const [tab, setTab] = useState<"general" | "voice" | "proactive" | "recall" | "actions" | "connections" | "routines" | "memory" | "activity">("general");
  const [googleClientIdInput, setGoogleClientIdInput] = useState("");
  const [googleClientSecretInput, setGoogleClientSecretInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!window.desktopAPI) return;
    const [settingsRaw, googleRaw, usageRaw] = await Promise.allSettled([
      window.desktopAPI.getSettings(),
      window.desktopAPI.googleStatus(),
      window.desktopAPI.getUsageSummary?.() ?? Promise.resolve(null),
    ]);
    if (settingsRaw.status === "fulfilled" && isSettingsStatus(settingsRaw.value)) {
      setStatus(settingsRaw.value);
      setSelectedModel((current) => current ?? (settingsRaw.value as SettingsStatus).openaiModel ?? null);
    }
    if (usageRaw.status === "fulfilled" && isUsageSummary(usageRaw.value)) {
      setUsage(usageRaw.value);
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

  const handleSaveOpenAiKey = useCallback(async () => {
    if (!window.desktopAPI?.saveOpenAiKey || openaiKeyInput.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Restarts the app, like every key change — does not resolve normally on success.
      await window.desktopAPI.saveOpenAiKey(openaiKeyInput.trim());
    } catch {
      setError("Could not save the OpenAI API key. Please try again.");
      setSaving(false);
    }
  }, [openaiKeyInput]);

  const handleSaveModel = useCallback(async () => {
    if (!window.desktopAPI?.saveOpenAiModel || !selectedModel) return;
    setSaving(true);
    setError(null);
    try {
      await window.desktopAPI.saveOpenAiModel(selectedModel);
    } catch {
      setError("Could not change the AI model. Please try again.");
      setSaving(false);
    }
  }, [selectedModel]);

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
          Add your OpenAI API key and connect your Google account to start
          getting interventions.
        </p>
      )}
      {onClose && (
        <div className="settings-tabs" role="tablist">
          {(
            [
              ["general", "General"],
              ["voice", "Voice"],
              ["proactive", "Proactive"],
              ["recall", "Recall"],
              ["actions", "Actions"],
              ["connections", "Connections"],
              ["routines", "Routines"],
              ["memory", "Memory"],
              ["activity", "Activity"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`settings-tab${tab === id ? " settings-tab-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "voice" && <VoiceSettings />}
      {tab === "proactive" && <ProactiveSettings onShowBriefing={onShowBriefing} />}
      {tab === "recall" && <RecallSettings />}
      {tab === "actions" && <ActionSettings />}
      {tab === "connections" && <ConnectionsSettings />}
      {tab === "routines" && <RoutinesSettings />}
      {tab === "memory" && <MemorySettings />}
      {tab === "activity" && <ActivitySettings />}

      {tab === "general" && (
      <>
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
          This device has no OS-level secure storage available — your API
          keys are stored as plain text instead of encrypted.
        </div>
      )}
      {status?.googleAuthError && (
        <div className="card-error" role="alert">
          Your Google connection has expired or was revoked — reconnect
          below to keep syncing.
        </div>
      )}

      <div className="settings-section" data-testid="openai-section">
        <div className="settings-label">AI provider (OpenAI)</div>
        {status?.openaiKeyConfigured ? (
          <div className="settings-status settings-status-ok">Configured</div>
        ) : (
          <div className="settings-status">
            Not configured — create a key at platform.openai.com and paste it here.
          </div>
        )}
        <input
          className="settings-input"
          type="password"
          placeholder="sk-..."
          aria-label="OpenAI API key"
          value={openaiKeyInput}
          onChange={(e) => setOpenaiKeyInput(e.target.value)}
          disabled={saving}
        />
        <button
          type="button"
          className="button button-done"
          onClick={() => void handleSaveOpenAiKey()}
          disabled={saving || openaiKeyInput.trim().length === 0}
        >
          {saving ? "Saving — restarting…" : "Save key (restarts the app)"}
        </button>

        {status?.openaiModelChoices && status.openaiModelChoices.length > 0 && (
          <>
            <label className="settings-sublabel" htmlFor="openai-model">
              Model
            </label>
            <select
              id="openai-model"
              className="settings-input"
              value={selectedModel ?? status.openaiModel ?? ""}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={saving}
            >
              {status.openaiModelChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
            {selectedModel && selectedModel !== status.openaiModel && (
              <button
                type="button"
                className="button button-snooze"
                onClick={() => void handleSaveModel()}
                disabled={saving}
              >
                {saving ? "Saving — restarting…" : "Use this model (restarts the app)"}
              </button>
            )}
          </>
        )}

        {usage && (
          <div className="settings-usage" data-testid="usage-summary">
            {describeUsage(usage)}
            <span className="settings-hint"> Estimate — your OpenAI dashboard shows the exact bill.</span>
          </div>
        )}
      </div>

      {onClose && (
        <div className="settings-section">
          <label className="settings-label" htmlFor="chat-auto-hide">
            Chat — hide after inactivity (seconds)
          </label>
          <div className="settings-hint">0 keeps the chat open until you close it.</div>
          <input
            id="chat-auto-hide"
            className="settings-input"
            type="number"
            min={0}
            max={MAX_CHAT_AUTO_HIDE_SECONDS}
            value={autoHideSeconds}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!Number.isFinite(value)) return;
              setChatAutoHideSeconds(value);
              setAutoHideSeconds(getChatAutoHideSeconds());
            }}
          />
        </div>
      )}

      <div className="settings-section">
        <div className="settings-label">Groq API key (backup, optional)</div>
        <div className="settings-hint">Takes over automatically if OpenAI is down or overloaded.</div>
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
      </>
      )}

      {onClose && (
        <button type="button" className="button button-snooze settings-close" onClick={onClose}>
          Close
        </button>
      )}
    </div>
  );
}
