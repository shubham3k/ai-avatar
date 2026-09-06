import type { Intervention } from "@prisma/client";
import {
  createInterventionsRepository,
  type InterventionsRepository,
} from "../db/repositories/interventions.repository.js";
import { conflictError, notFoundError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export function createInterventionService(repositories?: {
  interventions?: InterventionsRepository;
}) {
  const repo = repositories?.interventions ?? createInterventionsRepository(prisma);

  function assertOwnership(
    intervention: Intervention | null,
    callerId: string,
    id: string,
  ): Intervention {
    if (!intervention || intervention.userId !== callerId) {
      throw notFoundError(`Intervention ${id} not found`);
    }
    return intervention;
  }

  return {
    async listInbox(callerId: string): Promise<Intervention[]> {
      return repo.listInbox(callerId, new Date());
    },

    async getById(callerId: string, id: string): Promise<Intervention> {
      const intervention = await repo.findById(id);
      return assertOwnership(intervention, callerId, id);
    },

    async done(callerId: string, id: string): Promise<Intervention> {
      const existing = assertOwnership(await repo.findById(id), callerId, id);
      if (existing.status === "resolved") {
        return existing;
      }
      if (existing.status === "dismissed") {
        throw conflictError("Intervention is dismissed and cannot be resolved");
      }
      return repo.resolve(id, new Date());
    },

    async snooze(
      callerId: string,
      id: string,
      minutes: number,
    ): Promise<Intervention> {
      const existing = assertOwnership(await repo.findById(id), callerId, id);
      if (existing.status === "resolved" || existing.status === "dismissed") {
        throw conflictError("Intervention is closed and cannot be snoozed");
      }
      const now = new Date();
      const snoozedUntil = new Date(now.getTime() + minutes * 60 * 1000);
      if (snoozedUntil.getTime() <= now.getTime()) {
        throw conflictError("Snooze time must be in the future");
      }
      return repo.snooze(id, snoozedUntil);
    },
  };
}

export type InterventionService = ReturnType<typeof createInterventionService>;
