import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    createReminder: vi.fn().mockResolvedValue({ id: "reminder_1" }),
    createReminderFromText: vi.fn().mockResolvedValue({
      ok: true,
      reminder: {
        id: "reminder_1",
        text: "Drink water",
        dueAt: "2026-09-24T16:00:00.000Z",
        remindAt: "2026-09-24T15:50:00.000Z",
      },
    }),
    createReminderFromVoice: vi.fn().mockResolvedValue({
      ok: true,
      reminder: {
        id: "reminder_1",
        text: "Drink water",
        dueAt: "2026-09-24T16:00:00.000Z",
        remindAt: "2026-09-24T15:50:00.000Z",
      },
    }),
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

  it("shows no visible card when the inbox is empty — just the small Check now link", async () => {
    installBridge({
      fetchInbox: vi.fn().mockResolvedValue({ items: [] }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.queryByTestId("intervention-card")).toBeNull();
    });
    // The idle state deliberately has no persistent box sitting on the
    // desktop — see App.tsx's "interventions.length === 0" branch.
    expect(screen.queryByText("All caught up")).not.toBeInTheDocument();
    // Settings and Check now live together in the single dock pill.
    const dock = screen.getByTestId("dock");
    expect(within(dock).getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "Check now" })).toBeInTheDocument();
  });

  it("shows a newly due reminder as soon as the background scheduler pushes inbox:changed", async () => {
    let pushInboxChanged: () => void = () => {};
    const fetchInbox = vi.fn().mockResolvedValue({ items: [] });
    installBridge({
      fetchInbox,
      onInboxChanged: vi.fn((callback: () => void) => {
        pushInboxChanged = callback;
        return () => {};
      }),
    });
    render(<App />);
    await waitFor(() => expect(fetchInbox).toHaveBeenCalled());
    expect(screen.queryByTestId("intervention-card")).toBeNull();

    // The reminder becomes due; the scheduler's delivery check creates it and pushes.
    fetchInbox.mockResolvedValue({
      items: [{ ...intervention, title: "take a break", message: "take a break" }],
    });
    pushInboxChanged();

    expect(await screen.findByText("take a break", { selector: "*:not(p)" })).toBeInTheDocument();
  });

  it("keeps the dock visible below an intervention card", async () => {
    installBridge();
    render(<App />);

    await screen.findByTestId("intervention-card");
    const dock = screen.getByTestId("dock");
    expect(within(dock).getByRole("button", { name: "Check now" })).toBeInTheDocument();
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

  describe("chat with Zara (ADR-006 M2)", () => {
    /** chatSend double: plays the given events, then resolves like the real IPC call. */
    function chatSendPlaying(events: unknown[], result: unknown = { ok: true, value: null }) {
      return vi.fn(async (_conversationId: string | null, _text: string, onEvent: (e: unknown) => void) => {
        for (const event of events) onEvent(event);
        return result;
      });
    }

    async function openChat() {
      render(<App />);
      await screen.findByTestId("intervention-card");
      fireEvent.click(within(screen.getByTestId("dock")).getByRole("button", { name: "Chat with Zara" }));
      return screen.getByRole("textbox", { name: "Message Zara" });
    }

    it("sends a message and shows Zara's streamed reply, tool status included", async () => {
      const chatSend = chatSendPlaying([
        { type: "conversation", id: "conv_1", title: "what's on today?" },
        { type: "status", text: "Checking your calendar…" },
        { type: "delta", text: "You have " },
        { type: "delta", text: "a team sync at 4 PM." },
        {
          type: "done",
          message: { id: "m2", role: "assistant", content: "You have a team sync at 4 PM.", provider: "openai" },
        },
      ]);
      installBridge({ chatSend });
      const input = await openChat();

      fireEvent.change(input, { target: { value: "what's on today?" } });
      fireEvent.keyDown(input, { key: "Enter" });

      const messages = screen.getByTestId("chat-messages");
      expect(await within(messages).findByText("You have a team sync at 4 PM.")).toBeInTheDocument();
      expect(within(messages).getByText("what's on today?")).toBeInTheDocument();
      expect(chatSend).toHaveBeenCalledWith(null, "what's on today?", expect.any(Function));
      expect(input).toHaveValue("");
    });

    it("continues the same conversation on the next message", async () => {
      const chatSend = chatSendPlaying([
        { type: "conversation", id: "conv_1", title: "hi" },
        { type: "done", message: { id: "m2", role: "assistant", content: "Hello!", provider: "openai" } },
      ]);
      installBridge({ chatSend });
      const input = await openChat();

      fireEvent.change(input, { target: { value: "hi" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await screen.findByText("Hello!");
      fireEvent.change(input, { target: { value: "and tomorrow?" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(chatSend).toHaveBeenLastCalledWith("conv_1", "and tomorrow?", expect.any(Function)));
    });

    it("labels a reply from the Groq backup", async () => {
      installBridge({
        chatSend: chatSendPlaying([
          { type: "done", message: { id: "m2", role: "assistant", content: "Backup reply", provider: "groq" } },
        ]),
      });
      const input = await openChat();
      fireEvent.change(input, { target: { value: "hi" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(await screen.findByText("answered by backup (Groq)")).toBeInTheDocument();
    });

    it("shows Zara's friendly error (e.g. a rejected key)", async () => {
      installBridge({
        chatSend: chatSendPlaying([
          { type: "error", message: "Your OpenAI API key was rejected. Update it in Settings." },
        ]),
      });
      const input = await openChat();
      fireEvent.change(input, { target: { value: "hi" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(await screen.findByRole("alert")).toHaveTextContent("Your OpenAI API key was rejected.");
    });

    it("New chat clears the conversation; history reopens an old one", async () => {
      const chatMessages = vi.fn().mockResolvedValue({
        messages: [
          { id: "a", role: "user", content: "old question" },
          { id: "b", role: "assistant", content: "old answer", provider: "openai" },
        ],
      });
      installBridge({
        chatSend: chatSendPlaying([
          { type: "conversation", id: "conv_1", title: "hi" },
          { type: "done", message: { id: "m2", role: "assistant", content: "Hello!", provider: "openai" } },
        ]),
        chatList: vi.fn().mockResolvedValue({
          conversations: [{ id: "conv_old", title: "Plan my Monday", updatedAt: new Date().toISOString() }],
        }),
        chatMessages,
      });
      const input = await openChat();
      fireEvent.change(input, { target: { value: "hi" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await screen.findByText("Hello!");

      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
      expect(screen.queryByText("Hello!")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Chat history" }));
      fireEvent.click(await screen.findByText("Plan my Monday"));

      expect(await screen.findByText("old answer")).toBeInTheDocument();
      expect(chatMessages).toHaveBeenCalledWith("conv_old");
    });

    it("closes with Escape or the chat button", async () => {
      installBridge();
      const input = await openChat();

      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByTestId("chat-panel")).toBeNull();

      const chatButton = within(screen.getByTestId("dock")).getByRole("button", { name: "Chat with Zara" });
      fireEvent.click(chatButton);
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
      fireEvent.click(chatButton);
      expect(screen.queryByTestId("chat-panel")).toBeNull();
    });

    it("the dock's mic opens the chat and explains a microphone problem (jsdom has no mediaDevices, same as a real permission denial)", async () => {
      installBridge();
      render(<App />);
      await screen.findByTestId("intervention-card");

      fireEvent.click(within(screen.getByTestId("dock")).getByRole("button", { name: "Talk to Zara" }));

      expect(await screen.findByTestId("chat-panel")).toBeInTheDocument();
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not access the microphone");
    });

    it("no longer puts a reminder box inside Settings", async () => {
      installBridge();
      render(<App />);
      await screen.findByTestId("intervention-card");
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      const card = await screen.findByTestId("settings-card");

      expect(within(card).queryByText("Add a reminder")).toBeNull();
      expect(within(card).queryByRole("textbox", { name: "What should I remind you about, and when?" })).toBeNull();
    });
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

    it("makes the window clickable on the empty/idle screen too", async () => {
      const bridge = installBridge({
        fetchInbox: vi.fn().mockResolvedValue({ items: [] }),
      });
      render(<App />);

      await screen.findByRole("button", { name: "Check now" });
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

      await screen.findByRole("button", { name: "Check now" });
      fireEvent.click(screen.getByRole("button", { name: "Check now" }));

      await waitFor(() => {
        expect(bridge.checkNow).toHaveBeenCalled();
      });
      expect(await screen.findByTestId("intervention-card")).toBeInTheDocument();
    });

    it("shows an error and stays on the empty/idle screen if checking fails", async () => {
      installBridge({
        fetchInbox: vi.fn().mockResolvedValue({ items: [] }),
        checkNow: vi.fn().mockRejectedValue(new Error("Groq call failed")),
      });
      render(<App />);

      await screen.findByRole("button", { name: "Check now" });
      fireEvent.click(screen.getByRole("button", { name: "Check now" }));

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

  describe("Google auth expiry and last-checked indicator", () => {
    it("badges the settings gear icon when Google's authorization has expired, without leaving the current screen", async () => {
      installBridge({
        getSettings: vi.fn().mockResolvedValue({
          groqKeyConfigured: true,
          googleOAuthConfigured: true,
          secureStorageAvailable: true,
          startupError: null,
          googleAuthError: true,
        }),
      });
      render(<App />);

      // Still on the normal intervention view — an auth error doesn't force
      // the user out of what they're looking at (see App.tsx's comment).
      await screen.findByTestId("intervention-card");
      expect(screen.getByRole("button", { name: "Settings" })).toHaveClass(
        "settings-toggle-warning",
      );
    });

    it("does not badge the settings gear icon under normal conditions", async () => {
      installBridge();
      render(<App />);

      await screen.findByTestId("intervention-card");
      expect(screen.getByRole("button", { name: "Settings" })).not.toHaveClass(
        "settings-toggle-warning",
      );
    });

    it("shows a relative last-checked time once one is available", async () => {
      const fixedNow = new Date("2026-09-22T12:05:00.000Z").getTime();
      vi.spyOn(Date, "now").mockReturnValue(fixedNow);
      installBridge({
        getSettings: vi.fn().mockResolvedValue({
          groqKeyConfigured: true,
          googleOAuthConfigured: true,
          secureStorageAvailable: true,
          startupError: null,
          lastCheckedAt: fixedNow - 3 * 60_000,
        }),
      });
      render(<App />);

      // Compact in the dock ("3m ago"), full wording on hover.
      expect(await screen.findByTitle("Last checked 3m ago")).toHaveTextContent("3m ago");
      vi.restoreAllMocks();
    });

    it("shows nothing for last-checked before any check has happened", async () => {
      installBridge();
      render(<App />);

      await screen.findByTestId("intervention-card");
      expect(screen.queryByTitle(/Last checked/)).not.toBeInTheDocument();
    });

    it("Settings shows a reconnect prompt and button when Google auth has expired, even though the stored connection still looks 'connected'", async () => {
      installBridge({
        getSettings: vi.fn().mockResolvedValue({
          groqKeyConfigured: true,
          googleOAuthConfigured: true,
          secureStorageAvailable: true,
          startupError: null,
          googleAuthError: true,
        }),
        googleStatus: vi.fn().mockResolvedValue({ connected: true, email: "demo@example.local" }),
      });
      render(<App />);
      await screen.findByTestId("intervention-card");
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));

      const card = await screen.findByTestId("settings-card");
      expect(card).toHaveTextContent(/expired or was revoked/i);
      expect(screen.getByRole("button", { name: "Reconnect Google" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    });
  });
});
