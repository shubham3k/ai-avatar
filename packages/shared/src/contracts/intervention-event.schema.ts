import { z } from "zod";

export const interventionCreatedEventSchema = z.object({
  type: z.literal("intervention.created"),
  version: z.literal(1),
  interventionId: z.string(),
  userId: z.string(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  title: z.string(),
  message: z.string(),
  action: z.object({
    type: z.literal("OPEN_SOURCE"),
    sourceType: z.string(),
    sourceId: z.string(),
  }),
  createdAt: z.string().datetime(),
});

export type InterventionCreatedEvent = z.infer<
  typeof interventionCreatedEventSchema
>;
