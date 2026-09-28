/**
 * Deterministic thresholds for the upcoming-meeting Calendar signal.
 * Time-based only — no importance/attendee/AI reasoning.
 *
 * 10 minutes, not the original 30 (ADR-005): a 4pm meeting alerts at
 * 3:50, delivered on time by the desktop's 1-minute local delivery tick.
 * Every alert inside this window is therefore high priority.
 */

/** A meeting starting within this many minutes is actionable at all. */
export const ACTIONABLE_WINDOW_MINUTES = 10;

/** A meeting starting within this many minutes is high priority (else medium). */
export const HIGH_PRIORITY_WINDOW_MINUTES = 10;
