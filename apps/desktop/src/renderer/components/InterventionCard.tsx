import type { InterventionDto } from "@ai-agent/shared";

export interface InterventionCardProps {
  intervention: InterventionDto;
  actionError: string | null;
  onDone: () => void;
  onSnooze: () => void;
  onOpen: () => void;
}

function sourceUrlOf(intervention: InterventionDto): string | null {
  if (intervention.actionType !== "open_source") return null;
  const payload = intervention.actionPayload;
  if (!payload || typeof payload !== "object") return null;
  const url = (payload as Record<string, unknown>).sourceUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

export function InterventionCard({
  intervention,
  actionError,
  onDone,
  onSnooze,
  onOpen,
}: InterventionCardProps) {
  const sourceUrl = sourceUrlOf(intervention);

  return (
    <div className={`card priority-${intervention.priority}`} data-testid="intervention-card">
      <div className="card-priority">{intervention.priority.toUpperCase()}</div>
      <h2 className="card-title">{intervention.title}</h2>
      <p className="card-message">{intervention.message}</p>
      {actionError !== null && (
        <div className="card-error" role="alert">
          <span>{actionError}</span>
          <button type="button" className="button button-retry" onClick={onDone}>
            Retry
          </button>
        </div>
      )}
      <div className="card-actions">
        {sourceUrl !== null && (
          <button type="button" className="button button-open" onClick={onOpen}>
            Open
          </button>
        )}
        <button type="button" className="button button-done" onClick={onDone}>
          Done
        </button>
        <button type="button" className="button button-snooze" onClick={onSnooze}>
          Remind me later
        </button>
      </div>
    </div>
  );
}
