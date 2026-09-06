import type { Intervention } from "@prisma/client";
import type { InterventionDto } from "@ai-agent/shared";

export function toInterventionDto(intervention: Intervention): InterventionDto {
  return {
    id: intervention.id,
    signalId: intervention.signalId,
    status: intervention.status,
    priority: intervention.priority,
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
