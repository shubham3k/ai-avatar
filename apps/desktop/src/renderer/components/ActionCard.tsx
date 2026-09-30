import { useState } from "react";
import type { ActionCardData } from "../state/use-action-cards";

export interface ActionCardProps {
  card: ActionCardData;
  now: number;
  onApprove: (id: string, payload?: Record<string, unknown>) => Promise<string | null>;
  onCancel: (id: string) => Promise<string | null>;
  onDismiss: (id: string) => void;
}

function when(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** ISO → the value a datetime-local input wants (local time). */
export function toLocalInput(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/**
 * ADR-006 §8 approval card: exactly what will happen — recipients and text,
 * or the calendar before → after and who gets notified — with Approve /
 * Edit / Cancel. Email then shows "Sending in 30 s… [Undo]".
 */
export function ActionCard({ card, now, onApprove, onCancel, onDismiss }: ActionCardProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payload = card.payload;
  const [draft, setDraft] = useState(() => ({
    to: strings(payload.to).join(", "),
    cc: strings(payload.cc).join(", "),
    subject: typeof payload.subject === "string" ? payload.subject : "",
    body: typeof payload.body === "string" ? payload.body : "",
    title: typeof payload.title === "string" ? payload.title : (card.before?.title ?? ""),
    start: toLocalInput(payload.start ?? card.before?.start),
    end: toLocalInput(payload.end ?? card.before?.end),
  }));

  const run = async (call: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const message = await call();
    setBusy(false);
    if (message) setError(message);
    else setEditing(false);
  };

  const editedPayload = (): Record<string, unknown> | null => {
    if (card.kind === "email_send") {
      return { ...payload, to: splitAddresses(draft.to), cc: splitAddresses(draft.cc), subject: draft.subject, body: draft.body };
    }
    const start = fromLocalInput(draft.start);
    const end = fromLocalInput(draft.end);
    if (!start || !end) return null;
    return { ...payload, title: draft.title, start, end };
  };

  const isEmail = card.kind === "email_send";
  const canEdit = card.kind !== "calendar_cancel";
  const secondsLeft = card.executeAt ? Math.max(0, Math.ceil((new Date(card.executeAt).getTime() - now) / 1000)) : 0;
  const heading = {
    email_send: "✉ Email",
    calendar_create: "📅 New event",
    calendar_update: "📅 Change an event",
    calendar_cancel: "📅 Cancel an event",
  }[card.kind];

  return (
    <div className={`action-card action-${card.status}`} data-testid="action-card" role="group" aria-label={heading}>
      <div className="action-card-heading">
        {heading}
        <span className="action-card-state">
          {card.status === "pending" && "needs your OK"}
          {card.status === "sending" && `sending in ${secondsLeft} s`}
          {card.status === "done" && (isEmail ? "sent ✓" : "done ✓")}
          {card.status === "cancelled" && "cancelled"}
          {card.status === "failed" && "didn't go through"}
        </span>
      </div>

      {editing ? (
        <div className="action-card-edit">
          {isEmail ? (
            <>
              <label>
                To <input aria-label="To" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </label>
              <label>
                Cc <input aria-label="Cc" value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} />
              </label>
              <label>
                Subject <input aria-label="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </label>
              <textarea aria-label="Email text" rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </>
          ) : (
            <>
              <label>
                Title <input aria-label="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label>
                Starts <input aria-label="Starts" type="datetime-local" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
              </label>
              <label>
                Ends <input aria-label="Ends" type="datetime-local" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
              </label>
            </>
          )}
        </div>
      ) : isEmail ? (
        <div className="action-card-body">
          <div>
            <b>To:</b> {strings(payload.to).join(", ")}
          </div>
          {strings(payload.cc).length > 0 && (
            <div>
              <b>Cc:</b> {strings(payload.cc).join(", ")}
            </div>
          )}
          <div>
            <b>Subject:</b> {String(payload.subject ?? "")}
          </div>
          <div className="action-card-text">{String(payload.body ?? "")}</div>
        </div>
      ) : (
        <div className="action-card-body">
          {card.kind === "calendar_create" && (
            <>
              <div>
                <b>{String(payload.title ?? "")}</b>
              </div>
              <div>
                {when(payload.start)} – {when(payload.end)}
              </div>
            </>
          )}
          {card.kind === "calendar_update" && card.before && (
            <>
              <div>
                <b>{String(payload.title ?? card.before.title)}</b>
              </div>
              <div className="action-card-before">Before: {when(card.before.start)} – {when(card.before.end)}</div>
              <div>
                After: {when(payload.start ?? card.before.start)} – {when(payload.end ?? card.before.end)}
              </div>
            </>
          )}
          {card.kind === "calendar_cancel" && (
            <div>
              Cancel <b>“{String(payload.title ?? card.before?.title ?? "")}”</b>
              {card.before ? ` (${when(card.before.start)})` : ""}
            </div>
          )}
        </div>
      )}

      {card.newRecipients.length > 0 && card.status === "pending" && (
        <div className="action-card-warning" role="note">
          ⚠ First time emailing {card.newRecipients.join(", ")} — check the address.
        </div>
      )}
      {!isEmail && card.status === "pending" && (
        <div className="action-card-note">
          {card.notifies.length > 0
            ? `${card.notifies.join(", ")} will get an email from Google about this.`
            : "Only on your calendar — nobody is notified. You can also just say yes."}
        </div>
      )}
      {(error || card.error) && (
        <div className="action-card-error" role="alert">
          {error ?? card.error}
        </div>
      )}

      <div className="action-card-buttons">
        {card.status === "pending" && !editing && (
          <>
            <button type="button" className="button button-done" disabled={busy} onClick={() => void run(() => onApprove(card.id))}>
              {isEmail ? "Approve & send" : "Approve"}
            </button>
            {canEdit && (
              <button type="button" className="button button-snooze" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <button type="button" className="button button-snooze" disabled={busy} onClick={() => void run(() => onCancel(card.id))}>
              Cancel
            </button>
          </>
        )}
        {card.status === "pending" && editing && (
          <>
            <button
              type="button"
              className="button button-done"
              disabled={busy}
              onClick={() => {
                const edited = editedPayload();
                if (!edited) {
                  setError("Check the start and end times.");
                  return;
                }
                void run(() => onApprove(card.id, edited));
              }}
            >
              {isEmail ? "Save & send" : "Save & approve"}
            </button>
            <button type="button" className="button button-snooze" disabled={busy} onClick={() => setEditing(false)}>
              Back
            </button>
          </>
        )}
        {card.status === "sending" && (
          <button type="button" className="button button-snooze" disabled={busy} onClick={() => void run(() => onCancel(card.id))}>
            Undo
          </button>
        )}
        {(card.status === "done" || card.status === "cancelled" || card.status === "failed") && (
          <button type="button" className="button button-snooze" onClick={() => onDismiss(card.id)}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
