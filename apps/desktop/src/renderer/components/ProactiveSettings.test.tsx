import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterventionDto } from "@ai-agent/shared";
import { InterventionMessage, readMeetingBrief } from "./InterventionMessage";
import { ProactiveSettings } from "./ProactiveSettings";

const DEFAULTS = {
  briefingEnabled: true,
  briefingMode: "written",
  briefingWeekdaysOnly: false,
  wrapUpEnabled: true,
  wrapUpTime: "18:00",
  preMeetingBriefEnabled: true,
  followUpEnabled: true,
  followUpDays: 3,
  promiseRemindersEnabled: true,
  promiseRemindTime: "10:00",
  promiseSameDayLeadHours: 2,
  holdDuringFocus: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
};

afterEach(() => {
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

function installBridge(overrides: Record<string, unknown> = {}) {
  let stored = { ...DEFAULTS };
  const bridge = {
    proactiveGetSettings: vi.fn().mockResolvedValue({ ok: true, value: DEFAULTS }),
    proactiveUpdateSettings: vi.fn(async (patch: object) => {
      stored = { ...stored, ...patch };
      return { ok: true, value: stored };
    }),
    proactiveBriefingNow: vi.fn().mockResolvedValue({
      ok: true,
      value: { delivered: true, kind: "morning", conversationId: "c1", title: "Morning briefing", text: "Hi", mode: "written" },
    }),
    ...overrides,
  };
  window.desktopAPI = bridge as unknown as NonNullable<Window["desktopAPI"]>;
  return bridge;
}

describe("Settings → Proactive (ADR-006 M5)", () => {
  it("explains on a Mac that pop-ups can't be held for calls yet (ADR-007), and not on Windows", async () => {
    installBridge({ platform: "darwin" });
    const { unmount } = render(<ProactiveSettings />);
    expect(await screen.findByTestId("mac-focus-note")).toHaveTextContent("pop-ups always show");
    unmount();
    installBridge({ platform: "win32" });
    render(<ProactiveSettings />);
    await screen.findByText(/Hold pop-ups while I present/);
    expect(screen.queryByTestId("mac-focus-note")).toBeNull();
  });

  it("shows the defaults and saves each change straight away", async () => {
    const bridge = installBridge();
    render(<ProactiveSettings />);

    const followUp = await screen.findByLabelText("Follow-up after days");
    expect(followUp).toHaveValue(3);
    expect(screen.getByLabelText("Wrap-up time")).toHaveValue("18:00");
    expect(screen.getByRole("checkbox", { name: /Quiet hours/ })).not.toBeChecked();
    expect(screen.queryByLabelText("Quiet hours start")).toBeNull();

    fireEvent.change(followUp, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Quiet hours/ }));
    fireEvent.change(screen.getByLabelText("Briefing style"), { target: { value: "both" } });

    await waitFor(() => expect(bridge.proactiveUpdateSettings).toHaveBeenCalledTimes(3));
    expect(bridge.proactiveUpdateSettings.mock.calls.map((call) => call[0])).toEqual([
      { followUpDays: 5 },
      { quietHoursEnabled: true },
      { briefingMode: "both" },
    ]);
    expect(await screen.findByLabelText("Quiet hours start")).toHaveValue("22:00");
  });

  it("reverts and explains when a save is refused", async () => {
    installBridge({ proactiveUpdateSettings: vi.fn().mockResolvedValue({ ok: false, message: "Couldn't save that — check the times (HH:MM)." }) });
    render(<ProactiveSettings />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Wrap up my day/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("check the times");
    expect(screen.getByRole("checkbox", { name: /Wrap up my day/ })).toBeChecked();
  });

  it("'Show today's briefing now' hands the briefing to the app", async () => {
    const bridge = installBridge();
    const onShowBriefing = vi.fn();
    render(<ProactiveSettings onShowBriefing={onShowBriefing} />);
    fireEvent.click(await screen.findByRole("button", { name: /Show today's briefing now/ }));
    await waitFor(() => expect(onShowBriefing).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "c1" })));
    expect(bridge.proactiveBriefingNow).toHaveBeenCalledWith("morning");
  });
});

function meeting(actionPayload: InterventionDto["actionPayload"]): InterventionDto {
  return {
    id: "i1",
    signalId: "s1",
    status: "pending",
    priority: "medium",
    title: "Budget review",
    message: "Budget review starts in 10 minutes.",
    reason: "x",
    actionType: "open_source",
    actionPayload,
    snoozedUntil: null,
    createdAt: "2026-09-29T10:50:00.000Z",
    resolvedAt: null,
    lastDeliveredAt: null,
  };
}

describe("pre-meeting brief on the meeting card (M5)", () => {
  it("shows who's coming, recent emails and open items", () => {
    render(
      <InterventionMessage
        intervention={meeting({
          brief: {
            attendees: ["Rahul Sharma", "Priya"],
            recentEmails: [{ from: "Rahul Sharma", subject: "Q3 numbers", when: "yesterday" }],
            openItems: ["Send Rahul the deck"],
          },
        })}
      />,
    );
    const brief = screen.getByTestId("meeting-brief");
    expect(brief).toHaveTextContent("With Rahul Sharma, Priya");
    expect(brief).toHaveTextContent("Rahul Sharma: “Q3 numbers” · yesterday");
    expect(brief).toHaveTextContent("Send Rahul the deck");
  });

  it("ignores missing or malformed briefs", () => {
    expect(readMeetingBrief(null)).toBeNull();
    expect(readMeetingBrief({ brief: { attendees: [], recentEmails: [{ from: 1 }], openItems: "x" } })).toBeNull();
    render(<InterventionMessage intervention={meeting({ sourceUrl: "https://x" })} />);
    expect(screen.queryByTestId("meeting-brief")).toBeNull();
  });
});
