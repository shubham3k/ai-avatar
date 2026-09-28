import { useCallback, useEffect, useRef, useState } from "react";
import { Dock } from "./components/Dock";
import { InterventionOverlay } from "./components/InterventionOverlay";
import { InterventionStatus } from "./components/InterventionStatus";
import { ReminderComposer } from "./components/ReminderComposer";
import { Settings } from "./components/Settings";
import type { InterventionActionSpec } from "./lib/intervention-actions";
import { useInterventionPolling } from "./state/use-intervention-polling";
import { useReminderComposer } from "./state/use-reminder-composer";
import { useReportContentSize } from "./state/use-report-content-size";
import { useSetupStatus } from "./state/use-setup-status";

const DEFAULT_SNOOZE_MINUTES = 60;
const STATUS_MESSAGE_DURATION_MS = 1500;

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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reminders = useReminderComposer();
  const [chatOpen, setChatOpen] = useState(false);

  // A brief, self-clearing confirmation after an action succeeds — kept
  // independent of the interventions list state so it still shows even
  // when resolving the last item switches the whole screen to "All caught
  // up" on the very next render.
  const flashStatus = useCallback((message: string) => {
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    setStatusMessage(message);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    },
    [],
  );

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

  // Keeps the real OS window sized to whatever's actually rendered instead
  // of its original fixed size (see overlay-window.ts's resizeOverlayToContent).
  useReportContentSize();

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
      flashStatus("Marked as done");
      await refresh();
    } catch {
      // Keep the card visible so the user can retry.
      setActionError("Could not mark as done. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [intervention, refresh, flashStatus]);

  const handleSnooze = useCallback(async () => {
    if (!intervention || !window.desktopAPI) return;
    setBusy(true);
    setActionError(null);
    try {
      await window.desktopAPI.snooze(intervention.id, DEFAULT_SNOOZE_MINUTES);
      setActionError(null);
      flashStatus("We'll remind you later");
      await refresh();
    } catch {
      setActionError("Could not snooze. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [intervention, refresh, flashStatus]);

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

  const handleAction = useCallback(
    (actionId: InterventionActionSpec["id"]) => {
      if (actionId === "done") void handleDone();
      else if (actionId === "remind") void handleSnooze();
      else if (actionId === "open") void handleOpen();
    },
    [handleDone, handleSnooze, handleOpen],
  );

  const clearReminderFeedback = reminders.clearFeedback;
  const closeChat = useCallback(() => {
    setChatOpen(false);
    clearReminderFeedback();
  }, [clearReminderFeedback]);

  // The persistent bottom-right control pill, rendered last on every screen,
  // with the reminder composer (💬 text box / 🎤 status bubble) directly
  // above it. "last checked" reflects the scheduled tick, the tray's Check
  // now, and the dock's own button, whichever ran most recently (see
  // index.ts's performCheckNow); useSetupStatus re-renders every 15s, which
  // keeps the relative time roughly fresh. Screens where nothing can run yet
  // (startup error, get-started) get the gear only.
  const renderDock = (fullControls: boolean) => (
    <>
      {fullControls && (
        <ReminderComposer composer={reminders} chatOpen={chatOpen} onClose={closeChat} />
      )}
      <Dock
        onToggleSettings={() => setShowSettings((prev) => !prev)}
        settingsWarning={setupStatus?.googleAuthError === true}
        onCheckNow={fullControls ? () => void handleCheckNow() : undefined}
        checking={checking}
        lastCheckedAt={fullControls ? (setupStatus?.lastCheckedAt ?? null) : null}
        onToggleMic={fullControls ? reminders.toggleRecording : undefined}
        recording={reminders.recording}
        micBusy={reminders.transcribing}
        onToggleChat={
          fullControls
            ? () => {
                if (chatOpen) {
                  closeChat();
                } else {
                  setShowSettings(false);
                  setChatOpen(true);
                }
              }
            : undefined
        }
        chatOpen={chatOpen}
      />
    </>
  );

  if (showSettings) {
    return (
      <div className="overlay">
        <Settings
          onClose={() => {
            setShowSettings(false);
            void refreshSetupStatus();
          }}
        />
        {renderDock(true)}
      </div>
    );
  }

  if (startupError) {
    return (
      <div className="overlay">
        <div className="card" data-testid="startup-error-card">
          <div className="card-title">Could not start</div>
          <div className="card-error" role="alert">
            {startupError}
          </div>
          <p className="card-message">
            Check your Settings, or restart the app after fixing the problem.
          </p>
        </div>
        {renderDock(false)}
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
        <Settings />
        {renderDock(false)}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="overlay">
        <div style={{ color: "red", padding: "20px", fontSize: "12px" }}>
          Error loading interventions: {loadError}
        </div>
        {renderDock(true)}
      </div>
    );
  }

  // Deliberately no visible card here: with nothing pending, the overlay
  // shouldn't sit on the desktop as a persistent box — only the dock stays
  // visible, and the window itself shrinks to just its size (see
  // useReportContentSize). A new intervention or reminder reintroduces the
  // card the moment it exists.
  if (interventions.length === 0) {
    return (
      <div className="overlay overlay-idle">
        {checkError && (
          <div className="check-error-banner" role="alert">
            {checkError}
          </div>
        )}
        <InterventionStatus message={statusMessage} />
        {renderDock(true)}
      </div>
    );
  }

  return (
    <div className="overlay">
      {intervention && (
        <InterventionOverlay
          key={intervention.id}
          intervention={intervention}
          actionError={actionError}
          busy={busy}
          onAction={handleAction}
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
      <InterventionStatus message={statusMessage} />
      {renderDock(true)}
    </div>
  );
}
