import type { RelationshipStrength, RelationshipType } from "./cross-source-context.types.js";

/** Minimal fields the evaluator needs from a stored Signal — not the full row. */
export interface SituationSignalInput {
  id: string;
  sourceType: string;
  sourceId: string;
  dueAt: Date | null;
  createdAt: Date;
  /** Raw Signal.importanceHints; confidence ("high"/"medium") is read from it when present. */
  importanceHints: unknown;
}

export interface ConsolidatedSituationRelationship {
  type: RelationshipType;
  strength: RelationshipStrength;
}

export interface ConsolidatedSituation {
  id: string;
  signalIds: string[];
  primarySignalId: string;
  emailIds: string[];
  calendarEventIds: string[];
  relationship: ConsolidatedSituationRelationship;
}
