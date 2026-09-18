export type RelationshipType = "attendee_match" | "topic_overlap";
export type RelationshipStrength = "strong" | "possible";

export interface CrossSourceRelationship {
  type: RelationshipType;
  strength: RelationshipStrength;
  reason: string;
  /** Meaningful terms that overlapped, when relevant (topic_overlap, or bonus evidence on an attendee_match). */
  matchedTerms?: string[];
}

/** Minimal fields the builder needs from a stored Email — not the full row. */
export interface ContextEmailInput {
  id: string;
  fromEmail: string;
  subject: string | null;
  snippet: string | null;
  receivedAt: Date;
}

/** Minimal fields the builder needs from a stored CalendarEvent — not the full row. */
export interface ContextCalendarEventInput {
  id: string;
  summary: string | null;
  startAt: Date;
  attendeeEmails: string[];
}

export interface CrossSourceTemporalContext {
  emailReceivedAt: string;
  eventStartAt: string;
  /** Signed; positive means the event starts after the email was received. */
  hoursBetween: number;
}

export interface CrossSourceContext {
  emailId: string;
  calendarEventId: string;
  relationship: CrossSourceRelationship;
  temporalContext: CrossSourceTemporalContext;
}
