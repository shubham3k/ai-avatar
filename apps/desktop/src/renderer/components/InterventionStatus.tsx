export interface InterventionStatusProps {
  message: string | null;
}

/**
 * A brief, self-clearing confirmation toast shown after an action succeeds
 * (see App.tsx's flashStatus). Rendered independently of the intervention
 * card/list so it still appears even when the action just emptied the
 * inbox and the surrounding screen switches to "All caught up".
 */
export function InterventionStatus({ message }: InterventionStatusProps) {
  if (!message) return null;
  return (
    <div className="intervention-status" role="status">
      {message}
    </div>
  );
}
