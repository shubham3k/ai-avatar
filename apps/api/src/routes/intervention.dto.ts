import type { Intervention } from "../db/repositories/interventions.repository.js";
import type { InterventionDto } from "@ai-agent/shared";

export function toInterventionDto(intervention: Intervention): InterventionDto {
  return {
    id: intervention.id,
    signalId: intervention.signalId,
    // Cast is safe: SQLite has no native enum (Phase 4.1), but every write
    // path only ever assigns one of these literal values.
    status: intervention.status as InterventionDto["status"],
    priority: intervention.priority as InterventionDto["priority"],
    title: intervention.title,
    message: intervention.message,
    reason: intervention.reason,
    actionType: intervention.actionType,
    actionPayload:
      (intervention.actionPayload as Record<string, unknown> | null) ?? null,
    snoozedUntil: intervention.snoozedUntil?.toISOString() ?? null,
    createdAt: intervention.createdAt.toISOString(),
    resolvedAt: intervention.resolvedAt?.toISOString() ?? null,
    lastDeliveredAt: intervention.lastDeliveredAt?.toISOString() ?? null,
  };
}
