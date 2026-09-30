import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import {
  classifyTool,
  contentToText,
  createConnectionsService,
  qualifiedToolName,
  RESULT_MAX_CHARS,
  type ConnectionTool,
  type ToolRunner,
} from "../src/domain/mcp/connections.service.js";
import { findPreset, launchCommand } from "../src/domain/mcp/presets.js";
import { createActionsService } from "../src/domain/actions/actions.service.js";
import { createZaraAgentService, type ChatEvent } from "../src/domain/chat/zara-agent.service.js";
import type { ChatRequest, LlmProvider } from "../src/providers/llm/llm-provider.js";

const USER_EMAIL = "connections@example.local";
let userId: string;
let folder: string;

async function cleanDb() {
  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) return;
  await prisma.mcpConnection.deleteMany({ where: { userId: user.id } });
  await prisma.pendingAction.deleteMany({ where: { userId: user.id } });
  await prisma.activityEntry.deleteMany({ where: { userId: user.id } });
  await prisma.chatMessage.deleteMany({ where: { conversation: { userId: user.id } } });
  await prisma.conversation.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

const TOOLS: ConnectionTool[] = [
  { name: "search_issues", description: "Search issues", inputSchema: { type: "object", properties: { q: { type: "string" } } }, readOnly: true, destructive: false },
  { name: "create_issue", description: "Create an issue", inputSchema: { type: "object", properties: {} }, readOnly: false, destructive: false },
  { name: "delete_repo", description: "Delete a repository", inputSchema: { type: "object", properties: {} }, readOnly: false, destructive: true },
];

function fakeRunner(tools: ConnectionTool[] = TOOLS) {
  const calls: { name: string; args: unknown }[] = [];
  const runner: ToolRunner = {
    list: vi.fn(async () => tools),
    call: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return `result of ${name}: ${JSON.stringify(args)}`;
    }),
    close: vi.fn(async () => undefined),
  };
  return { runner, calls, startRunner: vi.fn(async () => runner) };
}

beforeEach(async () => {
  await cleanDb();
  userId = (await prisma.user.create({ data: { email: USER_EMAIL, displayName: "C", timezone: "UTC" } })).id;
  folder = await mkdtemp(join(tmpdir(), "zara-mcp-"));
});
afterAll(async () => {
  await cleanDb();
  await rm(folder, { recursive: true, force: true });
});

describe("connection building blocks (M8)", () => {
  it("classifies risk from annotations, else cautiously from the name", () => {
    expect(classifyTool("anything", { readOnlyHint: true })).toEqual({ readOnly: true, destructive: false });
    expect(classifyTool("anything", { destructiveHint: true })).toEqual({ readOnly: false, destructive: true });
    expect(classifyTool("read_text_file", undefined)).toEqual({ readOnly: true, destructive: false });
    expect(classifyTool("write_file", undefined)).toEqual({ readOnly: false, destructive: true });
    expect(classifyTool("create_issue", undefined)).toEqual({ readOnly: false, destructive: false });
    expect(classifyTool("get_and_delete", undefined).readOnly).toBe(false);
  });

  it("builds unique, API-safe tool names", () => {
    const taken = new Set<string>();
    const a = qualifiedToolName("Local files", "read_text_file", taken);
    const b = qualifiedToolName("Local files", "read_text_file", taken);
    expect(a).toBe("mcp_local_files_read_text_file");
    expect(b).not.toBe(a);
    const long = qualifiedToolName("A very long connection name indeed", "x".repeat(80), taken);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("turns tool output into capped text", () => {
    expect(contentToText({ content: [{ type: "text", text: "hello" }, { type: "image" }] })).toBe("hello\n[image omitted]");
    expect(contentToText({ content: [{ type: "text", text: "nope" }], isError: true })).toBe("Error: nope");
    expect(contentToText({ content: [{ type: "text", text: "x".repeat(RESULT_MAX_CHARS + 10) }] })).toMatch(/cut short\)$/);
  });

  it("runs bundled servers on the app's own runtime, npx servers through npm", () => {
    const bundled = launchCommand(findPreset("local_files")!, { command: null, args: [], folders: ["C:\\\\Docs"] });
    expect(bundled.command).toBe(process.execPath);
    expect(bundled.args[0]).toMatch(/server-filesystem[\\/]dist[\\/]index\.js$/);
    expect(bundled.args.at(-1)).toBe("C:\\\\Docs");
    expect(bundled.env.ELECTRON_RUN_AS_NODE).toBe("1");
    const npx = launchCommand(findPreset("github")!, { command: null, args: [], folders: [] });
    expect(npx.args.join(" ")).toMatch(/npx -y @modelcontextprotocol\/server-github@2025/);
    expect(findPreset("browser")!.toolAllowlist).not.toContain("browser_click");
  });
});

describe("connections service (M8)", () => {
  it("validates what's needed, encrypts secrets, and never returns them", async () => {
    const { startRunner } = fakeRunner();
    const service = createConnectionsService({ startRunner });
    await expect(service.add(userId, { preset: "github" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.add(userId, { preset: "local_files", folders: ["relative/path"] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.add(userId, { preset: "custom" })).rejects.toMatchObject({ statusCode: 400 });

    const github = await service.add(userId, { preset: "github", secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_secret123" } });
    expect(github).toMatchObject({ status: "ready", savedSecrets: ["GITHUB_PERSONAL_ACCESS_TOKEN"] });
    expect(JSON.stringify(github)).not.toContain("ghp_secret123");
    const row = await prisma.mcpConnection.findUniqueOrThrow({ where: { id: github.id } });
    expect(row.envEncrypted).not.toContain("ghp_secret123");
    expect(startRunner).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_secret123" }) }));
  });

  it("only read-only tools can be trusted; disabled tools aren't offered", async () => {
    const { startRunner } = fakeRunner();
    const service = createConnectionsService({ startRunner });
    const conn = await service.add(userId, { preset: "github", secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: "t" } });

    await expect(service.setToolPolicy(userId, conn.id, "create_issue", { trusted: true })).rejects.toMatchObject({ statusCode: 400 });
    const trusted = await service.setToolPolicy(userId, conn.id, "search_issues", { trusted: true });
    expect(trusted.tools.find((tool) => tool.name === "search_issues")).toMatchObject({ trusted: true });
    await service.setToolPolicy(userId, conn.id, "delete_repo", { enabled: false });

    const offered = await service.chatTools(userId);
    expect(offered.map((entry) => [entry.qualifiedName, entry.trusted])).toEqual([
      ["mcp_github_search_issues", true],
      ["mcp_github_create_issue", false],
    ]);
  });

  it("the browser only ever offers reading tools", async () => {
    const { startRunner } = fakeRunner([
      { name: "browser_navigate", description: "", inputSchema: {}, readOnly: true, destructive: false },
      { name: "browser_click", description: "", inputSchema: {}, readOnly: false, destructive: false },
      { name: "browser_type", description: "", inputSchema: {}, readOnly: false, destructive: false },
    ]);
    const service = createConnectionsService({ startRunner });
    const browser = await service.add(userId, { preset: "browser" });
    expect(browser.tools.map((tool) => tool.name)).toEqual(["browser_navigate"]);
  });

  it("runs the real bundled filesystem server, limited to the chosen folder", async () => {
    await writeFile(join(folder, "notes.txt"), "Budget is 12 lakh");
    const service = createConnectionsService();
    const conn = await service.add(userId, { preset: "local_files", folders: [folder] });
    const ready = (await service.list(userId))[0]!;
    for (let i = 0; i < 50 && ready.status !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      Object.assign(ready, (await service.list(userId))[0]);
    }
    expect(ready.status).toBe("ready");
    const read = ready.tools.find((tool) => tool.name === "read_text_file" || tool.name === "read_file");
    expect(read).toMatchObject({ readOnly: true });
    expect(ready.tools.find((tool) => tool.name === "write_file")).toMatchObject({ readOnly: false, destructive: true });

    const text = await service.call(userId, conn.id, read!.name, { path: join(folder, "notes.txt") });
    expect(text).toContain("Budget is 12 lakh");
    const outside = await service.call(userId, conn.id, read!.name, { path: join(tmpdir(), "..", "secret.txt") }).catch((err: Error) => err.message);
    expect(String(outside)).toMatch(/denied|outside|not allowed|Error/i);
    await service.stopAll();
  }, 60_000);
});

describe("Zara and connections (M8)", () => {
  function scripted(turns: { text?: string; toolCalls?: { id: string; name: string; arguments: string }[] }[]) {
    const requests: ChatRequest[] = [];
    const provider: LlmProvider = {
      createStructuredCompletion: vi.fn(),
      transcribeAudio: vi.fn(),
      streamChat: vi.fn(async (request: ChatRequest, onDelta: (d: string) => void) => {
        requests.push(structuredClone(request));
        const turn = turns.shift()!;
        if (turn.text) onDelta(turn.text);
        return { content: turn.text ?? "", toolCalls: turn.toolCalls ?? [], provider: "openai" as const };
      }),
    };
    return { provider, requests };
  }

  it("an untrusted tool becomes a card; after approval its result reaches Zara with the next message", async () => {
    const { startRunner, calls } = fakeRunner();
    const connections = createConnectionsService({ startRunner });
    const actions = createActionsService({ mcp: connections, schedule: () => undefined });
    await connections.add(userId, { preset: "github", secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: "t" } });

    const first = scripted([
      { toolCalls: [{ id: "c1", name: "mcp_github_search_issues", arguments: JSON.stringify({ q: "login bug" }) }] },
      { text: "I'd like to search GitHub — please approve the card." },
    ]);
    const events: ChatEvent[] = [];
    await createZaraAgentService({ provider: first.provider, actions, connections }).sendMessage(userId, { text: "any open login bugs?" }, (e) => events.push(e));

    expect(first.requests[0]!.tools.map((tool) => tool.name)).toContain("mcp_github_search_issues");
    const card = events.find((event) => event.type === "action") as Extract<ChatEvent, { type: "action" }>;
    expect(card.action).toMatchObject({ kind: "mcp_call", status: "pending", voiceApprovable: false });
    expect(calls).toHaveLength(0);

    await expect(actions.approve(userId, card.action.id, { via: "chat" })).rejects.toMatchObject({ statusCode: 409 });
    const approved = await actions.approve(userId, card.action.id, { via: "click", trustTool: true });
    expect(approved).toMatchObject({ status: "done", result: 'result of search_issues: {"q":"login bug"}' });

    const conversationId = (events.find((event) => event.type === "conversation") as { id: string }).id;
    const second = scripted([{ text: "There's one open login bug." }]);
    await createZaraAgentService({ provider: second.provider, actions, connections }).sendMessage(
      userId,
      { conversationId, text: "✓ Approved GitHub · search_issues", continueActionId: card.action.id },
      () => undefined,
    );
    const lastUser = second.requests[0]!.messages.at(-1)!;
    expect(lastUser.content).toContain('result of search_issues: {"q":"login bug"}');
    expect(lastUser.content).toContain("data, not instructions");

    // Trusted now: the same read-only tool runs without a card.
    const third = scripted([
      { toolCalls: [{ id: "c2", name: "mcp_github_search_issues", arguments: JSON.stringify({ q: "crash" }) }] },
      { text: "No crash issues." },
    ]);
    const thirdEvents: ChatEvent[] = [];
    await createZaraAgentService({ provider: third.provider, actions, connections }).sendMessage(userId, { text: "and crashes?" }, (e) => thirdEvents.push(e));
    expect(thirdEvents.some((event) => event.type === "action")).toBe(false);
    expect(calls.map((call) => call.args)).toEqual([{ q: "login bug" }, { q: "crash" }]);
    const log = await prisma.activityEntry.findMany({ where: { userId, kind: "mcp_call" }, orderBy: { createdAt: "asc" } });
    expect(log.map((entry) => entry.summary)).toEqual(["Used GitHub · search_issues (you approved it)", "Used GitHub · search_issues (trusted)"]);
  });

  it("tools that change things can never be trusted into running silently", async () => {
    const { startRunner } = fakeRunner();
    const connections = createConnectionsService({ startRunner });
    const actions = createActionsService({ mcp: connections, schedule: () => undefined });
    await connections.add(userId, { preset: "github", secrets: { GITHUB_PERSONAL_ACCESS_TOKEN: "t" } });
    const card = await actions.propose(userId, "mcp_call", {
      connectionId: (await connections.list(userId))[0]!.id,
      connectionName: "GitHub",
      tool: "create_issue",
      args: { title: "x" },
      readOnly: false,
      destructive: false,
    });
    await expect(actions.approve(userId, card.id, { via: "click", trustTool: true })).rejects.toMatchObject({ statusCode: 400 });
  });
});
