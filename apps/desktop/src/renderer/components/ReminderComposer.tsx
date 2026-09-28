import type { ReminderComposer as ComposerState } from "../state/use-reminder-composer";

export interface ReminderComposerProps {
  composer: ComposerState;
  /** 💬 toggled open: show the text box. Otherwise only voice status/feedback shows, as a small bubble. */
  chatOpen: boolean;
  onClose: () => void;
}

/**
 * Sits directly above the dock. With 💬 open it's a compact text box
 * ("remind me in 10 minutes to stretch" + Enter); with it closed it only
 * appears as a small status bubble while 🎤 is listening/processing, or to
 * show the result — then disappears again on its own.
 */
export function ReminderComposer({ composer, chatOpen, onClose }: ReminderComposerProps) {
  const { text, setText, saving, recording, transcribing, error, confirmation, submitText } = composer;

  const status = recording ? "Listening… click 🎤 again when you're done." : transcribing ? "Setting your reminder…" : null;
  const feedback = (
    <>
      {status && (
        <div className="composer-status" role="status">
          {status}
        </div>
      )}
      {error && (
        <div className="composer-error" role="alert">
          {error}
        </div>
      )}
      {confirmation && !error && (
        <div className="composer-ok" role="status">
          {confirmation}
        </div>
      )}
    </>
  );

  if (!chatOpen) {
    if (!status && !error && !confirmation) return null;
    return (
      <div className="composer composer-bubble" data-testid="reminder-bubble">
        {feedback}
      </div>
    );
  }

  const busy = saving || recording || transcribing;
  const canSend = text.trim().length > 0 && !busy;

  return (
    <div className="composer" data-testid="reminder-composer">
      {feedback}
      <div className="composer-row">
        <input
          className="composer-input"
          type="text"
          autoFocus
          placeholder="Remind me in 10 min to stretch…"
          aria-label="What should I remind you about, and when?"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSend) void submitText();
            if (e.key === "Escape") onClose();
          }}
        />
        <button
          type="button"
          className="composer-send"
          aria-label="Add reminder"
          title="Add reminder (Enter)"
          disabled={!canSend}
          onClick={() => void submitText()}
        >
          {saving ? "…" : "↵"}
        </button>
      </div>
      <div className="composer-hint">
        "at 4pm" or "in 10 min" pings you then · "meeting at 5pm" warns you 10 min early
      </div>
    </div>
  );
}
