import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionCard } from "./ActionCard";
import { ConnectionsSettings } from "./ConnectionsSettings";
import type { ActionCardData } from "../state/use-action-cards";

const PRESETS = [
  { id: "local_files", name: "Local files", description: "Read files", runtime: "bundled", secrets: [], needsFolders: true },
  { id: "google_drive", name: "Google Drive", description: "Drive", runtime: "builtin", secrets: [] },
  {
    id: "github",
    name: "GitHub",
    description: "Repos",
    runtime: "npx",
    secrets: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub personal access token", help: "Make one" }],
  },
];
const CONNECTION = {
  id: "c1",
  preset: "google_drive",
  name: "Google Drive",
  enabled: true,
  folders: [],
  savedSecrets: [],
  status: "ready",
  error: null,
  tools: [
    { name: "drive_search", description: "", readOnly: true, destructive: false, enabled: true, trusted: false },
    { name: "delete_file", description: "", readOnly: false, destructive: true, enabled: true, trusted: false },
  ],
};

afterEach(() => {
  delete (window as { desktopAPI?: unknown }).desktopAPI;
});

function installBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    connectionsList: vi.fn().mockResolvedValue({ ok: true, value: { presets: PRESETS, connections: [CONNECTION] } }),
    connectionsAdd: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    connectionsUpdate: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    connectionsToolPolicy: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    connectionsRestart: vi.fn(),
    connectionsRemove: vi.fn(),
    ...overrides,
  };
  window.desktopAPI = bridge as unknown as NonNullable<Window["desktopAPI"]>;
  return bridge;
}

describe("Settings → Connections (ADR-006 M8)", () => {
  it("lists connections; only read-only tools can skip asking", async () => {
    const bridge = installBridge();
    render(<ConnectionsSettings />);
    const row = await screen.findByTestId("connection-row");
    expect(row).toHaveTextContent("Ready · 2 tools");
    fireEvent.click(within(row).getByRole("button", { name: "Tools" }));

    expect(screen.getByRole("checkbox", { name: "Don't ask for delete_file" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Don't ask for drive_search" }));
    await waitFor(() => expect(bridge.connectionsToolPolicy).toHaveBeenCalledWith("c1", "drive_search", { trusted: true }));
  });

  it("adding GitHub asks for the token; Local files goes straight to the folder picker; built-ins show once", async () => {
    const bridge = installBridge();
    render(<ConnectionsSettings />);
    await screen.findByTestId("connection-row");
    expect(screen.queryByRole("button", { name: "+ Google Drive" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ Local files" }));
    await waitFor(() => expect(bridge.connectionsAdd).toHaveBeenCalledWith({ preset: "local_files" }));

    fireEvent.click(screen.getByRole("button", { name: "+ GitHub" }));
    fireEvent.change(await screen.findByLabelText("GitHub personal access token"), { target: { value: "ghp_x" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(bridge.connectionsAdd).toHaveBeenLastCalledWith({ preset: "github", secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x" } }),
    );
  });
});

const toolCard: ActionCardData = {
  id: "t1",
  kind: "mcp_call",
  status: "pending",
  payload: { connectionId: "c1", connectionName: "Google Drive", tool: "drive_search", args: { query: "budget" }, readOnly: true, destructive: false },
  before: null,
  newRecipients: [],
  notifies: [],
  executeAt: null,
  error: null,
  result: null,
  createdAt: "2026-09-30T10:00:00.000Z",
  voiceApprovable: false,
};

describe("connection tool card (M8)", () => {
  it("shows the tool, its risk and input; read-only tools offer 'Always allow'", async () => {
    const onApprove = vi.fn().mockResolvedValue(null);
    render(<ActionCard card={toolCard} now={0} onApprove={onApprove} onCancel={vi.fn()} onDismiss={vi.fn()} />);
    const card = screen.getByTestId("action-card");
    expect(card).toHaveTextContent("🔌 Google Drive");
    expect(card).toHaveTextContent("Zara wants to use drive_search");
    expect(card).toHaveTextContent("reads only");
    expect(card).toHaveTextContent('"query": "budget"');
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith("t1", undefined, { trustTool: true }));
  });

  it("tools that delete things are flagged and can only be allowed once", () => {
    render(
      <ActionCard
        card={{ ...toolCard, payload: { ...toolCard.payload, tool: "delete_file", readOnly: false, destructive: true } }}
        now={0}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("action-card")).toHaveTextContent("⚠ can delete or overwrite");
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
  });
});
