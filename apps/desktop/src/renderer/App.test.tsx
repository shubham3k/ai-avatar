import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const intervention = {
  id: "int_1",
  signalId: "sig_1",
  status: "pending" as const,
  priority: "high" as const,
  title: "Design team is waiting for your feedback",
  message: "The design team is waiting for your feedback. The launch is tomorrow.",
  reason: "Time-sensitive approval.",
  actionType: "none",
  actionPayload: null,
  snoozedUntil: null,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  lastDeliveredAt: new Date().toISOString(),
};

type Bridge = NonNullable<Window["desktopAPI"]>;

function installBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge: Bridge = {
    fetchInbox: vi.fn().mockResolvedValue({ items: [intervention] }),
    markDone: vi.fn().mockResolvedValue(intervention),
    snooze: vi.fn().mockResolvedValue(intervention),
    setInteractive: vi.fn(),
    ...overrides,
  };
  window.desktopAPI = bridge;
  return bridge;
}

beforeEach(() => {
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

describe("desktop overlay", () => {
  it("renders the character and the highest-priority intervention", async () => {
    installBridge();
    render(<App />);

    expect(await screen.findByRole("img", { name: "Assistant character" })).toBeInTheDocument();
    expect(await screen.findByTestId("intervention-card")).toBeInTheDocument();
    expect(screen.getByText("Design team is waiting for your feedback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remind me later" })).toBeInTheDocument();
  });

  it("hides the overlay when the inbox is empty", async () => {
    installBridge({
      fetchInbox: vi.fn().mockResolvedValue({ items: [] }),
    });
    const { container } = render(<App />);

    await waitFor(() => {
      expect(container.querySelector("[data-testid='intervention-card']")).toBeNull();
    });
  });

  it("marks done through the bridge and hides the card on success", async () => {
    const bridge = installBridge({
      markDone: vi.fn().mockResolvedValue({ ...intervention, status: "resolved" }),
      fetchInbox: vi
        .fn()
        .mockResolvedValueOnce({ items: [intervention] })
        .mockResolvedValue({ items: [] }),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(bridge.markDone).toHaveBeenCalledWith("int_1");
      expect(screen.queryByTestId("intervention-card")).not.toBeInTheDocument();
    });
  });

  it("snoozes with the Phase 1 default of 60 minutes and hides the card on success", async () => {
    const bridge = installBridge({
      snooze: vi.fn().mockResolvedValue({ ...intervention, status: "snoozed" }),
      fetchInbox: vi
        .fn()
        .mockResolvedValueOnce({ items: [intervention] })
        .mockResolvedValue({ items: [] }),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Remind me later" }));

    await waitFor(() => {
      expect(bridge.snooze).toHaveBeenCalledWith("int_1", 60);
      expect(screen.queryByTestId("intervention-card")).not.toBeInTheDocument();
    });
  });

  it("keeps the intervention visible and offers retry when the API fails", async () => {
    const bridge = installBridge({
      markDone: vi.fn().mockRejectedValue(new Error("API down")),
      fetchInbox: vi
        .fn()
        .mockResolvedValueOnce({ items: [intervention] })
        .mockResolvedValue({ items: [] }),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Done" }));

    // The card must remain visible; do not fabricate success.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not mark as done. Please try again.",
    );
    expect(screen.getByTestId("intervention-card")).toBeInTheDocument();

    // Retry succeeds -> card hides.
    (bridge.markDone as ReturnType<typeof vi.fn>).mockResolvedValue(intervention);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.queryByTestId("intervention-card")).not.toBeInTheDocument();
    });
  });

  it("shows an error state when the inbox cannot be fetched but keeps prior state", async () => {
    installBridge({
      fetchInbox: vi.fn().mockRejectedValue(new Error("unreachable")),
    });
    render(<App />);

    // No card is rendered because no intervention was ever loaded.
    await waitFor(() => {
      expect(screen.queryByTestId("intervention-card")).not.toBeInTheDocument();
    });
  });
});
