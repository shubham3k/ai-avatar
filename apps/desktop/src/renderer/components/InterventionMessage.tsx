import type { InterventionDto } from "@ai-agent/shared";

export interface InterventionMessageProps {
  intervention: InterventionDto;
}

interface MeetingBrief {
  attendees: string[];
  recentEmails: { from: string; subject: string; when: string }[];
  openItems: string[];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** ADR-006 M5: the pre-meeting brief the API attaches to a 10-minute meeting card, if any. */
export function readMeetingBrief(payload: InterventionDto["actionPayload"]): MeetingBrief | null {
  const raw = payload && typeof payload === "object" ? (payload as { brief?: unknown }).brief : null;
  if (!raw || typeof raw !== "object") return null;
  const brief = raw as Record<string, unknown>;
  const recentEmails = Array.isArray(brief.recentEmails)
    ? brief.recentEmails.filter(
        (item): item is MeetingBrief["recentEmails"][number] =>
          !!item &&
          typeof item === "object" &&
          typeof (item as { from?: unknown }).from === "string" &&
          typeof (item as { subject?: unknown }).subject === "string" &&
          typeof (item as { when?: unknown }).when === "string",
      )
    : [];
  const result = { attendees: stringList(brief.attendees), recentEmails, openItems: stringList(brief.openItems) };
  return result.attendees.length || result.recentEmails.length || result.openItems.length ? result : null;
}

export function InterventionMessage({ intervention }: InterventionMessageProps) {
  const brief = readMeetingBrief(intervention.actionPayload);
  return (
    <div className={`card intervention-message priority-${intervention.priority}`}>
      <div className="card-priority">
        {intervention.priority === "critical" ? "⚠ " : ""}
        {intervention.priority.toUpperCase()}
      </div>
      <h2 className="card-title">{intervention.title}</h2>
      <p className="card-message">{intervention.message}</p>
      {brief && (
        <div className="meeting-brief" data-testid="meeting-brief">
          {brief.attendees.length > 0 && (
            <div className="meeting-brief-row">
              <span className="meeting-brief-label">With</span> {brief.attendees.join(", ")}
            </div>
          )}
          {brief.recentEmails.length > 0 && (
            <div className="meeting-brief-row">
              <span className="meeting-brief-label">Recent email</span>
              <ul>
                {brief.recentEmails.map((email, index) => (
                  <li key={index}>
                    {email.from}: “{email.subject}” · {email.when}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {brief.openItems.length > 0 && (
            <div className="meeting-brief-row">
              <span className="meeting-brief-label">Open</span>
              <ul>
                {brief.openItems.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
