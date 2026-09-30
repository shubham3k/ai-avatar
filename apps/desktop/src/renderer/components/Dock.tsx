import { formatRelativeTime } from "../lib/relative-time";

export interface DockProps {
  onToggleSettings: () => void;
  /** Shows the red "needs attention" dot on the gear (e.g. Google auth expired). */
  settingsWarning?: boolean;
  /** Omit on screens where a check can't run yet (get-started, startup error). */
  onCheckNow?: (() => void) | undefined;
  checking?: boolean;
  /** Epoch ms of the last check (scheduled or manual), or null before the first one. */
  lastCheckedAt?: number | null;
  /** Reminder shortcuts — omit (with onCheckNow) on screens where reminders can't work yet. */
  onToggleMic?: (() => void) | undefined;
  recording?: boolean;
  /** A recorded clip is being processed — the mic can't start another one yet. */
  micBusy?: boolean;
  onToggleChat?: (() => void) | undefined;
  chatOpen?: boolean;
  /** M5: pop-ups held (presenting, full-screen, call, quiet hours) — how many are waiting, and why. */
  waitingCount?: number;
  heldLabel?: string;
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
    </svg>
  );
}

/**
 * The always-present control strip: one compact pill anchored bottom-right
 * — settings, reminder shortcuts (🎤 voice, 💬 type), Check now, and the
 * last-checked time. Lives in normal layout flow, so the content-sized
 * window (use-report-content-size.ts) shrinks to just this pill when
 * nothing else is showing.
 */
export function Dock({
  onToggleSettings,
  settingsWarning = false,
  onCheckNow,
  checking = false,
  lastCheckedAt = null,
  onToggleMic,
  recording = false,
  micBusy = false,
  onToggleChat,
  chatOpen = false,
  waitingCount = 0,
  heldLabel,
}: DockProps) {
  const relative = lastCheckedAt != null ? formatRelativeTime(lastCheckedAt) : null;
  const hasReminderButtons = Boolean(onToggleMic || onToggleChat);

  return (
    <div className="dock" data-testid="dock">
      <button
        type="button"
        className={`dock-button dock-icon dock-settings${settingsWarning ? " settings-toggle-warning" : ""}`}
        aria-label="Settings"
        title={settingsWarning ? "Google connection needs to be reconnected" : "Settings"}
        onClick={onToggleSettings}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {hasReminderButtons && (
        <>
          <span className="dock-divider" aria-hidden="true" />
          {onToggleMic && (
            <button
              type="button"
              className={`dock-button dock-icon dock-mic${recording ? " dock-recording" : ""}`}
              aria-label={recording ? "Stop recording" : "Talk to Zara"}
              aria-pressed={recording}
              title={recording ? "Stop and send to Zara" : "Talk to Zara"}
              disabled={micBusy}
              onClick={onToggleMic}
            >
              {recording ? <StopIcon /> : <MicIcon />}
            </button>
          )}
          {onToggleChat && (
            <button
              type="button"
              className={`dock-button dock-icon${chatOpen ? " dock-active" : ""}`}
              aria-label="Chat with Zara"
              aria-pressed={chatOpen}
              title="Chat with Zara"
              onClick={onToggleChat}
            >
              <ChatIcon />
            </button>
          )}
        </>
      )}
      {onCheckNow && (
        <>
          <span className="dock-divider" aria-hidden="true" />
          <button
            type="button"
            className="dock-button dock-check"
            onClick={onCheckNow}
            disabled={checking}
          >
            <span className={`dock-check-icon${checking ? " dock-spin" : ""}`} aria-hidden="true">
              ↻
            </span>
            {checking ? "Checking…" : "Check now"}
          </button>
        </>
      )}
      {waitingCount > 0 && (
        <>
          <span className="dock-divider" aria-hidden="true" />
          <span className="dock-waiting" title={`Held ${heldLabel ?? "for now"} — they'll show when you're free`}>
            ⏸ {waitingCount} waiting
          </span>
        </>
      )}
      {relative && (
        <>
          <span className="dock-divider" aria-hidden="true" />
          <span className="dock-meta" title={`Last checked ${relative}`}>
            {relative}
          </span>
        </>
      )}
    </div>
  );
}
