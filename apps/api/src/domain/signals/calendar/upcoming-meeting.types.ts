export type MeetingConfidence = "high" | "medium";

export interface UpcomingMeetingAttendee {
  email: string | null;
  displayName: string | null;
  responseStatus: string | null;
}

export interface UpcomingMeetingInput {
  title: string | null;
  startAt: Date | null;
  endAt: Date | null;
  isAllDay: boolean;
  status: string | null;
  organizerEmail: string | null;
  organizerName: string | null;
  attendees: UpcomingMeetingAttendee[];
}

export interface UpcomingMeetingResult {
  actionable: boolean;
  confidence: MeetingConfidence | null;
  reason: string;
  /** Rounded minutes until start, or null when not actionable. */
  minutesUntilStart: number | null;
}
