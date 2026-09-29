import type { ChatMessage, PrismaClient } from "@prisma/client";
import {
  createConversationsRepository,
  type ConversationsRepository,
} from "../../db/repositories/conversations.repository.js";
import { notFoundError } from "../../lib/errors.js";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import {
  classifyLlmFailure,
  type ChatTurnMessage,
  type LlmProvider,
  type LlmProviderName,
  type ToolCall,
} from "../../providers/llm/llm-provider.js";
import { providerFailureMessage, type ProviderFailureCode } from "../llm-failure-messages.js";
import { createDefaultLlmProvider } from "../llm-usage.service.js";
import { createReminderParsingService, type ReminderParsingService } from "../reminder-parsing.service.js";
import { createActivityService, type ActivityService } from "../activity/activity.service.js";
import { createMemoryService, MEMORY_CONTEXT_LIMIT, type MemoryService } from "../memory/memory.service.js";
import { buildZaraSystemPrompt } from "./zara-prompt.js";
import { findTool, MEMORY_WRITE_TOOLS, ZARA_TOOLS, type ToolContext } from "./zara-tools.js";

/** Streamed to the desktop app as Server-Sent Events. */
export type ChatEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessageDto }
  | { type: "error"; message: string };

export interface ChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** "groq" marks a reply produced by the fallback provider. */
  provider: LlmProviderName | null;
  createdAt: string;
}

export function toChatMessageDto(message: ChatMessage): ChatMessageDto {
  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
    provider: message.provider === "openai" || message.provider === "groq" ? message.provider : null,
    createdAt: message.createdAt.toISOString(),
  };
}

/** How many past messages are replayed to the model each turn. */
export const HISTORY_LIMIT = 20;
/** Upper bound on model turns per user message (tool call → result → …). */
export const MAX_AGENT_STEPS = 5;
const TITLE_MAX_LENGTH = 48;
const EMPTY_REPLY = "Sorry — I couldn't come up with an answer. Please try again.";
const STEP_LIMIT_REPLY = "Sorry — that took more steps than I can handle at once. Could you ask a simpler question?";

export function conversationTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX_LENGTH ? `${oneLine.slice(0, TITLE_MAX_LENGTH - 1)}…` : oneLine;
}

/** Runs one tool call; always returns a JSON string for the model, never throws. */
async function executeToolCall(
  call: ToolCall,
  context: ToolContext,
  emit: (event: ChatEvent) => void,
): Promise<string> {
  const tool = findTool(call.name);
  if (!tool) return JSON.stringify({ error: `Unknown tool "${call.name}".` });

  let rawArgs: unknown;
  try {
    rawArgs = call.arguments.trim() === "" ? {} : JSON.parse(call.arguments);
  } catch {
    return JSON.stringify({ error: "Arguments were not valid JSON." });
  }
  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    return JSON.stringify({ error: "Invalid arguments.", issues: parsed.error.issues.map((issue) => issue.message) });
  }

  emit({ type: "status", text: tool.status });
  try {
    return JSON.stringify(await tool.run(parsed.data, context));
  } catch {
    return JSON.stringify({ error: "The tool failed. Tell the user you couldn't get that information right now." });
  }
}

/**
 * Zara's agent loop (ADR-006, M2): model turn → Zod-validated tool calls →
 * results fed back → … until the model answers. Text streams to the user as
 * it's generated. Only the user's message and Zara's final reply are
 * stored; tool traffic is transient.
 */
export function createZaraAgentService(dependencies?: {
  provider?: LlmProvider;
  conversations?: ConversationsRepository;
  prisma?: PrismaClient;
  reminderParser?: ReminderParsingService;
  memory?: MemoryService;
  activity?: ActivityService;
}) {
  const prisma = dependencies?.prisma ?? defaultPrisma;
  const memory = dependencies?.memory ?? createMemoryService({ prisma });
  const activity = dependencies?.activity ?? createActivityService({ prisma });
  const provider = dependencies?.provider ?? createDefaultLlmProvider();
  const conversations = dependencies?.conversations ?? createConversationsRepository(prisma);
  const reminderParser = dependencies?.reminderParser ?? createReminderParsingService({ provider });
  const toolDefinitions = ZARA_TOOLS.map((tool) => tool.definition);

  return {
    async sendMessage(
      userId: string,
      request: {
        conversationId?: string | undefined;
        text: string;
        /** Incognito (M3): nothing is stored and nothing is learned; the client supplies the history. */
        incognito?: boolean | undefined;
        history?: { role: "user" | "assistant"; content: string }[] | undefined;
      },
      emit: (event: ChatEvent) => void,
      now: Date = new Date(),
    ): Promise<void> {
      const text = request.text.trim();
      const incognito = request.incognito === true;

      let conversationId = incognito ? undefined : request.conversationId;
      let history: { role: string; content: string }[] = [];
      if (incognito) {
        history = (request.history ?? []).slice(-HISTORY_LIMIT);
      } else if (conversationId) {
        const existing = await conversations.find(userId, conversationId);
        if (!existing) throw notFoundError("Conversation not found.");
        history = await conversations.recentMessages(conversationId, HISTORY_LIMIT);
      } else {
        const created = await conversations.create(userId, conversationTitle(text));
        conversationId = created.id;
        emit({ type: "conversation", id: created.id, title: created.title });
      }

      if (conversationId) await conversations.addMessage({ conversationId, role: "user", content: text });

      const facts = await memory.list(userId, MEMORY_CONTEXT_LIMIT);
      const messages: ChatTurnMessage[] = [
        { role: "system", content: buildZaraSystemPrompt(now, facts, { incognito }) },
        ...history.map((message): ChatTurnMessage =>
          message.role === "assistant"
            ? { role: "assistant", content: message.content }
            : { role: "user", content: message.content },
        ),
        { role: "user", content: text },
      ];

      let answeredBy: LlmProviderName | null = null;
      const context: ToolContext = {
        prisma,
        userId,
        now,
        turnState: new Map(),
        parseReminder: (reminderText, at) => reminderParser.parse(reminderText, at),
        memory,
        incognito,
        // Logged with whichever provider was answering when Zara acted.
        recordActivity: (entry) => activity.record(userId, { ...entry, provider: answeredBy }),
      };
      const tools = incognito
        ? toolDefinitions.filter((tool) => !MEMORY_WRITE_TOOLS.has(tool.name))
        : toolDefinitions;

      let reply = "";
      let finished = false;
      try {
        for (let step = 0; step < MAX_AGENT_STEPS && !finished; step += 1) {
          const result = await provider.streamChat(
            { messages, tools, maxOutputTokens: 800, operation: "chat" },
            (delta) => {
              reply += delta;
              emit({ type: "delta", text: delta });
            },
          );
          answeredBy = result.provider;
          if (result.toolCalls.length === 0) {
            finished = true;
            break;
          }
          messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
          for (const call of result.toolCalls) {
            messages.push({ role: "tool", toolCallId: call.id, content: await executeToolCall(call, context, emit) });
          }
        }
      } catch (err) {
        const kind = classifyLlmFailure(err);
        const code: ProviderFailureCode =
          kind === "not_configured" || kind === "auth_rejected" || kind === "model_unavailable"
            ? kind
            : "provider_error";
        emit({ type: "error", message: providerFailureMessage(code, err, "chat") });
        return;
      }

      // Always end with something the user can read: a step-limit note if the
      // model never finished, or an apology if it finished without any text.
      const closing = !finished ? STEP_LIMIT_REPLY : reply.trim() === "" ? EMPTY_REPLY : null;
      if (closing) {
        const addition = reply.trim() === "" ? closing : `\n\n${closing}`;
        reply += addition;
        emit({ type: "delta", text: addition });
      }

      if (!conversationId) {
        // Incognito: nothing is stored — hand back an unsaved message.
        emit({
          type: "done",
          message: {
            id: `incognito-${now.getTime()}`,
            role: "assistant",
            content: reply.trim(),
            provider: answeredBy,
            createdAt: new Date().toISOString(),
          },
        });
        return;
      }
      const saved = await conversations.addMessage({
        conversationId,
        role: "assistant",
        content: reply.trim(),
        provider: answeredBy,
      });
      emit({ type: "done", message: toChatMessageDto(saved) });
    },

    async deleteConversation(userId: string, conversationId: string): Promise<void> {
      const existing = await conversations.find(userId, conversationId);
      if (!existing) throw notFoundError("Conversation not found.");
      await prisma.conversation.delete({ where: { id: conversationId } });
    },

    async deleteAllConversations(userId: string): Promise<number> {
      return (await prisma.conversation.deleteMany({ where: { userId } })).count;
    },

    async listConversations(userId: string) {
      const rows = await conversations.list(userId, 50);
      return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() }));
    },

    async getMessages(userId: string, conversationId: string): Promise<ChatMessageDto[]> {
      const existing = await conversations.find(userId, conversationId);
      if (!existing) throw notFoundError("Conversation not found.");
      return (await conversations.allMessages(conversationId)).map(toChatMessageDto);
    },
  };
}

export type ZaraAgentService = ReturnType<typeof createZaraAgentService>;
