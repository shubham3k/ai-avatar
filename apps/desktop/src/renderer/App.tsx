import { useCallback, useEffect, useState } from "react";
import { Character } from "./components/Character";
import { InterventionCard } from "./components/InterventionCard";
import { Settings } from "./components/Settings";
import { useInterventionPolling } from "./state/use-intervention-polling";
import { useSetupStatus } from "./state/use-setup-status";

const DEFAULT_SNOOZE_MINUTES = 60;

export default function App() {
  const { interventions, refresh, loadError } = useInterventionPolling();
  const { status: setupStatus, refresh: refreshSetupStatus } = useSetupStatus();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.desktopAPI) return;
    window.desktopAPI
      .getSettings()
      .then((raw) => {
        if (raw && typeof raw === "object" && "startupError" in raw) {
          const value = (raw as { startupError: unknown }).startupError;
          setStartupError(typeof value === "string" ? value : null);
        }
      })
      .catch(() => {
        // Non-fatal — the existing polling error state already covers "can't reach the API".
      });
  }, []);

  // Keep the current index in range as the list shrinks/grows (an action
  // completing, or a fresh check-now finding something new).
  useEffect(() => {
    setCurrentIndex((prev) => {
      if (interventions.length === 0) return 0;
      return Math.min(prev, interventions.length - 1);
    });
  }, [interventions.length]);

  const intervention = interventions[currentIndex] ?? null;

  // The overlay window starts click-through (see overlay-window.ts) so it
  // doesn't block clicks to the desktop behind it while idle — originally
  // toggled on only when an intervention card was showing. Every screen
  // this component can render now has real clickable content (at minimum
  // the settings gear icon, always present), so it needs to be interactive
  // in every state, not just when there's an intervention. Set once on
  // mount rather than re-deriving per state.
  useEffect(() => {
    window.desktopAPI?.setInteractive(true);
  }, []);

  const handleCheckNow = useCallback(async () => {
    if (!window.desktopAPI) return;
    setChecking(true);
    setCheckError(null);
    try {
      await window.desktopAPI.checkNow();
      await refresh();
    } catch {
      setCheckError("Could not check for updates. Please try again.");
    } finally {
      setChecking(false);
    }
  }, [refresh]);

  const handleDone = useCallback(async () => {
    if (!intervention || !window.desktopAPI) return;
    setBusy(true);
    setActionError(null);
    try {
      await window.desktopAPI.markDone(intervention.id);
      setActionError(null);
      await refresh();
    } catch {
      // Keep the card visible so the user can retry.
      setActionError("Could not mark as done. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [intervention, refresh]);

  const handleSnooze = useCallback(async () => {
    if (!intervention || !window.desktopAPI) return;
    setBusy(true);
    setActionError(null);
    try {
      await window.desktopAPI.snooze(intervention.id, DEFAULT_SNOOZE_MINUTES);
      setActionError(null);
      await refresh();
    } catch {
      setActionError("Could not snooze. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [intervention, refresh]);

  const handleOpen = useCallback(async () => {
    if (!intervention || !window.desktopAPI) return;
    const payload = intervention.actionPayload;
    const sourceUrl =
      payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).sourceUrl === "string"
        ? ((payload as Record<string, unknown>).sourceUrl as string)
        : null;
    if (!sourceUrl) return;
    setBusy(true);
    setActionError(null);
    try {
      await window.desktopAPI.openSource(sourceUrl);
      setActionError(null);
    } catch {
      setActionError("Could not open the source. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [intervention]);

  const settingsToggle = (
    <button
      type="button"
      className="settings-toggle"
      aria-label="Settings"
      onClick={() => setShowSettings((prev) => !prev)}
    >
      {"⚙"}
    </button>
  );

  if (showSettings) {
    return (
      <div className="overlay">
        {settingsToggle}
        <Settings
          onClose={() => {
            setShowSettings(false);
            void refreshSetupStatus();
          }}
        />
      </div>
    );
  }

  if (startupError) {
    return (
      <div className="overlay">
        {settingsToggle}
        <div className="card" data-testid="startup-error-card">
          <div className="card-title">Could not start</div>
          <div className="card-error" role="alert">
            {startupError}
          </div>
          <p className="card-message">
            Check your Settings, or restart the app after fixing the problem.
          </p>
        </div>
      </div>
    );
  }

  // Groq key + Google connection are both required before anything else
  // can work (Google sync needs a connection, evaluation needs Groq) — show
  // the get-started screen directly instead of the normal empty state
  // until both are done. `setupStatus === null` is the brief moment before
  // the first status load resolves; render nothing rather than flash the
  // wrong screen.
  if (setupStatus && (!setupStatus.groqKeyConfigured || !setupStatus.googleConnected)) {
    return (
      <div className="overlay">
        {settingsToggle}
        <Settings />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="overlay">
        {settingsToggle}
        <div style={{ color: "red", padding: "20px", fontSize: "12px" }}>
          Error loading interventions: {loadError}
        </div>
      </div>
    );
  }

  const checkNowButton = (
    <button
      type="button"
      className="check-now-toggle"
      onClick={() => void handleCheckNow()}
      disabled={checking}
    >
      {checking ? "Checking…" : "Check now"}
    </button>
  );

  if (interventions.length === 0) {
    return (
      <div className="overlay">
        {settingsToggle}
        {checkNowButton}
        <div className="card empty-card">
          <div className="card-title">All caught up</div>
          <p className="card-message">
            Nothing needs your attention right now. Check now to look for new
            emails and events.
          </p>
          {checkError && (
            <div className="card-error" role="alert">
              {checkError}
            </div>
          )}
          <button
            type="button"
            className="button button-done"
            onClick={() => void handleCheckNow()}
            disabled={checking}
          >
            {checking ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      {settingsToggle}
      {checkNowButton}
      <Character />
      {intervention && (
        <InterventionCard
          intervention={intervention}
          actionError={actionError}
          onDone={() => void handleDone()}
          onSnooze={() => void handleSnooze()}
          onOpen={() => void handleOpen()}
        />
      )}
      {interventions.length > 1 && (
        <div className="nav-controls">
          <button
            type="button"
            className="nav-button"
            aria-label="Previous"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          >
            {"‹"}
          </button>
          <span className="nav-counter">
            {currentIndex + 1} of {interventions.length}
          </span>
          <button
            type="button"
            className="nav-button"
            aria-label="Next"
            disabled={currentIndex === interventions.length - 1}
            onClick={() => setCurrentIndex((i) => Math.min(interventions.length - 1, i + 1))}
          >
            {"›"}
          </button>
        </div>
      )}
      {busy && <div className="busy-indicator">Working…</div>}
    </div>
  );
}
