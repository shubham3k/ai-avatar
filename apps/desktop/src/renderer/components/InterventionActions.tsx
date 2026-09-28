import type { InterventionActionSpec } from "../lib/intervention-actions";

const VARIANT_CLASS: Record<InterventionActionSpec["variant"], string> = {
  primary: "button-done",
  secondary: "button-snooze",
  outline: "button-open",
};

export interface InterventionActionsProps {
  actions: InterventionActionSpec[];
  busy: boolean;
  onAction: (actionId: InterventionActionSpec["id"]) => void;
}

export function InterventionActions({ actions, busy, onAction }: InterventionActionsProps) {
  return (
    <div className="intervention-actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`button ${VARIANT_CLASS[action.variant]}`}
          onClick={() => onAction(action.id)}
          disabled={busy}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
