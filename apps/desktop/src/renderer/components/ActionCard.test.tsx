import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionCard, toLocalInput } from "./ActionCard";
import { useActionCards, type ActionCardData } from "../state/use-action-cards";
import { renderHook } from "@testing-library/react";

const email: ActionCardData = {
  id: "a1",
  kind: "email_send",
  status: "pending",
  payload: { to: ["new.person@corp.com"], cc: [], subject: "Intro", body: "Hi! Sharing the deck.", replyTo: null },
  before: null,
  newRecipients: ["new.person@corp.com"],
  notifies: ["new.person@corp.com"],
  executeAt: null,
  error: null,
  createdAt: "2026-09-30T10:00:00.000Z",
  voiceApprovable: false,
};

function renderCard(card: ActionCardData, now = Date.parse("2026-09-30T10:00:00.000Z")) {
  const onApprove = vi.fn().mockResolvedValue(null);
  const onCancel = vi.fn().mockResolvedValue(null);
  const onDismiss = vi.fn();
  render(<ActionCard card={card} now={now} onApprove={onApprove} onCancel={onCancel} onDismiss={onDismiss} />);
  return { onApprove, onCancel, onDismiss };
}

afterEach(() => {
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

describe("approval card (ADR-006 M7)", () => {
  it("shows exactly what will be sent, warns about a first-time recipient, and approves on click", async () => {
    const { onApprove } = renderCard(email);
    const card = screen.getByTestId("action-card");
    expect(card).toHaveTextContent("To: new.person@corp.com");
    expect(card).toHaveTextContent("Subject: Intro");
    expect(card).toHaveTextContent("Hi! Sharing the deck.");
    expect(screen.getByRole("note")).toHaveTextContent("First time emailing new.person@corp.com");
    fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith("a1"));
  });

  it("edits the draft and approves the edited version", async () => {
    const { onApprove } = renderCard(email);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Email text"), { target: { value: "Hello! Deck attached." } });
    fireEvent.change(screen.getByLabelText("Cc"), { target: { value: "rahul@acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & send" }));
    await waitFor(() =>
      expect(onApprove).toHaveBeenCalledWith("a1", expect.objectContaining({ body: "Hello! Deck attached.", cc: ["rahul@acme.com"], to: ["new.person@corp.com"] })),
    );
  });

  it("counts down the 30 s window with Undo", () => {
    const { onCancel } = renderCard({ ...email, status: "sending", executeAt: "2026-09-30T10:00:30.000Z" }, Date.parse("2026-09-30T10:00:07.000Z"));
    expect(screen.getByText("sending in 23 s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onCancel).toHaveBeenCalledWith("a1");
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  it("calendar change: before → after, and who gets notified", () => {
    renderCard({
      ...email,
      id: "c1",
      kind: "calendar_update",
      payload: { eventId: "e", providerEventId: "g", calendarId: "primary", start: "2026-10-01T05:00:00.000Z", end: "2026-10-01T05:30:00.000Z" },
      before: { title: "Standup", start: "2026-10-01T04:00:00.000Z", end: "2026-10-01T04:30:00.000Z", location: null, attendees: ["rahul@acme.com"] },
      newRecipients: [],
      notifies: ["rahul@acme.com"],
    });
    const card = screen.getByTestId("action-card");
    expect(card).toHaveTextContent("Standup");
    expect(card).toHaveTextContent("Before:");
    expect(card).toHaveTextContent("After:");
    expect(card).toHaveTextContent("rahul@acme.com will get an email from Google about this.");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("own-only events say nobody is notified; finished cards can be dismissed", () => {
    const { onDismiss } = renderCard({
      ...email,
      id: "c2",
      kind: "calendar_create",
      status: "done",
      payload: { title: "Focus time", start: "2026-10-01T09:00:00.000Z", end: "2026-10-01T10:00:00.000Z", attendees: [] },
      newRecipients: [],
      notifies: [],
    });
    expect(screen.getByText("done ✓")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("c2");
  });

  it("converts ISO times for the datetime inputs", () => {
    const local = toLocalInput("2026-10-01T09:00:00.000Z");
    expect(new Date(local).toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });
});

describe("useActionCards", () => {
  it("loads cards, adds ones streamed in, and applies approve results", async () => {
    const bridge = {
      actionsList: vi.fn().mockResolvedValue({ ok: true, value: { actions: [email] } }),
      actionsApprove: vi.fn().mockResolvedValue({ ok: true, value: { ...email, status: "sending", executeAt: "2026-09-30T10:00:30.000Z" } }),
      actionsCancel: vi.fn(),
    };
    window.desktopAPI = bridge as unknown as NonNullable<Window["desktopAPI"]>;
    const { result } = renderHook(() => useActionCards());
    await waitFor(() => expect(result.current.cards).toHaveLength(1));

    act(() => result.current.upsert({ ...email, id: "a2", createdAt: "2026-09-30T10:01:00.000Z" }));
    expect(result.current.cards.map((card) => card.id)).toEqual(["a1", "a2"]);

    await act(async () => {
      expect(await result.current.approve("a1")).toBeNull();
    });
    expect(result.current.cards[0]!.status).toBe("sending");

    act(() => result.current.dismiss("a2"));
    act(() => result.current.upsert({ ...email, id: "a2" }));
    expect(result.current.cards.map((card) => card.id)).toEqual(["a1"]);
  });
});
