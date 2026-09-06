import type { InterventionDto } from "@ai-agent/shared";

export interface InterventionCardProps {
  intervention: InterventionDto;
  actionError: string | null;
  onDone: () => void;
  onSnooze: () => void;
}

export function InterventionCard({
  intervention,
  actionError,
  onDone,
  onSnooze,
}: InterventionCardProps) {
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
