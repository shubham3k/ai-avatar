import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings, describeUsage } from "./Settings";

type Bridge = NonNullable<Window["desktopAPI"]>;

const MODEL_CHOICES = [
  { id: "gpt-5-nano", label: "gpt-5-nano — cheapest" },
  { id: "gpt-6-luna", label: "gpt-6-luna — recommended" },
  { id: "gpt-6-sol", label: "gpt-6-sol — most capable" },
];

function installBridge(overrides: Partial<Bridge> = {}): Bridge {
  const bridge = {
    getSettings: vi.fn().mockResolvedValue({
      groqKeyConfigured: true,
      openaiKeyConfigured: false,
      openaiModel: "gpt-6-luna",
      openaiModelChoices: MODEL_CHOICES,
      googleOAuthConfigured: true,
      secureStorageAvailable: true,
      startupError: null,
    }),
    googleStatus: vi.fn().mockResolvedValue({ connected: true, email: "me@example.com" }),
    getUsageSummary: vi.fn().mockResolvedValue({
      since: "2026-09-01T00:00:00.000Z",
      calls: 12,
      estimatedCostUsd: 0.034,
      openai: { calls: 10, costUsd: 0.034 },
      groq: { calls: 2, costUsd: null },
    }),
    saveOpenAiKey: vi.fn().mockReturnValue(new Promise(() => {})),
    saveOpenAiModel: vi.fn().mockReturnValue(new Promise(() => {})),
    saveGroqKey: vi.fn(),
    saveGoogleCredentials: vi.fn(),
    connectGoogle: vi.fn(),
    disconnectGoogle: vi.fn(),
    ...overrides,
  } as unknown as Bridge;
  window.desktopAPI = bridge;
  return bridge;
}

describe("Settings — AI provider (ADR-006)", () => {
  beforeEach(() => {
    window.desktopAPI = undefined;
  });

  it("shows the OpenAI section first, with Groq relabelled as the optional backup", async () => {
    installBridge();
    render(<Settings onClose={() => {}} />);

    const section = await screen.findByTestId("openai-section");
    expect(within(section).getByText("AI provider (OpenAI)")).toBeInTheDocument();
    expect(within(section).getByText(/Not configured/)).toBeInTheDocument();
    expect(screen.getByText("Groq API key (backup, optional)")).toBeInTheDocument();
  });

  it("saves a pasted OpenAI key through the bridge (which restarts the app)", async () => {
    const bridge = installBridge();
    render(<Settings onClose={() => {}} />);

    fireEvent.change(await screen.findByLabelText("OpenAI API key"), { target: { value: "  sk-test-123  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key (restarts the app)" }));

    await waitFor(() => expect(bridge.saveOpenAiKey).toHaveBeenCalledWith("sk-test-123"));
    expect(screen.getAllByText("Saving — restarting…").length).toBeGreaterThan(0);
  });

  it("offers the model picker and only shows the save button once a different model is chosen", async () => {
    const bridge = installBridge();
    render(<Settings onClose={() => {}} />);

    const picker = await screen.findByLabelText("Model");
    await waitFor(() => expect(picker).toHaveValue("gpt-6-luna"));
    expect(screen.queryByRole("button", { name: "Use this model (restarts the app)" })).toBeNull();

    fireEvent.change(picker, { target: { value: "gpt-5-nano" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this model (restarts the app)" }));

    await waitFor(() => expect(bridge.saveOpenAiModel).toHaveBeenCalledWith("gpt-5-nano"));
  });

  it("shows this month's estimated usage", async () => {
    installBridge();
    render(<Settings onClose={() => {}} />);

    expect(await screen.findByTestId("usage-summary")).toHaveTextContent(
      "This month: about $0.03 · 12 AI calls (2 by the Groq backup).",
    );
  });

  it("asks for an OpenAI key on the first-run screen", async () => {
    installBridge();
    render(<Settings />);

    expect(await screen.findByText(/Add your OpenAI API key and connect your Google account/)).toBeInTheDocument();
  });
});

describe("describeUsage", () => {
  const base = { openai: { calls: 0, costUsd: null }, groq: { calls: 0, costUsd: null } };

  it("handles no usage, tiny usage, and backup calls", () => {
    expect(describeUsage({ ...base, calls: 0, estimatedCostUsd: 0 })).toBe("This month: no AI usage yet.");
    expect(describeUsage({ ...base, calls: 1, estimatedCostUsd: 0.0004 })).toBe("This month: under $0.01 · 1 AI call.");
    expect(
      describeUsage({ calls: 3, estimatedCostUsd: 0, openai: { calls: 0, costUsd: null }, groq: { calls: 3, costUsd: null } }),
    ).toBe("This month: no cost · 3 AI calls (3 by the Groq backup).");
  });
});
