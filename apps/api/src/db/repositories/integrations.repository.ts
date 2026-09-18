import type { Integration as PrismaIntegration, PrismaClient } from "@prisma/client";
import { decodeStringArray, encodeStringArray } from "../../lib/json-array.js";

// SQLite has no native enum support (Phase 4.1) — was a Prisma-generated
// enum type before; now just the one value this app actually uses.
export type IntegrationProvider = "google";

/** Domain-facing shape — `scopes` is a real array, unlike the raw DB row. */
export type Integration = Omit<PrismaIntegration, "scopes"> & { scopes: string[] };

function toDomain(row: PrismaIntegration): Integration {
  return { ...row, scopes: decodeStringArray(row.scopes) };
}

export interface UpsertGoogleIntegrationInput {
  userId: string;
  providerAccountId: string;
  providerAccountEmail: string | null;
  refreshTokenEncrypted: string;
  accessTokenEncrypted: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export interface IntegrationsRepository {
  findByUserAndProvider(
    userId: string,
    provider: IntegrationProvider,
  ): Promise<Integration | null>;
  upsertGoogle(input: UpsertGoogleIntegrationInput): Promise<Integration>;
  disable(userId: string, provider: IntegrationProvider): Promise<Integration | null>;
}

export function createIntegrationsRepository(
  prisma: PrismaClient,
): IntegrationsRepository {
  return {
    async findByUserAndProvider(userId, provider) {
      const row = await prisma.integration.findUnique({
        where: { userId_provider: { userId, provider } },
      });
      return row ? toDomain(row) : null;
    },

    async upsertGoogle(input) {
      const shared = {
        status: "connected" as const,
        providerAccountId: input.providerAccountId,
        providerAccountEmail: input.providerAccountEmail,
        refreshTokenEncrypted: input.refreshTokenEncrypted,
        accessTokenEncrypted: input.accessTokenEncrypted,
        expiresAt: input.expiresAt,
        scopes: encodeStringArray(input.scopes),
      };
      const row = await prisma.integration.upsert({
        where: { userId_provider: { userId: input.userId, provider: "google" } },
        create: {
          userId: input.userId,
          provider: "google",
          ...shared,
        },
        update: shared,
      });
      return toDomain(row);
    },

    async disable(userId, provider) {
      const existing = await prisma.integration.findUnique({
        where: { userId_provider: { userId, provider } },
      });
      if (!existing) return null;
      const row = await prisma.integration.update({
        where: { userId_provider: { userId, provider } },
        data: { status: "disabled" },
      });
      return toDomain(row);
    },
  };
}
