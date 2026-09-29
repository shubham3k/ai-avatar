import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivitySettings } from "./ActivitySettings";
import { MemorySettings } from "./MemorySettings";
import { Settings } from "./Settings";

type Bridge = NonNullable<Window["desktopAPI"]>;

const ok = (value: unknown = null) => ({ ok: true, value });

function install(overrides: Partial<Bridge>): Bridge {
  const bridge = {
    getSettings: vi.fn().mockResolvedValue({ groqKeyConfigured: true, googleOAuthConfigured: true, secureStorageAvailable: true, startupError: null }),
    googleStatus: vi.fn().mockResolvedValue({ connected: true, email: null }),
    ...overrides,
  } as unknown as Bridge;
  window.desktopAPI = bridge;
  return bridge;
}

describe("Settings → Memory (ADR-006 M3)", () => {
  beforeEach(() => {
    window.desktopAPI = undefined;
  });

  const facts = [
    { id: "f1", content: "Rahul is the user's manager", category: "people", updatedAt: "" },
    { id: "f2", content: "Prefers meetings after 11am", category: "preferences", updatedAt: "" },
  ];

  it("groups what Zara remembers by category", async () => {
    install({ memoryList: vi.fn().mockResolvedValue(ok({ facts })) });
    render(<MemorySettings />);

    expect(await screen.findByText("Rahul is the user's manager")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
  });

  it("edits a memory inline and forgets another", async () => {
    const memoryUpdate = vi.fn().mockResolvedValue(ok());
    const memoryDelete = vi.fn().mockResolvedValue(ok());
    install({ memoryList: vi.fn().mockResolvedValue(ok({ facts })), memoryUpdate, memoryDelete });
    render(<MemorySettings />);

    fireEvent.click(await screen.findByRole("button", { name: 'Edit "Rahul is the user\'s manager"' }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit memory" }), { target: { value: "Priya is the user's manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(memoryUpdate).toHaveBeenCalledWith("f1", "Priya is the user's manager"));

    fireEvent.click(screen.getByRole("button", { name: 'Forget "Prefers meetings after 11am"' }));
    await waitFor(() => expect(memoryDelete).toHaveBeenCalledWith("f2"));
  });

  it("shows why an edit was refused (e.g. sensitive details)", async () => {
    install({
      memoryList: vi.fn().mockResolvedValue(ok({ facts })),
      memoryUpdate: vi.fn().mockResolvedValue({ ok: false, message: "That looks like sensitive information — it won't be saved." }),
    });
    render(<MemorySettings />);

    fireEvent.click(await screen.findByRole("button", { name: 'Edit "Rahul is the user\'s manager"' }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit memory" }), { target: { value: "PIN 1234" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Edit memory" }), { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("sensitive information");
  });

  it("asks before forgetting everything or deleting all chats", async () => {
    const memoryDeleteAll = vi.fn().mockResolvedValue(ok({ deleted: 2 }));
    const chatDeleteAll = vi.fn().mockResolvedValue(ok({ deleted: 3 }));
    install({ memoryList: vi.fn().mockResolvedValue(ok({ facts: [] })), memoryDeleteAll, chatDeleteAll });
    render(<MemorySettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Forget everything" }));
    expect(memoryDeleteAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByText("Zara's memory was cleared.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete all chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByText("All chats were deleted.")).toBeInTheDocument();
    expect(chatDeleteAll).toHaveBeenCalled();
  });
});

describe("Settings → Activity (ADR-006 M3)", () => {
  const entries = [
    { id: "a1", createdAt: new Date().toISOString(), summary: 'Set a reminder: "gym"', provider: "openai", canUndo: true, undoneAt: null },
    { id: "a2", createdAt: new Date().toISOString(), summary: 'Remembered: "Likes tea"', provider: "groq", canUndo: false, undoneAt: new Date().toISOString() },
  ];

  it("lists what Zara did, marks backup/undone entries, and undoes one", async () => {
    const activityUndo = vi.fn().mockResolvedValue(ok());
    install({ activityList: vi.fn().mockResolvedValue(ok({ entries })), activityUndo });
    render(<ActivitySettings />);

    const list = await screen.findByRole("list");
    expect(within(list).getByText('Set a reminder: "gym"')).toBeInTheDocument();
    expect(within(list).getByText(/via Groq backup · undone/)).toBeInTheDocument();
    expect(within(list).getAllByRole("button", { name: "Undo" })).toHaveLength(1);

    fireEvent.click(within(list).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(activityUndo).toHaveBeenCalledWith("a1"));
  });

  it("explains when something can't be undone any more", async () => {
    install({
      activityList: vi.fn().mockResolvedValue(ok({ entries })),
      activityUndo: vi.fn().mockResolvedValue({ ok: false, message: "That reminder is already gone." }),
    });
    render(<ActivitySettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That reminder is already gone.");
  });
});

describe("Settings tabs", () => {
  it("switches between General, Memory, and Activity", async () => {
    install({
      memoryList: vi.fn().mockResolvedValue(ok({ facts: [] })),
      activityList: vi.fn().mockResolvedValue(ok({ entries: [] })),
    });
    render(<Settings onClose={() => {}} />);

    expect(await screen.findByTestId("openai-section")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
    expect(await screen.findByTestId("memory-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("openai-section")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(await screen.findByTestId("activity-settings")).toBeInTheDocument();
  });

  it("shows no tabs on the first-run screen", async () => {
    install({});
    render(<Settings />);
    await screen.findByTestId("openai-section");
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
