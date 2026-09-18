/** Bounded windows for the daily assistant context (Phase 3.1). */

/** Calendar events further out than this are not part of "today". */
export const UPCOMING_EVENTS_WINDOW_HOURS = 24;

/** Emails older than this are not "relevant recent" email for daily context. */
export const RECENT_EMAILS_WINDOW_HOURS = 24;

/** Bounded fetch size before the time-window filter narrows it further — mirrors CONTEXT_FETCH_LIMIT. */
export const DAILY_CONTEXT_FETCH_LIMIT = 25;
