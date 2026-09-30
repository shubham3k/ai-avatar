import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { McpConnection, McpToolPolicy, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { notFoundError, validationError } from "../../lib/errors.js";
import { createDriveService, type DriveService } from "../../providers/google/drive/drive.service.js";
import { createGoogleConnectionService, type GoogleConnectionService } from "../google-connection.service.js";
import { findPreset, launchCommand, PRESETS, type Preset, type PresetId } from "./presets.js";

/** What a connection's tool looks like to Zara and to Settings. */
export interface ConnectionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  destructive: boolean;
}

/** One running connection: an MCP server over stdio, or the built-in Drive reader. */
export interface ToolRunner {
  list(): Promise<ConnectionTool[]>;
  call(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export type ConnectionStatus = "off" | "starting" | "ready" | "error";

export interface ConnectionToolDto extends Omit<ConnectionTool, "inputSchema"> {
  enabled: boolean;
  trusted: boolean;
}

export interface ConnectionDto {
  id: string;
  preset: PresetId;
  name: string;
  enabled: boolean;
  folders: string[];
  /** Which secrets are saved (names only — values never leave the API). */
  savedSecrets: string[];
  command: string | null;
  args: string[];
  status: ConnectionStatus;
  error: string | null;
  tools: ConnectionToolDto[];
}

/** A tool as offered to the model this turn. */
export interface ChatConnectionTool {
  qualifiedName: string;
  connectionId: string;
  connectionName: string;
  tool: ConnectionTool;
  trusted: boolean;
}

export const RESULT_MAX_CHARS = 4000;
const START_TIMEOUT_MS = 90_000;
const CALL_TIMEOUT_MS = 60_000;
/** Keeps the model's tool list (and prompt) a sensible size. */
const MAX_CHAT_TOOLS = 40;

const READ_NAME = /^(read|get|list|search|find|query|fetch|view|describe|browser_snapshot|browser_tabs|browser_navigate|browser_wait_for|browser_close|directory_tree|list_allowed)/i;
const DESTRUCTIVE_NAME = /(delete|remove|drop|destroy|move|overwrite|write_file|edit_file|truncate|purge)/i;

/**
 * Risk from the server's own annotations when it gives them; otherwise a
 * cautious guess from the name. Only read-only tools can ever be trusted
 * (run without asking) — everything else always shows a card.
 */
export function classifyTool(
  name: string,
  annotations: { readOnlyHint?: boolean | undefined; destructiveHint?: boolean | undefined } | undefined,
) {
  const readOnly = annotations?.readOnlyHint ?? (READ_NAME.test(name) && !DESTRUCTIVE_NAME.test(name));
  const destructive = !readOnly && (annotations?.destructiveHint ?? DESTRUCTIVE_NAME.test(name));
  return { readOnly, destructive };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 16) || "conn";
}

/** "mcp_local_files_read_text_file" — unique, ≤ 64 chars, [a-zA-Z0-9_-] (the model APIs' limit). */
export function qualifiedToolName(connectionName: string, toolName: string, taken: Set<string>): string {
  const base = `mcp_${slug(connectionName)}_${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 60);
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base.slice(0, 58)}_${n}`;
  taken.add(name);
  return name;
}

/** MCP content blocks → plain text for Zara (capped). */
export function contentToText(result: { content?: unknown; isError?: unknown }): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const value = block as { type?: string; text?: string; resource?: { text?: string; uri?: string } };
      if (value.type === "text") return value.text ?? "";
      if (value.type === "resource") return value.resource?.text ?? `[resource ${value.resource?.uri ?? ""}]`;
      if (value.type === "image") return "[image omitted]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
  const prefixed = result.isError === true ? `Error: ${text}` : text;
  return prefixed.length > RESULT_MAX_CHARS ? `${prefixed.slice(0, RESULT_MAX_CHARS)}… (cut short)` : prefixed || "(no output)";
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Starts an MCP server over stdio with the official SDK. */
export async function startMcpRunner(launch: { command: string; args: string[]; env: Record<string, string> }): Promise<ToolRunner> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport, getDefaultEnvironment } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { ...getDefaultEnvironment(), ...launch.env },
    stderr: "ignore",
  });
  const client = new Client({ name: "zara", version: "1.0.0" });
  await withTimeout(client.connect(transport), START_TIMEOUT_MS, "The server didn't start in time.");
  return {
    async list() {
      const { tools } = await withTimeout(client.listTools(), 30_000, "The server didn't list its tools.");
      return tools.map((tool) => ({
        name: tool.name,
        description: (tool.description ?? "").slice(0, 600),
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        ...classifyTool(tool.name, tool.annotations),
      }));
    },
    async call(name, args) {
      const result = await withTimeout(client.callTool({ name, arguments: args }), CALL_TIMEOUT_MS, "The tool took too long.");
      return contentToText(result as { content?: unknown; isError?: unknown });
    },
    close: () => client.close(),
  };
}

/** The built-in Google Drive connection (drive.readonly). */
export function driveRunner(userId: string, deps: { drive: DriveService; google: GoogleConnectionService }): ToolRunner {
  return {
    async list() {
      return [
        {
          name: "drive_search",
          description: "Search the user's Google Drive by words in file names and contents. Returns names, types, dates and ids.",
          inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
          readOnly: true,
          destructive: false,
        },
        {
          name: "drive_read",
          description: "Read the text of one Drive file (Google Docs, Sheets as CSV, Slides, and plain text files) by its id from drive_search.",
          inputSchema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"], additionalProperties: false },
          readOnly: true,
          destructive: false,
        },
      ];
    },
    async call(name, args) {
      const token = await deps.google.getDecryptedRefreshToken(userId);
      if (name === "drive_search" && typeof args.query === "string") {
        const files = await deps.drive.search(token, args.query);
        return JSON.stringify(files.length ? files : "No matching files.");
      }
      if (name === "drive_read" && typeof args.fileId === "string") {
        const file = await deps.drive.readText(token, args.fileId);
        return contentToText({ content: [{ type: "text", text: "text" in file ? `${file.name}\n\n${file.text}` : `${file.name}: ${file.unsupported}` }] });
      }
      throw new Error("Unknown Drive tool or missing arguments.");
    },
    close: async () => undefined,
  };
}

interface RuntimeState {
  status: ConnectionStatus;
  error: string | null;
  runner: ToolRunner | null;
  tools: ConnectionTool[];
  starting: Promise<void> | null;
}

export interface AddConnectionInput {
  preset: string;
  name?: string | undefined;
  folders?: string[] | undefined;
  secrets?: Record<string, string> | undefined;
  command?: string | undefined;
  args?: string[] | undefined;
}

/**
 * ADR-006 §9 — Zara as an MCP client. Connections are added only by the
 * user (Settings → Connections), secrets are encrypted at rest, every tool
 * asks first unless the user trusted it (read-only tools only), and tool
 * output is treated as data. Servers start in the background; a chat
 * only waits briefly for them.
 */
export function createConnectionsService(dependencies?: {
  prisma?: PrismaClient;
  startRunner?: (launch: { command: string; args: string[]; env: Record<string, string> }) => Promise<ToolRunner>;
  drive?: DriveService;
  google?: GoogleConnectionService;
}) {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const startRunner = dependencies?.startRunner ?? startMcpRunner;
  const drive = dependencies?.drive ?? createDriveService();
  const google = dependencies?.google ?? createGoogleConnectionService();
  const runtime = new Map<string, RuntimeState>();

  function state(id: string): RuntimeState {
    let current = runtime.get(id);
    if (!current) {
      current = { status: "off", error: null, runner: null, tools: [], starting: null };
      runtime.set(id, current);
    }
    return current;
  }

  function secretsOf(row: McpConnection): Record<string, string> {
    if (!row.envEncrypted) return {};
    try {
      return JSON.parse(decryptSecret(row.envEncrypted)) as Record<string, string>;
    } catch {
      return {};
    }
  }

  function parseList(raw: string): string[] {
    try {
      const value = JSON.parse(raw) as unknown;
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  function presetFor(row: McpConnection): Preset {
    const preset = findPreset(row.preset);
    if (!preset) throw new Error(`Unknown connection type "${row.preset}".`);
    return preset;
  }

  async function stop(id: string): Promise<void> {
    const current = runtime.get(id);
    runtime.delete(id);
    await current?.runner?.close().catch(() => undefined);
  }

  function start(row: McpConnection): Promise<void> {
    const current = state(row.id);
    if (current.status === "ready" || current.starting) return current.starting ?? Promise.resolve();
    current.status = "starting";
    current.error = null;
    current.starting = (async () => {
      try {
        const preset = presetFor(row);
        const runner =
          preset.runtime === "builtin"
            ? driveRunner(row.userId, { drive, google })
            : await startRunner((() => {
                const launch = launchCommand(preset, { command: row.command, args: parseList(row.args), folders: parseList(row.folders) });
                return { ...launch, env: { ...launch.env, ...secretsOf(row) } };
              })());
        let tools = await runner.list();
        if (preset.toolAllowlist) tools = tools.filter((tool) => preset.toolAllowlist!.includes(tool.name));
        current.runner = runner;
        current.tools = tools;
        current.status = "ready";
      } catch (err) {
        current.status = "error";
        current.error = err instanceof Error ? err.message.slice(0, 300) : "Couldn't start.";
      } finally {
        current.starting = null;
      }
    })();
    return current.starting;
  }

  function toDto(row: McpConnection & { tools: McpToolPolicy[] }): ConnectionDto {
    const current = runtime.get(row.id);
    const policies = new Map(row.tools.map((policy) => [policy.toolName, policy]));
    return {
      id: row.id,
      preset: row.preset as PresetId,
      name: row.name,
      enabled: row.enabled,
      folders: parseList(row.folders),
      savedSecrets: Object.keys(secretsOf(row)),
      command: row.command,
      args: parseList(row.args),
      status: row.enabled ? (current?.status ?? "off") : "off",
      error: current?.error ?? null,
      tools: (current?.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        readOnly: tool.readOnly,
        destructive: tool.destructive,
        enabled: policies.get(tool.name)?.enabled ?? true,
        trusted: tool.readOnly && (policies.get(tool.name)?.trusted ?? false),
      })),
    };
  }

  async function findRow(userId: string, id: string) {
    const row = await prisma.mcpConnection.findFirst({ where: { id, userId }, include: { tools: true } });
    if (!row) throw notFoundError("That connection isn't there any more.");
    return row;
  }

  function validateFolders(folders: string[]): string[] {
    const clean = [...new Set(folders.map((folder) => folder.trim()).filter(Boolean))];
    if (clean.length === 0) throw validationError("Choose at least one folder.");
    for (const folder of clean) {
      if (!isAbsolute(folder) || !existsSync(folder) || !statSync(folder).isDirectory()) throw validationError(`"${folder}" isn't a folder on this PC.`);
    }
    return clean.slice(0, 20);
  }

  return {
    presets: PRESETS,

    async list(userId: string): Promise<ConnectionDto[]> {
      const rows = await prisma.mcpConnection.findMany({ where: { userId }, include: { tools: true }, orderBy: { createdAt: "asc" } });
      for (const row of rows) if (row.enabled) void start(row);
      return rows.map(toDto);
    },

    async add(userId: string, input: AddConnectionInput): Promise<ConnectionDto> {
      const preset = findPreset(input.preset);
      if (!preset) throw validationError("Unknown connection type.");
      if (preset.runtime === "builtin" && (await prisma.mcpConnection.count({ where: { userId, preset: preset.id } })) > 0) {
        throw validationError(`${preset.name} is already connected.`);
      }
      const folders = preset.needsFolders ? validateFolders(input.folders ?? []) : [];
      const secrets: Record<string, string> = {};
      for (const field of preset.secrets) {
        const value = input.secrets?.[field.key]?.trim();
        if (!value) throw validationError(`${field.label} is needed.`);
        secrets[field.key] = value;
      }
      if (preset.runtime === "custom") {
        if (!input.command?.trim()) throw validationError("Enter the command that starts the server.");
        for (const [key, value] of Object.entries(input.secrets ?? {})) {
          if (/^[A-Z_][A-Z0-9_]{0,63}$/i.test(key) && value) secrets[key] = value;
        }
      }
      const row = await prisma.mcpConnection.create({
        data: {
          userId,
          preset: preset.id,
          name: (input.name?.trim() || preset.name).slice(0, 60),
          command: preset.runtime === "custom" ? input.command!.trim().slice(0, 300) : null,
          args: JSON.stringify(preset.runtime === "custom" ? (input.args ?? []).slice(0, 30).map((arg) => arg.slice(0, 300)) : []),
          folders: JSON.stringify(folders),
          envEncrypted: Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null,
        },
        include: { tools: true },
      });
      await withTimeout(start(row), 5000, "starting").catch(() => undefined);
      return toDto(row);
    },

    async update(userId: string, id: string, patch: { enabled?: boolean | undefined; secrets?: Record<string, string> | undefined }): Promise<ConnectionDto> {
      const row = await findRow(userId, id);
      const secrets = patch.secrets ? { ...secretsOf(row), ...Object.fromEntries(Object.entries(patch.secrets).filter(([, value]) => value.trim())) } : null;
      const updated = await prisma.mcpConnection.update({
        where: { id },
        data: {
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(secrets ? { envEncrypted: encryptSecret(JSON.stringify(secrets)) } : {}),
        },
        include: { tools: true },
      });
      await stop(id);
      if (updated.enabled) await withTimeout(start(updated), 5000, "starting").catch(() => undefined);
      return toDto(updated);
    },

    async remove(userId: string, id: string): Promise<void> {
      await findRow(userId, id);
      await stop(id);
      await prisma.mcpConnection.delete({ where: { id } });
    },

    async restart(userId: string, id: string): Promise<ConnectionDto> {
      const row = await findRow(userId, id);
      await stop(id);
      if (row.enabled) await withTimeout(start(row), 5000, "starting").catch(() => undefined);
      return toDto(row);
    },

    /** Only read-only tools can be trusted (run without a card). */
    async setToolPolicy(userId: string, id: string, toolName: string, patch: { enabled?: boolean | undefined; trusted?: boolean | undefined }): Promise<ConnectionDto> {
      const row = await findRow(userId, id);
      if (patch.trusted) {
        const tool = runtime.get(id)?.tools.find((candidate) => candidate.name === toolName);
        if (!tool) throw validationError("Start the connection first, so its tools are known.");
        if (!tool.readOnly) throw validationError("Only tools that just read can run without asking.");
      }
      await prisma.mcpToolPolicy.upsert({
        where: { connectionId_toolName: { connectionId: id, toolName } },
        update: {
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.trusted !== undefined ? { trusted: patch.trusted } : {}),
        },
        create: { connectionId: id, toolName, enabled: patch.enabled ?? true, trusted: patch.trusted ?? false },
      });
      return toDto({ ...row, tools: await prisma.mcpToolPolicy.findMany({ where: { connectionId: id } }) });
    },

    /** Tools to offer Zara this turn: ready connections, enabled tools. Waits briefly for servers still starting. */
    async chatTools(userId: string, waitMs = 2500): Promise<ChatConnectionTool[]> {
      const rows = await prisma.mcpConnection.findMany({ where: { userId, enabled: true }, include: { tools: true } });
      if (rows.length === 0) return [];
      await withTimeout(Promise.all(rows.map((row) => start(row))), waitMs, "slow").catch(() => undefined);
      const taken = new Set<string>();
      const tools: ChatConnectionTool[] = [];
      for (const row of rows) {
        const current = runtime.get(row.id);
        if (current?.status !== "ready") continue;
        const policies = new Map(row.tools.map((policy) => [policy.toolName, policy]));
        for (const tool of current.tools) {
          const policy = policies.get(tool.name);
          if (policy && !policy.enabled) continue;
          if (tools.length >= MAX_CHAT_TOOLS) break;
          tools.push({
            qualifiedName: qualifiedToolName(row.name, tool.name, taken),
            connectionId: row.id,
            connectionName: row.name,
            tool,
            trusted: tool.readOnly && (policy?.trusted ?? false),
          });
        }
      }
      return tools;
    },

    /** Runs a tool. Callers enforce the trust rules (cards) first. */
    async call(userId: string, connectionId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
      const row = await findRow(userId, connectionId);
      if (!row.enabled) throw new Error("That connection is switched off.");
      await start(row);
      const current = runtime.get(connectionId);
      if (current?.status !== "ready" || !current.runner) throw new Error(current?.error ?? "The connection isn't running.");
      if (!current.tools.some((tool) => tool.name === toolName)) throw new Error("That tool isn't available.");
      return current.runner.call(toolName, args);
    },

    async stopAll(): Promise<void> {
      await Promise.all([...runtime.keys()].map((id) => stop(id)));
    },
  };
}

export type ConnectionsService = ReturnType<typeof createConnectionsService>;

let shared: ConnectionsService | null = null;
export function getConnectionsService(): ConnectionsService {
  shared ??= createConnectionsService();
  return shared;
}
