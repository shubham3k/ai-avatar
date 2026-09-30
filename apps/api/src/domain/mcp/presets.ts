import { createRequire } from "node:module";

/**
 * ADR-006 §9 connections, in the agreed order. "bundled" servers ship with
 * the app and run on its own Node (no install); "npx" servers are fetched by
 * npm the first time (Node.js must be installed); "builtin" is implemented
 * inside the app (Google Drive, through the existing Google connection).
 */
export type PresetId = "local_files" | "google_drive" | "web_search" | "github" | "notion" | "slack" | "browser" | "custom";

export interface SecretField {
  key: string;
  label: string;
  help: string;
}

export interface Preset {
  id: PresetId;
  name: string;
  description: string;
  runtime: "bundled" | "npx" | "builtin" | "custom";
  /** npm package for "npx" presets (pinned major via the version). */
  npmPackage?: string;
  extraArgs?: string[];
  secrets: SecretField[];
  needsFolders?: boolean;
  /** When set, only these tools are ever offered (e.g. the browser: reading only — no clicks, forms, or typing). */
  toolAllowlist?: string[];
  note?: string;
}

export const PRESETS: Preset[] = [
  {
    id: "local_files",
    name: "Local files",
    description: "Read files in folders you choose.",
    runtime: "bundled",
    secrets: [],
    needsFolders: true,
    note: "Only the folders you pick. Tools that write, move or delete files always ask first.",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    description: "Search and read your Drive files (read-only).",
    runtime: "builtin",
    secrets: [],
    note: "Uses your Google connection — reconnect Google in Settings → Actions if Drive permission is missing.",
  },
  {
    id: "web_search",
    name: "Web search (Brave)",
    description: "Search the web.",
    runtime: "npx",
    npmPackage: "@modelcontextprotocol/server-brave-search@0.6",
    secrets: [{ key: "BRAVE_API_KEY", label: "Brave Search API key", help: "From brave.com/search/api (free plan available)." }],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Read repositories, issues and pull requests; changes always ask.",
    runtime: "npx",
    npmPackage: "@modelcontextprotocol/server-github@2025",
    secrets: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub personal access token",
        help: "github.com → Settings → Developer settings → Fine-grained tokens. Give it read access only unless you want Zara to propose changes.",
      },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search and read your Notion pages; changes always ask.",
    runtime: "npx",
    npmPackage: "@notionhq/notion-mcp-server@2",
    secrets: [{ key: "NOTION_TOKEN", label: "Notion integration token", help: "notion.so/my-integrations → New integration, then share pages with it." }],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Read channels; posting always asks.",
    runtime: "npx",
    npmPackage: "@modelcontextprotocol/server-slack@2025",
    secrets: [
      { key: "SLACK_BOT_TOKEN", label: "Slack bot token (xoxb-…)", help: "api.slack.com/apps → your app → OAuth. May need your workspace admin's approval." },
      { key: "SLACK_TEAM_ID", label: "Slack workspace (team) ID", help: "Starts with T — shown in Slack's workspace settings." },
    ],
  },
  {
    id: "browser",
    name: "Browser (read-only)",
    description: "Open pages and read them. No clicking, typing, forms or logins.",
    runtime: "npx",
    npmPackage: "@playwright/mcp@0.0",
    extraArgs: ["--headless", "--isolated"],
    secrets: [],
    toolAllowlist: ["browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_tabs", "browser_wait_for", "browser_close"],
    note: "Downloads a browser the first time (a few hundred MB).",
  },
  {
    id: "custom",
    name: "Custom server",
    description: "Any MCP server you run with a command.",
    runtime: "custom",
    secrets: [],
    note: "Runs the command you enter on this PC. Only add servers you trust.",
  },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** Absolute path of the bundled filesystem server's entry file. */
export function bundledFilesystemEntry(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js");
}

/** What to spawn for a connection. Bundled servers run on this app's own runtime (Electron as Node, or Node in dev). */
export function launchCommand(
  preset: Preset,
  connection: { command: string | null; args: string[]; folders: string[] },
): { command: string; args: string[]; env: Record<string, string> } {
  if (preset.runtime === "bundled") {
    return { command: process.execPath, args: [bundledFilesystemEntry(), ...connection.folders], env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  if (preset.runtime === "npx") {
    const npx = ["-y", preset.npmPackage!, ...(preset.extraArgs ?? []), ...connection.args];
    return process.platform === "win32"
      ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npx", ...npx], env: {} }
      : { command: "npx", args: npx, env: {} };
  }
  if (preset.runtime === "custom" && connection.command) {
    return { command: connection.command, args: connection.args, env: {} };
  }
  throw new Error("This connection has nothing to run.");
}
