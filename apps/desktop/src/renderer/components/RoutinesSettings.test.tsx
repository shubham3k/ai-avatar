import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutinesSettings } from "./RoutinesSettings";
import { deriveInterventionActions } from "../lib/intervention-actions";

const ROUTINE = {
  id: "r1",
  title: "Unanswered emails summary",
  instruction: "Summarize the emails from the last week I haven't replied to.",
  scheduleText: "Every Monday at 9:00 AM",
  takesAction: false,
  enabled: true,
  nextRunAt: "2026-10-05T03:30:00.000Z",
  lastRunAt: null,
  lastStatus: null,
};

afterEach(() => {
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

function installBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    routinesList: vi.fn().mockResolvedValue({ ok: true, value: { routines: [ROUTINE, { ...ROUTINE, id: "r2", title: "Follow-ups", takesAction: true }] } }),
    routinesCreate: vi.fn().mockResolvedValue({ ok: true, value: ROUTINE }),
    routinesUpdate: vi.fn().mockResolvedValue({ ok: true, value: ROUTINE }),
    routinesDelete: vi.fn().mockResolvedValue({ ok: true, value: { deleted: 1 } }),
    routinesRun: vi.fn().mockResolvedValue({ ok: true, value: { started: true } }),
    ...overrides,
  };
  window.desktopAPI = bridge as unknown as NonNullable<Window["desktopAPI"]>;
  return bridge;
}

describe("Settings → Routines (ADR-006 M9)", () => {
  it("creates a routine from plain words and lists routines with their schedule", async () => {
    const bridge = installBridge();
    render(<RoutinesSettings />);
    const rows = await screen.findAllByTestId("routine-row");
    expect(rows[0]).toHaveTextContent("Every Monday at 9:00 AM");
    expect(within(rows[1]!).getByText("asks every run")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New routine"), { target: { value: "every Monday at 9, summarize unanswered emails" } });
    fireEvent.click(screen.getByRole("button", { name: "Create routine" }));
    await waitFor(() => expect(bridge.routinesCreate).toHaveBeenCalledWith("every Monday at 9, summarize unanswered emails"));
    expect(await screen.findByRole("status")).toHaveTextContent("Routine created.");
  });

  it("pauses, runs now, reschedules in words, and deletes", async () => {
    const bridge = installBridge();
    render(<RoutinesSettings />);
    const [row] = await screen.findAllByTestId("routine-row");
    fireEvent.click(within(row!).getByRole("checkbox", { name: "Unanswered emails summary on" }));
    await waitFor(() => expect(bridge.routinesUpdate).toHaveBeenCalledWith("r1", { enabled: false }));

    fireEvent.click(within(row!).getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(bridge.routinesRun).toHaveBeenCalledWith("r1"));

    fireEvent.click(within(row!).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "every Friday at 5pm" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bridge.routinesUpdate).toHaveBeenLastCalledWith("r1", { when: "every Friday at 5pm" }));

    fireEvent.click(within((await screen.findAllByTestId("routine-row"))[0]!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(bridge.routinesDelete).toHaveBeenCalledWith("r1"));
  });
});

describe("routine result cards (M9)", () => {
  it("offer 'Read it' to open the report", () => {
    const actions = deriveInterventionActions({
      id: "i",
      signalId: "s",
      status: "pending",
      priority: "medium",
      title: "Unanswered emails summary — ready",
      message: "3 emails…",
      reason: "Routine",
      actionType: "open_chat",
      actionPayload: { conversationId: "c1" },
      snoozedUntil: null,
      createdAt: "2026-10-05T03:31:00.000Z",
      resolvedAt: null,
      lastDeliveredAt: null,
    });
    expect(actions.map((action) => action.label)).toEqual(["Read it", "Done", "Remind me later"]);
  });
});
