import { useCallback, useEffect, useState } from "react";

interface Routine {
  id: string;
  title: string;
  instruction: string;
  scheduleText: string;
  takesAction: boolean;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
}

function readResult(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
}

const STATUS_LABELS: Record<string, string> = {
  ok: "ran fine",
  needs_approval: "needed your approval",
  failed: "didn't finish",
};

/**
 * Settings → Routines (ADR-006 M9): routines in plain language. Routines
 * that only read and report run by themselves; those that would send or
 * change something prepare approval cards every run.
 */
export function RoutinesSettings() {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ instruction: "", when: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = readResult(await (window.desktopAPI?.routinesList?.() ?? Promise.resolve(null)).catch(() => null));
    if (result.ok) setRoutines(((result.value as { routines?: Routine[] })?.routines ?? []) as Routine[]);
    else setError(result.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (call: Promise<unknown> | undefined, success?: string, after?: () => void) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = readResult(await (call ?? Promise.resolve(null)).catch(() => null));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (success) setNotice(success);
    after?.();
    await load();
  };

  return (
    <div data-testid="routines-settings">
      {error && (
        <div className="card-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="settings-hint" role="status">
          {notice}
        </div>
      )}

      <div className="settings-section">
        <label className="settings-label" htmlFor="new-routine">
          New routine
        </label>
        <div className="settings-hint">
          Say it your way — e.g. "every Monday at 9, summarize unanswered emails" or "har weekday shaam 6 baje kal ki meetings batao".
        </div>
        <input
          id="new-routine"
          className="settings-input"
          value={text}
          placeholder="Every … at …, …"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) void run(window.desktopAPI?.routinesCreate?.(text), "Routine created.", () => setText(""));
          }}
        />
        <button
          type="button"
          className="button button-done"
          disabled={busy || text.trim().length < 5}
          onClick={() => void run(window.desktopAPI?.routinesCreate?.(text), "Routine created.", () => setText(""))}
        >
          {busy ? "Working…" : "Create routine"}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-label">Your routines</div>
        {routines === null && <div className="settings-hint">Loading…</div>}
        {routines?.length === 0 && <div className="settings-hint">No routines yet.</div>}
        {routines?.map((routine) => (
          <div key={routine.id} className="connection-row" data-testid="routine-row">
            <div className="connection-head">
              <span className="connection-name">{routine.title}</span>
              {routine.takesAction && <span className="tool-badge tool-write">asks every run</span>}
              <label className="settings-radio">
                <input
                  type="checkbox"
                  aria-label={`${routine.title} on`}
                  checked={routine.enabled}
                  onChange={(e) => void run(window.desktopAPI?.routinesUpdate?.(routine.id, { enabled: e.target.checked }))}
                />
                On
              </label>
            </div>
            <div className="settings-hint">{routine.instruction}</div>
            <div className="settings-hint">
              {routine.scheduleText} · next: {routine.enabled ? when(routine.nextRunAt) : "paused"}
              {routine.lastRunAt && ` · last: ${when(routine.lastRunAt)} (${STATUS_LABELS[routine.lastStatus ?? ""] ?? "running"})`}
            </div>
            {editing === routine.id ? (
              <div className="action-card-edit">
                <label>
                  Does <input aria-label="What it does" value={draft.instruction} onChange={(e) => setDraft({ ...draft, instruction: e.target.value })} />
                </label>
                <label>
                  When <input aria-label="When" placeholder="e.g. every Friday at 5pm" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} />
                </label>
                <div className="recall-folder-actions">
                  <button
                    type="button"
                    className="button button-done"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        window.desktopAPI?.routinesUpdate?.(routine.id, {
                          ...(draft.instruction.trim() && draft.instruction !== routine.instruction ? { instruction: draft.instruction } : {}),
                          ...(draft.when.trim() ? { when: draft.when } : {}),
                        }),
                        "Saved.",
                        () => setEditing(null),
                      )
                    }
                  >
                    Save
                  </button>
                  <button type="button" className="button button-snooze" onClick={() => setEditing(null)}>
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="recall-folder-actions">
                <button
                  type="button"
                  className="button button-snooze"
                  disabled={busy}
                  onClick={() => void run(window.desktopAPI?.routinesRun?.(routine.id), `Running "${routine.title}" — its card appears when it's done.`)}
                >
                  Run now
                </button>
                <button
                  type="button"
                  className="button button-snooze"
                  onClick={() => {
                    setDraft({ instruction: routine.instruction, when: "" });
                    setEditing(routine.id);
                  }}
                >
                  Edit
                </button>
                <button type="button" className="button button-snooze" disabled={busy} onClick={() => void run(window.desktopAPI?.routinesDelete?.(routine.id), "Deleted — Undo is in Activity.")}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
