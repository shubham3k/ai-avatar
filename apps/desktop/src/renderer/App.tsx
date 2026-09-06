import { useCallback, useEffect, useState } from "react";
import { Character } from "./components/Character";
import { InterventionCard } from "./components/InterventionCard";
import { useInterventionPolling } from "./state/use-intervention-polling";

const DEFAULT_SNOOZE_MINUTES = 60;

export default function App() {
  const { intervention, refresh, loadError } = useInterventionPolling();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.desktopAPI?.setInteractive(intervention !== null);
  }, [intervention]);

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

  // Debug: show error or waiting state while loading
  if (loadError) {
    return (
      <div className="overlay">
        <div style={{ color: "red", padding: "20px", fontSize: "12px" }}>
          Error loading interventions: {loadError}
        </div>
      </div>
    );
  }

  if (intervention === null) {
    return (
      <div className="overlay">
        <div style={{ color: "gray", padding: "20px", fontSize: "12px" }}>
          No pending interventions
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <Character />
      <InterventionCard
        intervention={intervention}
        actionError={actionError}
        onDone={() => void handleDone()}
        onSnooze={() => void handleSnooze()}
      />
      {busy && <div className="busy-indicator">Working…</div>}
    </div>
  );
}
