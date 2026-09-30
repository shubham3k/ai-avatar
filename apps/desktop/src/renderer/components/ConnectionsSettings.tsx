import { useCallback, useEffect, useState } from "react";

interface Preset {
  id: string;
  name: string;
  description: string;
  runtime: "bundled" | "npx" | "builtin" | "custom";
  secrets: { key: string; label: string; help: string }[];
  needsFolders?: boolean;
  note?: string;
}

interface ConnectionTool {
  name: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  enabled: boolean;
  trusted: boolean;
}

interface Connection {
  id: string;
  preset: string;
  name: string;
  enabled: boolean;
  folders: string[];
  savedSecrets: string[];
  status: "off" | "starting" | "ready" | "error";
  error: string | null;
  tools: ConnectionTool[];
}

function readResult(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

function statusLabel(connection: Connection): string {
  if (!connection.enabled) return "Off";
  switch (connection.status) {
    case "ready":
      return `Ready · ${connection.tools.length} tool${connection.tools.length === 1 ? "" : "s"}`;
    case "starting":
      return "Starting…";
    case "error":
      return `Problem: ${connection.error ?? "couldn't start"}`;
    default:
      return "Not started";
  }
}

/**
 * Settings → Connections (ADR-006 M8): apps Zara can use. Strict trust —
 * every tool asks first; only tools that just read can be set to run
 * without asking; tools that change or delete things always ask.
 */
export function ConnectionsSettings() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [adding, setAdding] = useState<Preset | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState({ name: "", command: "", args: "" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = readResult(await (window.desktopAPI?.connectionsList?.() ?? Promise.resolve(null)).catch(() => null));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const value = result.value as { presets?: Preset[]; connections?: Connection[] };
    setPresets(value.presets ?? []);
    setConnections(value.connections ?? []);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (call: Promise<unknown> | undefined, after?: () => void) => {
    setBusy(true);
    setError(null);
    const result = readResult(await (call ?? Promise.resolve(null)).catch(() => null));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    after?.();
    await load();
  };

  const startAdding = (preset: Preset) => {
    setSecrets({});
    setCustom({ name: "", command: "", args: "" });
    setError(null);
    if (preset.needsFolders || (preset.secrets.length === 0 && preset.runtime !== "custom")) {
      // Local files opens the folder picker; others need nothing more.
      void run(window.desktopAPI?.connectionsAdd?.({ preset: preset.id }));
      return;
    }
    setAdding(preset);
  };

  const submit = () => {
    if (!adding) return;
    const input: Record<string, unknown> = { preset: adding.id, secrets };
    if (adding.runtime === "custom") {
      input.name = custom.name || "Custom server";
      input.command = custom.command;
      input.args = custom.args.split(" ").filter(Boolean);
    }
    void run(window.desktopAPI?.connectionsAdd?.(input), () => setAdding(null));
  };

  const connected = new Set(connections.map((connection) => connection.preset));

  return (
    <div data-testid="connections-settings">
      {error && (
        <div className="card-error" role="alert">
          {error}
        </div>
      )}

      <div className="settings-section">
        <div className="settings-label">Your connections</div>
        <div className="settings-hint">
          Zara asks before using any of these (a card in the chat). You can let tools that only read run without asking. Tools that
          change or delete things always ask.
        </div>
        {connections.length === 0 && <div className="settings-hint">Nothing connected yet.</div>}
        {connections.map((connection) => (
          <div key={connection.id} className="connection-row" data-testid="connection-row">
            <div className="connection-head">
              <span className="connection-name">{connection.name}</span>
              <label className="settings-radio">
                <input
                  type="checkbox"
                  aria-label={`${connection.name} on`}
                  checked={connection.enabled}
                  onChange={(e) => void run(window.desktopAPI?.connectionsUpdate?.(connection.id, { enabled: e.target.checked }))}
                />
                On
              </label>
            </div>
            <div className="settings-hint">{statusLabel(connection)}</div>
            {connection.folders.length > 0 && <div className="settings-hint">Folders: {connection.folders.join("; ")}</div>}
            <div className="recall-folder-actions">
              <button type="button" className="button button-snooze" onClick={() => setExpanded(expanded === connection.id ? null : connection.id)}>
                {expanded === connection.id ? "Hide tools" : "Tools"}
              </button>
              <button type="button" className="button button-snooze" onClick={() => void run(window.desktopAPI?.connectionsRestart?.(connection.id))}>
                Restart
              </button>
              <button type="button" className="button button-snooze" onClick={() => void run(window.desktopAPI?.connectionsRemove?.(connection.id))}>
                Remove
              </button>
            </div>
            {expanded === connection.id && (
              <div className="connection-tools">
                {connection.tools.length === 0 && <div className="settings-hint">Tools appear once it's running.</div>}
                {connection.tools.map((tool) => (
                  <div key={tool.name} className="connection-tool" title={tool.description}>
                    <span className="connection-tool-name">
                      {tool.name}
                      <span className={`tool-badge ${tool.destructive ? "tool-danger" : tool.readOnly ? "tool-read" : "tool-write"}`}>
                        {tool.destructive ? "deletes" : tool.readOnly ? "reads" : "changes"}
                      </span>
                    </span>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Use ${tool.name}`}
                        checked={tool.enabled}
                        onChange={(e) => void run(window.desktopAPI?.connectionsToolPolicy?.(connection.id, tool.name, { enabled: e.target.checked }))}
                      />
                      use
                    </label>
                    <label title={tool.readOnly ? "Run without asking" : "Only tools that just read can run without asking"}>
                      <input
                        type="checkbox"
                        aria-label={`Don't ask for ${tool.name}`}
                        disabled={!tool.readOnly}
                        checked={tool.trusted}
                        onChange={(e) => void run(window.desktopAPI?.connectionsToolPolicy?.(connection.id, tool.name, { trusted: e.target.checked }))}
                      />
                      don't ask
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="settings-section">
        <div className="settings-label">Add a connection</div>
        {adding ? (
          <div data-testid="add-connection-form">
            <div className="settings-sublabel">{adding.name}</div>
            <div className="settings-hint">{adding.description}</div>
            {adding.secrets.map((field) => (
              <label key={field.key} className="settings-sublabel">
                {field.label}
                <input
                  type="password"
                  className="settings-input"
                  aria-label={field.label}
                  value={secrets[field.key] ?? ""}
                  onChange={(e) => setSecrets({ ...secrets, [field.key]: e.target.value })}
                />
                <span className="settings-hint">{field.help}</span>
              </label>
            ))}
            {adding.runtime === "custom" && (
              <>
                <input className="settings-input" aria-label="Name" placeholder="Name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
                <input className="settings-input" aria-label="Command" placeholder="Command, e.g. npx" value={custom.command} onChange={(e) => setCustom({ ...custom, command: e.target.value })} />
                <input className="settings-input" aria-label="Arguments" placeholder="Arguments, e.g. -y some-mcp-server" value={custom.args} onChange={(e) => setCustom({ ...custom, args: e.target.value })} />
              </>
            )}
            {adding.note && <div className="settings-hint">{adding.note}</div>}
            {adding.runtime === "npx" && <div className="settings-hint">Needs Node.js on this PC; the server downloads the first time (npm).</div>}
            <div className="recall-folder-actions">
              <button type="button" className="button button-done" disabled={busy} onClick={submit}>
                Connect
              </button>
              <button type="button" className="button button-snooze" onClick={() => setAdding(null)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="preset-grid">
            {presets
              .filter((preset) => preset.runtime !== "builtin" || !connected.has(preset.id))
              .map((preset) => (
                <button key={preset.id} type="button" className="button button-snooze" title={preset.description} disabled={busy} onClick={() => startAdding(preset)}>
                  + {preset.name}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
