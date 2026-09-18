import type { Email as PrismaEmail, PrismaClient } from "@prisma/client";
import { decodeStringArray, encodeStringArray } from "../../lib/json-array.js";

/** Domain-facing shape — `toEmails`/`labels` are real arrays, unlike the raw DB row. */
export type Email = Omit<PrismaEmail, "toEmails" | "labels"> & {
  toEmails: string[];
  labels: string[];
};

function toDomain(row: PrismaEmail): Email {
  return {
    ...row,
    toEmails: decodeStringArray(row.toEmails),
    labels: decodeStringArray(row.labels),
  };
}

export interface UpsertEmailInput {
  userId: string;
  providerMessageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  subject: string;
  snippet: string | null;
  receivedAt: Date;
  isRead: boolean;
  labels: string[];
  sourceUrl: string | null;
  rawUpdatedAt: Date;
}

export interface UpsertEmailResult {
  email: Email;
  created: boolean;
}

export interface SyncTally {
  created: number;
  updated: number;
}

export interface EmailsRepository {
  upsertEmail(input: UpsertEmailInput): Promise<UpsertEmailResult>;
  upsertMany(inputs: UpsertEmailInput[]): Promise<SyncTally>;
  findByProviderMessageId(
    userId: string,
    providerMessageId: string,
  ): Promise<Email | null>;
  listRecent(userId: string, limit: number): Promise<Email[]>;
}

export function createEmailsRepository(prisma: PrismaClient): EmailsRepository {
  async function upsertEmail(input: UpsertEmailInput): Promise<UpsertEmailResult> {
    const existing = await prisma.email.findUnique({
      where: {
        userId_providerMessageId: {
          userId: input.userId,
          providerMessageId: input.providerMessageId,
        },
      },
    });

    const fields = {
      threadId: input.threadId,
      fromEmail: input.fromEmail,
      fromName: input.fromName,
      toEmails: encodeStringArray(input.toEmails),
      subject: input.subject,
      snippet: input.snippet,
      receivedAt: input.receivedAt,
      isRead: input.isRead,
      labels: encodeStringArray(input.labels),
      sourceUrl: input.sourceUrl,
      rawUpdatedAt: input.rawUpdatedAt,
    };

    if (existing) {
      const email = await prisma.email.update({
        where: { id: existing.id },
        data: fields,
      });
      return { email: toDomain(email), created: false };
    }

    const email = await prisma.email.create({
      data: {
        userId: input.userId,
        providerMessageId: input.providerMessageId,
        ...fields,
      },
    });
    return { email: toDomain(email), created: true };
  }

  async function upsertMany(inputs: UpsertEmailInput[]): Promise<SyncTally> {
    let created = 0;
    let updated = 0;
    for (const input of inputs) {
      const result = await upsertEmail(input);
      if (result.created) created += 1;
      else updated += 1;
    }
    return { created, updated };
  }

  return {
    upsertEmail,
    upsertMany,

    async findByProviderMessageId(userId, providerMessageId) {
      const row = await prisma.email.findUnique({
        where: { userId_providerMessageId: { userId, providerMessageId } },
      });
      return row ? toDomain(row) : null;
    },

    async listRecent(userId, limit) {
      const rows = await prisma.email.findMany({
        where: { userId },
        orderBy: { receivedAt: "desc" },
        take: limit,
      });
      return rows.map(toDomain);
    },
  };
}
