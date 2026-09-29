import { useCallback, useEffect, useState } from "react";

interface RecallSettingsValue {
  documentsFolder: string;
  documentsEnabled: boolean;
  peopleEnabled: boolean;
  emailHistoryDays: number;
}

interface RecallStatusValue {
  state: "idle" | "indexing";
  lastIndexedAt: string | null;
  lastError: string | null;
  model: "idle" | "loading" | "ready" | "failed";
  modelError: string | null;
  sources: Record<string, number>;
  chunks: number;
  embedded: number;
  emailHistoryComplete: boolean;
}

function readResult(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

const SOURCE_LABELS: [string, string][] = [
  ["email", "emails"],
  ["event", "events"],
  ["chat", "chats"],
  ["memory", "memories"],
  ["note", "notes"],
  ["document", "documents"],
];

export function modelLabel(status: RecallStatusValue): string {
  switch (status.model) {
    case "ready":
      return status.embedded < status.chunks
        ? `Understanding meaning… ${status.embedded} of ${status.chunks} pieces done`
        : "Search by meaning is ready";
    case "loading":
      return "Downloading the search model (about 120 MB, first time only)…";
    case "failed":
      return "Search by meaning isn't available yet (keyword search still works) — it retries when you're online.";
    default:
      return "The search model loads the first time it's needed.";
  }
}

/**
 * Settings → Recall (ADR-006 M6): what Zara can search on this PC — email
 * history length, the documents/notes folder, people profiles — and how
 * far indexing has got. Everything stays on this PC.
 */
export function RecallSettings() {
  const [settings, setSettings] = useState<RecallSettingsValue | null>(null);
  const [status, setStatus] = useState<RecallStatusValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const result = readResult(await (window.desktopAPI?.recallStatus?.() ?? Promise.resolve(null)).catch(() => null));
    if (result.ok) setStatus(result.value as RecallStatusValue);
  }, []);

  useEffect(() => {
    let active = true;
    void (window.desktopAPI?.recallGetSettings?.() ?? Promise.resolve(null))
      .catch(() => null)
      .then((raw) => {
        if (!active) return;
        const result = readResult(raw);
        if (result.ok) setSettings(result.value as RecallSettingsValue);
        else setError(result.message);
      });
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshStatus]);

  const apply = async (call: Promise<unknown> | undefined) => {
    setError(null);
    const result = readResult(await (call ?? Promise.resolve(null)).catch(() => null));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.value && typeof result.value === "object" && "documentsFolder" in result.value) {
      setSettings(result.value as RecallSettingsValue);
    }
    void refreshStatus();
  };

  const update = (patch: Partial<RecallSettingsValue>) => void apply(window.desktopAPI?.recallUpdateSettings?.(patch));

  return (
    <div data-testid="recall-settings">
      {error && (
        <div className="card-error" role="alert">
          {error}
        </div>
      )}

      <div className="settings-section">
        <div className="settings-label">What Zara can search</div>
        <div className="settings-hint">
          Your email, calendar, chats, memory, notes and documents are indexed on this PC only. When you ask about them, just the
          few matching snippets are sent to the AI.
        </div>
        {status ? (
          <div className="recall-status" data-testid="recall-status">
            <div>
              {SOURCE_LABELS.map(([key, label]) => `${status.sources[key] ?? 0} ${label}`).join(" · ")}
            </div>
            <div className="settings-hint">{modelLabel(status)}</div>
            {!status.emailHistoryComplete && <div className="settings-hint">Still fetching older email…</div>}
            <div className="settings-hint">
              {status.state === "indexing"
                ? "Indexing now…"
                : status.lastIndexedAt
                  ? `Last updated ${new Date(status.lastIndexedAt).toLocaleString()}`
                  : "Not indexed yet."}
            </div>
            {status.lastError && <div className="settings-hint">Last problem: {status.lastError}</div>}
          </div>
        ) : (
          <div className="settings-hint">Loading…</div>
        )}
        <button
          type="button"
          className="button button-snooze"
          disabled={status?.state === "indexing"}
          onClick={() => void apply(window.desktopAPI?.recallIndex?.())}
        >
          {status?.state === "indexing" ? "Indexing…" : "Update the index now"}
        </button>
      </div>

      {settings && (
        <>
          <div className="settings-section">
            <div className="settings-label">Email history</div>
            <select
              aria-label="Email history"
              className="settings-input"
              value={settings.emailHistoryDays}
              onChange={(e) => update({ emailHistoryDays: Number(e.target.value) })}
            >
              <option value={30}>Last month</option>
              <option value={90}>Last 3 months</option>
            </select>
          </div>

          <div className="settings-section">
            <div className="settings-label">Notes and documents</div>
            <label className="settings-radio">
              <input
                type="checkbox"
                checked={settings.documentsEnabled}
                onChange={(e) => update({ documentsEnabled: e.target.checked })}
              />
              <span>
                Read my documents folder <span className="settings-hint">— PDF, Word, text and Markdown; notes go in its Notes folder</span>
              </span>
            </label>
            <div className="recall-folder" title={settings.documentsFolder}>
              {settings.documentsFolder}
            </div>
            <div className="recall-folder-actions">
              <button type="button" className="button button-snooze" onClick={() => void apply(window.desktopAPI?.recallOpenFolder?.())}>
                Open folder
              </button>
              <button type="button" className="button button-snooze" onClick={() => void apply(window.desktopAPI?.recallChooseFolder?.())}>
                Change…
              </button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">People (experimental)</div>
            <label className="settings-radio">
              <input type="checkbox" checked={settings.peopleEnabled} onChange={(e) => update({ peopleEnabled: e.target.checked })} />
              <span>
                Let Zara build quick profiles of people you email and meet{" "}
                <span className="settings-hint">— from your own email and calendar, nothing stored</span>
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
