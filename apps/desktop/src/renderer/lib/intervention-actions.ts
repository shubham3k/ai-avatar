import type { InterventionDto } from "@ai-agent/shared";

export type InterventionActionVariant = "primary" | "secondary" | "outline";

export interface InterventionActionSpec {
  id: "open" | "done" | "remind";
  label: string;
  variant: InterventionActionVariant;
}

export function sourceUrlOf(intervention: InterventionDto): string | null {
  if (intervention.actionType !== "open_source") return null;
  const payload = intervention.actionPayload;
  if (!payload || typeof payload !== "object") return null;
  const url = (payload as Record<string, unknown>).sourceUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/**
 * Derives the intervention's action buttons from its data (actionType/
 * actionPayload) rather than hardcoding a fixed button set in the UI — the
 * "Open" action only appears when the stored data actually has a source
 * URL to open. Every intervention gets Done + Remind me later; there is no
 * server-side concept of a third, non-destructive "dismiss" (see
 * InterventionOverlay's comment), so one isn't fabricated here.
 */
export function deriveInterventionActions(intervention: InterventionDto): InterventionActionSpec[] {
  const actions: InterventionActionSpec[] = [];
  if (sourceUrlOf(intervention) !== null) {
    actions.push({ id: "open", label: "Open", variant: "outline" });
  }
  actions.push({ id: "done", label: "Done", variant: "primary" });
  actions.push({ id: "remind", label: "Remind me later", variant: "secondary" });
  return actions;
}
