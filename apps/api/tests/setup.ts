import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";

// Tests must never run against the real development database — an earlier
// session accidentally wiped real synced Gmail/Calendar data by running the
// suite against the shared dev DB. `.env.test` (isolated DATABASE_URL,
// intentionally blank Google/Groq credentials) always takes priority over
// `.env` here, and is required — tests refuse to start without it.
let dir = process.cwd();
let envTestFile: string | undefined;
for (let depth = 0; depth < 6; depth += 1) {
  const candidate = join(dir, ".env.test");
  if (existsSync(candidate)) {
    envTestFile = candidate;
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

if (!envTestFile) {
  throw new Error(
    "No .env.test found. Tests require an isolated test database " +
      "(DATABASE_URL pointing at e.g. file:./test.db, not the real dev DB) " +
      "— see apps/api/.env.test. Refusing to fall back to the shared .env.",
  );
}

config({ path: envTestFile, override: true });

// Phase 4.1 (SQLite): DATABASE_URL is now a `file:` path rather than a
// Postgres connection string — same safety intent, adjusted check: it must
// look like a SQLite file containing "test" in its name, and must not be
// the dev database file.
const testDbUrl = process.env.DATABASE_URL ?? "";
const looksLikeTestSqliteFile = /^file:.*test.*\.db$/i.test(testDbUrl);
if (!looksLikeTestSqliteFile || testDbUrl.includes("dev.db")) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL from .env.test does not look like an ` +
      `isolated SQLite test database (expected a "file:" path containing "test" ` +
      `in its filename, not the dev database): ${testDbUrl}`,
  );
}

process.env.NODE_ENV = "test";

// ADR-006 M6: tests never download the local search model and never create
// folders in the real Documents folder.
process.env.RECALL_DISABLE_EMBEDDINGS = "1";
process.env.ZARA_DOCUMENTS_FOLDER = join(tmpdir(), `zara-test-docs-${process.pid}`);
