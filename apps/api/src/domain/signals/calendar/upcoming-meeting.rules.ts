/**
 * Deterministic thresholds for the upcoming-meeting Calendar signal.
 * Time-based only — no importance/attendee/AI reasoning.
 */

/** A meeting starting within this many minutes is actionable at all. */
export const ACTIONABLE_WINDOW_MINUTES = 30;

/** A meeting starting within this many minutes is high priority (else medium). */
export const HIGH_PRIORITY_WINDOW_MINUTES = 10;
