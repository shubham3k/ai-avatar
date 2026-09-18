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

const secondIntervention = {
  ...intervention,
  id: "int_3",
  title: "Follow up with the vendor",
  message: "The vendor is waiting on a reply.",
};

const openSourceIntervention = {
  ...intervention,
  id: "int_2",
  title: "Acme proposal review",
  message: "Acme's proposal is needed before tomorrow's review.",
  actionType: "open_source",
  actionPayload: {
    sourceUrl: "https://calendar.google.com/event?eid=evt",
    availableActions: ["DONE", "REMIND_LATER"],
  },
};

type Bridge = NonNullable<Window["desktopAPI"]>;

/** Default bridge: fully set up (Groq key + Google connected), one pending intervention — the common case for most tests. */
function installBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge: Bridge = {
    fetchInbox: vi.fn().mockResolvedValue({ items: [intervention] }),
    markDone: vi.fn().mockResolvedValue(intervention),
    snooze: vi.fn().mockResolvedValue(intervention),
    setInteractive: vi.fn(),
    connectGoogle: vi.fn().mockResolvedValue(undefined),
    openSource: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue({
      groqKeyConfigured: true,
      googleOAuthConfigured: true,
      secureStorageAvailable: true,
      startupError: null,
    }),
    saveGroqKey: vi.fn().mockResolvedValue(undefined),
    saveGoogleCredentials: vi.fn().mockResolvedValue(undefined),
    googleStatus: vi.fn().mockResolvedValue({ connected: true, email: "demo@example.local" }),
    disconnectGoogle: vi.fn().mockResolvedValue({ connected: false, email: null }),
    checkNow: vi.fn().mockResolvedValue({ results: [] }),
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

  it("does not show an Open button when the intervention has no source URL", async () => {
    installBridge();
    render(<App />);

    await screen.findByTestId("intervention-card");
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });

  it("shows an Open button for an open_source intervention and opens it through the bridge", async () => {
    const bridge = installBridge({
      fetchInbox: vi.fn().mockResolvedValue({ items: [openSourceIntervention] }),
    });
    render(<App />);

    const openButton = await screen.findByRole("button", { name: "Open" });
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(bridge.openSource).toHaveBeenCalledWith(
        "https://calendar.google.com/event?eid=evt",
      );
    });
    // Opening the source does not resolve/dismiss the card — Done/Snooze still control that.
    expect(screen.getByTestId("intervention-card")).toBeInTheDocument();
  });

  it("shows an error and keeps the card visible when opening the source fails", async () => {
    installBridge({
      fetchInbox: vi.fn().mockResolvedValue({ items: [openSourceIntervention] }),
      openSource: vi.fn().mockRejectedValue(new Error("failed")),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not open the source. Please try again.",
    );
    expect(screen.getByTestId("intervention-card")).toBeInTheDocument();
  });

  it("shows the all-caught-up screen (with a Check now button) when the inbox is empty", async () => {
    installBridge({
      fetchInbox: vi.fn().mockResolvedValue({ items: [] }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId("intervention-card")).toBeNull();
    });
    expect(screen.getByText("All caught up")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Check now" }).length).toBeGreaterThan(0);
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

  it("opens and closes the Settings panel via the toggle button (Phase 4.3)", async () => {
    installBridge();
    render(<App />);
    await screen.findByTestId("intervention-card");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByTestId("settings-card")).toBeInTheDocument();
    // The normal overlay content is replaced while Settings is open.
    expect(screen.queryByTestId("intervention-card")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByTestId("settings-card")).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId("intervention-card")).toBeInTheDocument();
  });

  it("shows a startup error screen instead of the normal overlay when the embedded API failed to start (Phase 4.3)", async () => {
    installBridge({
      getSettings: vi.fn().mockResolvedValue({
        groqKeyConfigured: false,
        secureStorageAvailable: true,
        startupError: "ENCRYPTION_KEY is not configured",
      }),
    });
    render(<App />);

    expect(await screen.findByTestId("startup-error-card")).toHaveTextContent(
      "ENCRYPTION_KEY is not configured",
    );
    expect(screen.queryByTestId("intervention-card")).not.toBeInTheDocument();
  });

  it("Settings panel shows whether the Groq key is configured and Google's connection status", async () => {
    installBridge();
    render(<App />);
    await screen.findByTestId("intervention-card");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const card = await screen.findByTestId("settings-card");
    expect(card).toHaveTextContent("Configured");
    expect(card).toHaveTextContent("Connected as demo@example.local");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("disables Sign in with Google until Google OAuth credentials are configured (Phase 4.7)", async () => {
    installBridge({
      getSettings: vi.fn().mockResolvedValue({
        groqKeyConfigured: true,
        googleOAuthConfigured: false,
        secureStorageAvailable: true,
        startupError: null,
      }),
      googleStatus: vi.fn().mockResolvedValue({ connected: false, email: null }),
    });
    render(<App />);
    // Not fully configured (no Google OAuth credentials) -> get-started screen.
    const card = await screen.findByTestId("settings-card");

    expect(card).toHaveTextContent(/paste in your own Google Cloud OAuth client/i);
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeDisabled();
  });

  it("saves Google OAuth credentials through the bridge when Save is clicked", async () => {
    const bridge = installBridge({
      getSettings: vi.fn().mockResolvedValue({
        groqKeyConfigured: true,
        googleOAuthConfigured: false,
        secureStorageAvailable: true,
        startupError: null,
      }),
      googleStatus: vi.fn().mockResolvedValue({ connected: false, email: null }),
    });
    render(<App />);
    await screen.findByTestId("settings-card");

    fireEvent.change(screen.getByPlaceholderText("Client ID"), {
      target: { value: "abc123.apps.googleusercontent.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Client Secret"), {
      target: { value: "shh-its-a-secret" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Save/ }).find((b) => !b.hasAttribute("disabled"))!);

    await waitFor(() => {
      expect(bridge.saveGoogleCredentials).toHaveBeenCalledWith(
        "abc123.apps.googleusercontent.com",
        "shh-its-a-secret",
      );
    });
  });

  it("warns when secure storage is unavailable (Phase 4.4)", async () => {
    installBridge({
      getSettings: vi.fn().mockResolvedValue({
        groqKeyConfigured: true,
        secureStorageAvailable: false,
        startupError: null,
      }),
    });
    render(<App />);
    await screen.findByTestId("intervention-card");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const card = await screen.findByTestId("settings-card");
    expect(card).toHaveTextContent(/plain text/i);
  });

  it("saves a new Groq key through the bridge when Save is clicked", async () => {
    const bridge = installBridge();
    render(<App />);
    await screen.findByTestId("intervention-card");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByTestId("settings-card");

    const groqInput = screen.getByPlaceholderText("gsk_...");
    fireEvent.change(groqInput, { target: { value: "gsk_new_key" } });
    // Both the Groq and Google-credentials sections have their own "Save"
    // button now — scope to the one enabled by typing into the Groq input.
    fireEvent.click(screen.getAllByRole("button", { name: /Save/ }).find((b) => !b.hasAttribute("disabled"))!);

    await waitFor(() => {
      expect(bridge.saveGroqKey).toHaveBeenCalledWith("gsk_new_key");
    });
  });

  describe("window interactivity (Phase 4.7)", () => {
    it("makes the window clickable even with no intervention to show — the get-started screen's buttons need clicks too", async () => {
      // Regression test: setInteractive used to be tied to `intervention
      // !== null`, so the overlay stayed click-through (see
      // overlay-window.ts) — clicks passing straight through to the
      // desktop behind it — on every screen except one with an active
      // intervention card. That included the get-started screen: its Groq
      // key input, Save, and "Sign in with Google" buttons rendered but
      // were entirely unclickable, silently, with no error. Only caught
      // by the user's own real click.
      const bridge = installBridge({
        fetchInbox: vi.fn().mockResolvedValue({ items: [] }),
        googleStatus: vi.fn().mockResolvedValue({ connected: false, email: null }),
      });
      render(<App />);

      await screen.findByTestId("settings-card");
      await waitFor(() => {
        expect(bridge.setInteractive).toHaveBeenCalledWith(true);
      });
    });

    it("makes the window clickable on the all-caught-up screen too", async () => {
      const bridge = installBridge({
        fetchInbox: vi.fn().mockResolvedValue({ items: [] }),
      });
      render(<App />);

      await screen.findByText("All caught up");
      await waitFor(() => {
        expect(bridge.setInteractive).toHaveBeenCalledWith(true);
      });
    });
  });

  describe("first-run setup (Phase 4.7)", () => {
    it("shows the get-started screen instead of the normal overlay when the Groq key isn't configured yet", async () => {
      installBridge({
        getSettings: vi.fn().mockResolvedValue({
          groqKeyConfigured: false,
          secureStorageAvailable: true,
          startupError: null,
        }),
      });
      render(<App />);

      const card = await screen.findByTestId("settings-card");
      expect(card).toHaveTextContent("Get started");
      // No Close button — there's nothing configured to go "back" to yet.
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("intervention-card")).not.toBeInTheDocument();
    });

    it("shows the get-started screen when Google isn't connected yet, even with a Groq key configured", async () => {
      installBridge({
        googleStatus: vi.fn().mockResolvedValue({ connected: false, email: null }),
      });
      render(<App />);

      const card = await screen.findByTestId("settings-card");
      expect(card).toHaveTextContent("Get started");
      expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    });
  });

  describe("Check now (Phase 4.7)", () => {
    it("calls the bridge and shows the resulting intervention once setup is complete but nothing has been found yet", async () => {
      const bridge = installBridge({
        fetchInbox: vi
          .fn()
          .mockResolvedValueOnce({ items: [] })
          .mockResolvedValue({ items: [intervention] }),
      });
      render(<App />);

      await screen.findByText("All caught up");
      fireEvent.click(screen.getAllByRole("button", { name: "Check now" })[0]);

      await waitFor(() => {
        expect(bridge.checkNow).toHaveBeenCalled();
      });
      expect(await screen.findByTestId("intervention-card")).toBeInTheDocument();
    });

    it("shows an error and stays on the all-caught-up screen if checking fails", async () => {
      installBridge({
        fetchInbox: vi.fn().mockResolvedValue({ items: [] }),
        checkNow: vi.fn().mockRejectedValue(new Error("Groq call failed")),
      });
      render(<App />);

      await screen.findByText("All caught up");
      fireEvent.click(screen.getAllByRole("button", { name: "Check now" })[0]);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not check for updates. Please try again.",
      );
    });
  });

  describe("multiple pending interventions (Phase 4.7)", () => {
    it("shows one at a time with next/previous controls and a counter", async () => {
      installBridge({
        fetchInbox: vi.fn().mockResolvedValue({ items: [intervention, secondIntervention] }),
      });
      render(<App />);

      await screen.findByTestId("intervention-card");
      expect(screen.getByText("Design team is waiting for your feedback")).toBeInTheDocument();
      expect(screen.getByText("1 of 2")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("Follow up with the vendor")).toBeInTheDocument();
      expect(screen.getByText("2 of 2")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Previous" }));
      expect(screen.getByText("Design team is waiting for your feedback")).toBeInTheDocument();
    });

    it("does not show navigation controls when there is only one pending intervention", async () => {
      installBridge();
      render(<App />);

      await screen.findByTestId("intervention-card");
      expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    });
  });
});
