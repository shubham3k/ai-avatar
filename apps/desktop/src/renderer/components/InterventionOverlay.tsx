import type { InterventionDto } from "@ai-agent/shared";
import { Character } from "./Character";
import { InterventionMessage } from "./InterventionMessage";
import { InterventionActions } from "./InterventionActions";
import { deriveInterventionActions, type InterventionActionSpec } from "../lib/intervention-actions";

export interface InterventionOverlayProps {
  intervention: InterventionDto;
  actionError: string | null;
  busy: boolean;
  onAction: (actionId: InterventionActionSpec["id"]) => void;
}

/**
 * Character on the right, message + action buttons on the left — the
 * assistant briefly appearing beside the user, not a modal. `key`d by
 * intervention.id from the caller so React remounts (and replays the
 * entrance animation) whenever the active intervention actually changes,
 * not on every unrelated re-render.
 *
 * There's no server-side "dismiss without action" — every intervention
 * resolves via Done or Remind me later (or Open, which doesn't resolve
 * it). A close/X button that only hid the card locally would have it
 * reappear on the next 15s inbox poll, which is worse than not having one,
 * so this deliberately doesn't add one.
 */
export function InterventionOverlay({
  intervention,
  actionError,
  busy,
  onAction,
}: InterventionOverlayProps) {
  const actions = deriveInterventionActions(intervention);

  return (
    <div className="intervention-overlay" data-testid="intervention-card">
      <div className="intervention-panel">
        <InterventionMessage intervention={intervention} />
        {actionError !== null && (
          <div className="card-error" role="alert">
            <span>{actionError}</span>
            <button type="button" className="button button-retry" onClick={() => onAction("done")}>
              Retry
            </button>
          </div>
        )}
        <InterventionActions actions={actions} busy={busy} onAction={onAction} />
      </div>
      <div className="intervention-character">
        <Character />
      </div>
    </div>
  );
}
