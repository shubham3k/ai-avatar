import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelLabel, RecallSettings } from "./RecallSettings";

const STATUS = {
  state: "idle",
  lastIndexedAt: "2026-09-29T10:00:00.000Z",
  lastError: null,
  model: "ready",
  modelError: null,
  sources: { email: 120, event: 14, chat: 6, memory: 3, note: 2, document: 5 },
  chunks: 300,
  embedded: 300,
  emailHistoryComplete: true,
};
const SETTINGS = { documentsFolder: "C:\Users\me\Documents\Zara", documentsEnabled: true, peopleEnabled: true, emailHistoryDays: 30 };

afterEach(() => {
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

function installBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    recallGetSettings: vi.fn().mockResolvedValue({ ok: true, value: SETTINGS }),
    recallStatus: vi.fn().mockResolvedValue({ ok: true, value: STATUS }),
    recallUpdateSettings: vi.fn(async (patch: object) => ({ ok: true, value: { ...SETTINGS, ...patch } })),
    recallIndex: vi.fn().mockResolvedValue({ ok: true, value: { started: true } }),
    recallChooseFolder: vi.fn().mockResolvedValue({ ok: true, value: { ...SETTINGS, documentsFolder: "D:\Work" } }),
    recallOpenFolder: vi.fn().mockResolvedValue({ ok: true, value: null }),
    ...overrides,
  };
  window.desktopAPI = bridge as unknown as NonNullable<Window["desktopAPI"]>;
  return bridge;
}

describe("Settings → Recall (ADR-006 M6)", () => {
  it("shows what's indexed and the folder", async () => {
    installBridge();
    render(<RecallSettings />);
    expect(await screen.findByText(/120 emails · 14 events · 6 chats · 3 memories · 2 notes · 5 documents/)).toBeInTheDocument();
    expect(screen.getByText("Search by meaning is ready")).toBeInTheDocument();
    expect(screen.getByText(SETTINGS.documentsFolder)).toBeInTheDocument();
  });

  it("changes history length, toggles, re-indexes, and picks a folder", async () => {
    const bridge = installBridge();
    render(<RecallSettings />);
    fireEvent.change(await screen.findByLabelText("Email history"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /build quick profiles/ }));
    fireEvent.click(screen.getByRole("button", { name: "Update the index now" }));
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));

    await waitFor(() => expect(screen.getByText("D:\Work")).toBeInTheDocument());
    expect(bridge.recallUpdateSettings.mock.calls.map((call) => call[0])).toEqual([{ emailHistoryDays: 90 }, { peopleEnabled: false }]);
    expect(bridge.recallIndex).toHaveBeenCalled();
    expect(bridge.recallChooseFolder).toHaveBeenCalled();
  });

  it("explains the model's state", () => {
    expect(modelLabel({ ...STATUS, model: "loading" } as never)).toMatch(/Downloading the search model/);
    expect(modelLabel({ ...STATUS, embedded: 100 } as never)).toMatch(/100 of 300/);
    expect(modelLabel({ ...STATUS, model: "failed" } as never)).toMatch(/keyword search still works/);
  });
});
