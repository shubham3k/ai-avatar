import type { PrismaClient, RecallChunk } from "@prisma/client";
import { decodeVector, dot, encodeVector, reciprocalRankFusion } from "./vector.js";

export type RecallSourceType = "email" | "event" | "chat" | "memory" | "note" | "document";
export const RECALL_SOURCE_TYPES: RecallSourceType[] = ["email", "event", "chat", "memory", "note", "document"];

export interface NewChunk {
  chunkIndex: number;
  title: string;
  text: string;
  sourceDate: Date | null;
  url: string | null;
}

export interface RecallHit {
  id: string;
  sourceType: RecallSourceType;
  sourceId: string;
  title: string;
  text: string;
  sourceDate: Date | null;
  url: string | null;
  score: number;
}

const CANDIDATES = 40;

/**
 * FTS5 keyword index kept in sync with RecallChunk by triggers. Created at
 * runtime (IF NOT EXISTS), outside Prisma migrations — Prisma would try to
 * drop a virtual table it doesn't know about. If the SQLite build lacks
 * FTS5, keyword search falls back to LIKE.
 */
const FTS_SETUP = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS "RecallChunkFts" USING fts5(title, text, content='RecallChunk', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER IF NOT EXISTS "RecallChunk_ai" AFTER INSERT ON "RecallChunk" BEGIN
     INSERT INTO "RecallChunkFts"(rowid, title, text) VALUES (new.rowid, new.title, new.text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS "RecallChunk_ad" AFTER DELETE ON "RecallChunk" BEGIN
     INSERT INTO "RecallChunkFts"("RecallChunkFts", rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS "RecallChunk_au" AFTER UPDATE OF title, text ON "RecallChunk" BEGIN
     INSERT INTO "RecallChunkFts"("RecallChunkFts", rowid, title, text) VALUES ('delete', old.rowid, old.title, old.text);
     INSERT INTO "RecallChunkFts"(rowid, title, text) VALUES (new.rowid, new.title, new.text);
   END`,
];

/** Words → a safe FTS5 query: each word quoted (no operators from user text), OR-ed, prefix-matched. */
export function toFtsQuery(query: string): string | null {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).filter((word) => word.length >= 2).slice(0, 12);
  if (words.length === 0) return null;
  return words.map((word) => `"${word}"*`).join(" OR ");
}

export function createRecallStore(prisma: PrismaClient) {
  let ftsReady: Promise<boolean> | null = null;

  function ensureFts(): Promise<boolean> {
    ftsReady ??= (async () => {
      try {
        for (const statement of FTS_SETUP) await prisma.$executeRawUnsafe(statement);
        // Chunks written before the index existed (or by a build without it).
        const [row] = await prisma.$queryRawUnsafe<{ indexed: bigint }[]>(`SELECT count(*) AS indexed FROM "RecallChunkFts"`);
        const total = await prisma.recallChunk.count();
        if (Number(row?.indexed ?? 0) !== total) await prisma.$executeRawUnsafe(`INSERT INTO "RecallChunkFts"("RecallChunkFts") VALUES ('rebuild')`);
        return true;
      } catch {
        return false;
      }
    })();
    return ftsReady;
  }

  function toHit(row: RecallChunk, score: number): RecallHit {
    return {
      id: row.id,
      sourceType: row.sourceType as RecallSourceType,
      sourceId: row.sourceId,
      title: row.title,
      text: row.text,
      sourceDate: row.sourceDate,
      url: row.url,
      score,
    };
  }

  async function keywordRanking(userId: string, query: string, types: RecallSourceType[]): Promise<string[]> {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    const typeList = types.map((type) => `'${type}'`).join(",");
    if (await ensureFts()) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT c.id AS id FROM "RecallChunkFts" f JOIN "RecallChunk" c ON c.rowid = f.rowid
           WHERE "RecallChunkFts" MATCH ? AND c.userId = ? AND c.sourceType IN (${typeList})
           ORDER BY bm25("RecallChunkFts", 2.0, 1.0) LIMIT ${CANDIDATES}`,
          fts,
          userId,
        );
        return rows.map((row) => row.id);
      } catch {
        // Fall through to LIKE.
      }
    }
    const words = (query.match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).filter((word) => word.length >= 3).slice(0, 5);
    if (words.length === 0) return [];
    const rows = await prisma.recallChunk.findMany({
      where: { userId, sourceType: { in: types }, OR: words.map((word) => ({ text: { contains: word } })) },
      select: { id: true },
      take: CANDIDATES,
    });
    return rows.map((row) => row.id);
  }

  return {
    ensureFts,

    /** sourceId → contentHash for everything indexed of one type. */
    async indexedHashes(userId: string, sourceType: RecallSourceType): Promise<Map<string, string>> {
      const rows = await prisma.recallChunk.findMany({
        where: { userId, sourceType, chunkIndex: 0 },
        select: { sourceId: true, contentHash: true },
      });
      return new Map(rows.map((row) => [row.sourceId, row.contentHash]));
    },

    /** Replaces a source's chunks (embeddings are filled in separately). */
    async replaceSource(userId: string, sourceType: RecallSourceType, sourceId: string, contentHash: string, chunks: NewChunk[]) {
      await ensureFts();
      await prisma.$transaction([
        prisma.recallChunk.deleteMany({ where: { userId, sourceType, sourceId } }),
        prisma.recallChunk.createMany({
          data: chunks.map((chunk) => ({ userId, sourceType, sourceId, contentHash, ...chunk })),
        }),
      ]);
    },

    async removeSources(userId: string, sourceType: RecallSourceType, sourceIds: string[]) {
      if (sourceIds.length === 0) return;
      await ensureFts();
      await prisma.recallChunk.deleteMany({ where: { userId, sourceType, sourceId: { in: sourceIds } } });
    },

    async unembedded(userId: string, limit: number) {
      return prisma.recallChunk.findMany({
        where: { userId, embedding: null },
        select: { id: true, title: true, text: true },
        take: limit,
      });
    },

    async setEmbedding(id: string, vector: Float32Array) {
      await prisma.recallChunk.update({ where: { id }, data: { embedding: encodeVector(vector) } });
    },

    async counts(userId: string) {
      const [bySource, embedded] = await Promise.all([
        prisma.recallChunk.groupBy({ by: ["sourceType"], where: { userId, chunkIndex: 0 }, _count: true }),
        prisma.recallChunk.count({ where: { userId, embedding: { not: null } } }),
      ]);
      const total = await prisma.recallChunk.count({ where: { userId } });
      return {
        sources: Object.fromEntries(bySource.map((row) => [row.sourceType, row._count])) as Partial<Record<RecallSourceType, number>>,
        chunks: total,
        embedded,
      };
    },

    /**
     * Hybrid search: keyword matches (FTS5) and meaning matches (cosine over
     * local embeddings), merged by reciprocal-rank fusion. Works with
     * keywords alone while the model is still downloading.
     */
    async search(
      userId: string,
      query: string,
      options: {
        types: RecallSourceType[];
        queryVector: Float32Array | null;
        limit: number;
        /** e5 similarities sit high even for unrelated text; below this, a meaning match is noise. */
        minSimilarity: number;
      },
    ): Promise<RecallHit[]> {
      const keyword = await keywordRanking(userId, query, options.types);
      let semantic: string[] = [];
      if (options.queryVector) {
        const rows = await prisma.recallChunk.findMany({
          where: { userId, sourceType: { in: options.types }, embedding: { not: null } },
          select: { id: true, embedding: true },
        });
        semantic = rows
          .map((row) => ({ id: row.id, score: dot(options.queryVector!, decodeVector(row.embedding!)) }))
          .filter((row) => row.score >= options.minSimilarity)
          .sort((a, b) => b.score - a.score)
          .slice(0, CANDIDATES)
          .map((row) => row.id);
      }
      const fused = [...reciprocalRankFusion([keyword, semantic])].sort((a, b) => b[1] - a[1]).slice(0, options.limit);
      if (fused.length === 0) return [];
      const rows = await prisma.recallChunk.findMany({ where: { id: { in: fused.map(([id]) => id) } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return fused.flatMap(([id, score]) => {
        const row = byId.get(id);
        return row ? [toHit(row, score)] : [];
      });
    },

    async chunk(userId: string, id: string) {
      return prisma.recallChunk.findFirst({ where: { id, userId } });
    },
  };
}

export type RecallStore = ReturnType<typeof createRecallStore>;
