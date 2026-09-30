import { useCallback, useEffect, useState } from "react";

interface MemoryFact {
  id: string;
  content: string;
  category: "about_you" | "people" | "preferences" | "other";
}

const CATEGORY_LABELS: Record<MemoryFact["category"], string> = {
  about_you: "About you",
  people: "People",
  preferences: "Preferences",
  other: "Other",
};

function readResult<T>(raw: unknown): { ok: true; value: T } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value as T };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

/**
 * Settings → Memory (ADR-006 M3): everything Zara remembers, grouped, each
 * editable and deletable; plus "forget everything" and "delete all chats".
 */
export function MemorySettings() {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"memory" | "chats" | null>(null);

  const load = useCallback(async () => {
    const result = readResult<{ facts: MemoryFact[] }>(await window.desktopAPI?.memoryList?.().catch(() => null));
    if (result.ok) setFacts(result.value.facts);
    else setError(result.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (call: Promise<unknown> | undefined, onDone?: () => void) => {
    setError(null);
    setNotice(null);
    const result = readResult(await (call ?? Promise.resolve(null)).catch(() => null));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onDone?.();
    await load();
  };

  const saveEdit = async (id: string) => {
    await run(window.desktopAPI?.memoryUpdate?.(id, draft), () => setEditingId(null));
  };

  const grouped = (Object.keys(CATEGORY_LABELS) as MemoryFact["category"][])
    .map((category) => ({ category, items: (facts ?? []).filter((fact) => fact.category === category) }))
    .filter((group) => group.items.length > 0);

  return (
    <div data-testid="memory-settings">
      <p className="settings-hint">
        What Zara remembers about you. She learns from your chats; you can correct or remove anything here — or just
        tell her "that's wrong".
      </p>
      {error && (
        <div className="card-error" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="settings-status settings-status-ok">{notice}</div>}

      {facts !== null && facts.length === 0 && <div className="settings-status">Nothing remembered yet.</div>}

      {grouped.map((group) => (
        <div key={group.category} className="settings-section">
          <div className="settings-label">{CATEGORY_LABELS[group.category]}</div>
          {group.items.map((fact) =>
            editingId === fact.id ? (
              <div key={fact.id} className="memory-row">
                <input
                  className="settings-input memory-edit"
                  aria-label="Edit memory"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveEdit(fact.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <button type="button" className="memory-action" onClick={() => void saveEdit(fact.id)}>
                  Save
                </button>
                <button type="button" className="memory-action" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div key={fact.id} className="memory-row">
                <span className="memory-text">{fact.content}</span>
                <button
                  type="button"
                  className="memory-action"
                  aria-label={`Edit "${fact.content}"`}
                  onClick={() => {
                    setEditingId(fact.id);
                    setDraft(fact.content);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="memory-action memory-delete"
                  aria-label={`Forget "${fact.content}"`}
                  onClick={() => void run(window.desktopAPI?.memoryDelete?.(fact.id))}
                >
                  Forget
                </button>
              </div>
            ),
          )}
        </div>
      ))}

      <div className="settings-section">
        <div className="settings-label">Clean slate</div>
        {confirming ? (
          <div className="memory-confirm">
            <span>{confirming === "memory" ? "Forget everything Zara remembers?" : "Delete every saved chat?"}</span>
            <button
              type="button"
              className="button button-retry"
              onClick={() =>
                void run(
                  confirming === "memory" ? window.desktopAPI?.memoryDeleteAll?.() : window.desktopAPI?.chatDeleteAll?.(),
                  () => {
                    setNotice(confirming === "memory" ? "Zara's memory was cleared." : "All chats were deleted.");
                    setConfirming(null);
                  },
                )
              }
            >
              Yes, delete
            </button>
            <button type="button" className="button button-snooze" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="memory-danger-row">
            <button type="button" className="button button-snooze" onClick={() => setConfirming("memory")}>
              Forget everything
            </button>
            <button type="button" className="button button-snooze" onClick={() => setConfirming("chats")}>
              Delete all chats
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
