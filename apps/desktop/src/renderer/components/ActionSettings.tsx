import { useEffect, useState } from "react";

interface ActionSettingsValue {
  writingStyle: string;
  permissions: { connected: boolean; sendEmail: boolean; editCalendar: boolean; readDrive: boolean; googleChat?: boolean };
}

function readResult(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

/**
 * Settings → Actions (ADR-006 M7): whether Google has granted Zara the
 * send / calendar permissions (one reconnect adds them), and the user's
 * writing-style notes for drafts.
 */
export function ActionSettings() {
  const [settings, setSettings] = useState<ActionSettingsValue | null>(null);
  const [style, setStyle] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (window.desktopAPI?.actionsGetSettings?.() ?? Promise.resolve(null))
      .catch(() => null)
      .then((raw) => {
        if (!active) return;
        const result = readResult(raw);
        if (result.ok) {
          setSettings(result.value as ActionSettingsValue);
          setStyle((result.value as ActionSettingsValue).writingStyle);
        } else setError(result.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    setError(null);
    setNotice(null);
    const result = readResult(await (window.desktopAPI?.actionsUpdateSettings?.(style) ?? Promise.resolve(null)).catch(() => null));
    if (result.ok) {
      setSettings(result.value as ActionSettingsValue);
      setNotice("Saved — Zara will write like this.");
    } else setError(result.message);
  };

  const permissions = settings?.permissions;
  const missing = permissions && (!permissions.sendEmail || !permissions.editCalendar || !permissions.googleChat);

  return (
    <div data-testid="action-settings">
      {error && (
        <div className="card-error" role="alert">
          {error}
        </div>
      )}
      <div className="settings-section">
        <div className="settings-label">Email, Google Chat and calendar actions</div>
        <div className="settings-hint">
          Zara can draft and send email and Google Chat messages and add, move or cancel events — but only after you approve each one on its
          card. Emails and chat messages always need your click and wait 30 seconds with Undo. She reads a Google Chat only when you ask.
        </div>
        {!permissions ? (
          <div className="settings-hint">Loading…</div>
        ) : !permissions.connected ? (
          <div className="settings-status">Connect Google first (General tab).</div>
        ) : missing ? (
          <>
            <div className="settings-status" role="status">
              Google hasn't given Zara permission to{" "}
              {[!permissions.sendEmail && "send email", !permissions.editCalendar && "change your calendar", !permissions.googleChat && "use Google Chat"]
                .filter(Boolean)
                .join(" or ")}{" "}
              yet.
            </div>
            <button type="button" className="button button-done" onClick={() => void window.desktopAPI?.connectGoogle()}>
              Reconnect Google to allow it
            </button>
            <div className="settings-hint">
              Google will ask you to approve: send email, see and edit calendar events, read Drive files, read and send Google Chat messages,
              and see your company directory (to show who wrote in a chat space). Google Chat needs a Workspace (company) account and the
              Google Chat API enabled in your Google Cloud project.
            </div>
          </>
        ) : (
          <div className="settings-status settings-status-ok">Allowed ✓ — send email, Google Chat, and edit calendar events</div>
        )}
      </div>

      <div className="settings-section">
        <label className="settings-label" htmlFor="writing-style">
          Your writing style
        </label>
        <div className="settings-hint">
          How your emails should sound — e.g. "Short and warm. Hinglish is fine with the team. Sign off: Cheers, Shubham". Zara also learns
          from emails you've sent and from your edits to her drafts.
        </div>
        <textarea
          id="writing-style"
          className="settings-input"
          rows={4}
          maxLength={4000}
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        />
        <button type="button" className="button button-snooze" onClick={() => void save()} disabled={style === settings?.writingStyle}>
          Save style
        </button>
        {notice && <div className="settings-hint" role="status">{notice}</div>}
      </div>
    </div>
  );
}
