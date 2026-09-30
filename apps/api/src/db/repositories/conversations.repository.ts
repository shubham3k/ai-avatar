import type { ChatMessage, Conversation, PrismaClient } from "@prisma/client";

export interface ConversationsRepository {
  create(userId: string, title: string): Promise<Conversation>;
  /** Most recently active first. */
  list(userId: string, limit: number): Promise<Conversation[]>;
  find(userId: string, id: string): Promise<Conversation | null>;
  addMessage(input: {
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    provider?: string | null;
  }): Promise<ChatMessage>;
  /** The latest `limit` messages, oldest first (ready to replay to the model). */
  recentMessages(conversationId: string, limit: number): Promise<ChatMessage[]>;
  allMessages(conversationId: string): Promise<ChatMessage[]>;
}

export function createConversationsRepository(prisma: PrismaClient): ConversationsRepository {
  return {
    create(userId, title) {
      return prisma.conversation.create({ data: { userId, title } });
    },
    list(userId, limit) {
      return prisma.conversation.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: limit });
    },
    find(userId, id) {
      return prisma.conversation.findFirst({ where: { id, userId } });
    },
    async addMessage(input) {
      const [message] = await prisma.$transaction([
        prisma.chatMessage.create({
          data: {
            conversationId: input.conversationId,
            role: input.role,
            content: input.content,
            provider: input.provider ?? null,
          },
        }),
        // Bump the conversation so history lists it as most recent.
        prisma.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }),
      ]);
      return message;
    },
    async recentMessages(conversationId, limit) {
      const latest = await prisma.chatMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return latest.reverse();
    },
    allMessages(conversationId) {
      return prisma.chatMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
    },
  };
}
