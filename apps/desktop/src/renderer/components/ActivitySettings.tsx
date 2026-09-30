import { useCallback, useEffect, useState } from "react";
import { formatRelativeTime } from "../lib/relative-time";

interface ActivityEntry {
  id: string;
  createdAt: string;
  summary: string;
  provider: string | null;
  canUndo: boolean;
  undoneAt: string | null;
}

function readResult<T>(raw: unknown): { ok: true; value: T } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value as T };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

/** Settings → Activity (ADR-006 M3): everything Zara did, newest first, with Undo where possible. */
export function ActivitySettings() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const load = useCallback(async () => {
    const result = readResult<{ entries: ActivityEntry[] }>(await window.desktopAPI?.activityList?.().catch(() => null));
    if (result.ok) setEntries(result.value.entries);
    else setError(result.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const undo = async (id: string) => {
    setError(null);
    const result = readResult(await window.desktopAPI?.activityUndo?.(id).catch(() => null));
    if (!result.ok) setError(result.message);
    await load();
  };

  const clear = async () => {
    setError(null);
    const result = readResult(await window.desktopAPI?.activityClear?.().catch(() => null));
    if (!result.ok) setError(result.message);
    setConfirmingClear(false);
    await load();
  };

  return (
    <div data-testid="activity-settings">
      <p className="settings-hint">Everything Zara did for you, newest first. Undo reverses it where that's possible.</p>
      {error && (
        <div className="card-error" role="alert">
          {error}
        </div>
      )}
      {entries !== null && entries.length === 0 && <div className="settings-status">Nothing yet.</div>}

      <ul className="activity-list">
        {(entries ?? []).map((entry) => (
          <li key={entry.id} className={`activity-row${entry.undoneAt ? " activity-undone" : ""}`}>
            <div className="activity-main">
              <span className="activity-summary">{entry.summary}</span>
              <span className="activity-meta">
                {formatRelativeTime(new Date(entry.createdAt).getTime())}
                {entry.provider === "groq" ? " · via Groq backup" : ""}
                {entry.undoneAt ? " · undone" : ""}
              </span>
            </div>
            {entry.canUndo && (
              <button type="button" className="memory-action" onClick={() => void undo(entry.id)}>
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>

      {entries !== null && entries.length > 0 && (
        <div className="settings-section">
          {confirmingClear ? (
            <div className="memory-confirm">
              <span>Clear the whole log? (This doesn't undo anything.)</span>
              <button type="button" className="button button-retry" onClick={() => void clear()}>
                Yes, clear
              </button>
              <button type="button" className="button button-snooze" onClick={() => setConfirmingClear(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="button button-snooze" onClick={() => setConfirmingClear(true)}>
              Clear log
            </button>
          )}
        </div>
      )}
    </div>
  );
}
