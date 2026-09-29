import type { MemoryFact, PrismaClient } from "@prisma/client";
import { notFoundError, validationError } from "../../lib/errors.js";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { containsSensitive } from "../privacy/redaction.js";

export const MEMORY_CATEGORIES = ["about_you", "people", "preferences", "other"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export const MEMORY_FACT_MAX_LENGTH = 300;
/** How many facts go into Zara's context each turn (most recently updated first). */
export const MEMORY_CONTEXT_LIMIT = 60;

export interface MemoryFactDto {
  id: string;
  content: string;
  category: MemoryCategory;
  updatedAt: string;
}

function toDto(fact: MemoryFact): MemoryFactDto {
  const category = (MEMORY_CATEGORIES as readonly string[]).includes(fact.category)
    ? (fact.category as MemoryCategory)
    : "other";
  return { id: fact.id, content: fact.content, category, updatedAt: fact.updatedAt.toISOString() };
}

function normalizeContent(content: string): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (!trimmed) throw validationError("A memory can't be empty.");
  if (trimmed.length > MEMORY_FACT_MAX_LENGTH) {
    throw validationError(`A memory must be ${MEMORY_FACT_MAX_LENGTH} characters or fewer.`);
  }
  // ADR-006 §1: sensitive details are never stored in memory.
  if (containsSensitive(trimmed)) {
    throw validationError("That looks like sensitive information (a password, code, or ID number) — it won't be saved.");
  }
  return trimmed;
}

/** Zara's long-term memory (ADR-006 §4): lasting facts, all local, all user-editable. */
export function createMemoryService(dependencies?: { prisma?: PrismaClient }) {
  const prisma = dependencies?.prisma ?? defaultPrisma;

  async function owned(userId: string, id: string): Promise<MemoryFact> {
    const fact = await prisma.memoryFact.findFirst({ where: { id, userId } });
    if (!fact) throw notFoundError("Memory not found.");
    return fact;
  }

  return {
    async list(userId: string, limit = 500): Promise<MemoryFactDto[]> {
      const facts = await prisma.memoryFact.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: limit });
      return facts.map(toDto);
    },

    /** Saves a fact; an identical existing fact (ignoring case) is returned instead of duplicated. */
    async save(userId: string, content: string, category: MemoryCategory): Promise<{ fact: MemoryFactDto; created: boolean }> {
      const normalized = normalizeContent(content);
      const existing = await prisma.memoryFact.findMany({ where: { userId } });
      const duplicate = existing.find((fact) => fact.content.toLowerCase() === normalized.toLowerCase());
      if (duplicate) return { fact: toDto(duplicate), created: false };
      const fact = await prisma.memoryFact.create({ data: { userId, content: normalized, category } });
      return { fact: toDto(fact), created: true };
    },

    async update(userId: string, id: string, content: string): Promise<{ fact: MemoryFactDto; previousContent: string }> {
      const current = await owned(userId, id);
      const fact = await prisma.memoryFact.update({ where: { id }, data: { content: normalizeContent(content) } });
      return { fact: toDto(fact), previousContent: current.content };
    },

    async delete(userId: string, id: string): Promise<MemoryFactDto> {
      const fact = await owned(userId, id);
      await prisma.memoryFact.delete({ where: { id } });
      return toDto(fact);
    },

    async deleteAll(userId: string): Promise<number> {
      return (await prisma.memoryFact.deleteMany({ where: { userId } })).count;
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
