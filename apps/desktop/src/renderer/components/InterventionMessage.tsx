import type { InterventionDto } from "@ai-agent/shared";

export interface InterventionMessageProps {
  intervention: InterventionDto;
}

export function InterventionMessage({ intervention }: InterventionMessageProps) {
  return (
    <div className={`card intervention-message priority-${intervention.priority}`}>
      <div className="card-priority">
        {intervention.priority === "critical" ? "⚠ " : ""}
        {intervention.priority.toUpperCase()}
      </div>
      <h2 className="card-title">{intervention.title}</h2>
      <p className="card-message">{intervention.message}</p>
    </div>
  );
}
