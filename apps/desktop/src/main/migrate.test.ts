import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { resolveApiRoot } from "./api-location.js";
import { runMigrations } from "./migrate.js";

/** The real apps/api directory (this repo's own dev layout) — good enough to resolve a real schema.prisma/prisma CLI without mocking the filesystem. */
const apiRoot = resolveApiRoot({ isPackaged: false, resourcesPath: "irrelevant" });

/** A fake child_process.ChildProcess: just enough for migrate.ts's listeners. */
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("runMigrations", () => {
  it("spawns the prisma CLI with 'migrate deploy' against the api package's schema", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);

    const promise = runMigrations({ apiRoot, databaseUrl: "file:./dev.db", spawnFn: spawnFn as never });
    queueMicrotask(() => child.emit("exit", 0));
    await promise;

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnFn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(
      expect.arrayContaining(["migrate", "deploy", "--schema", expect.stringContaining("schema.prisma")]),
    );
    expect(args[0]).toContain("prisma");
    expect(opts.env.DATABASE_URL).toBe("file:./dev.db");
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(opts.cwd).toEqual(expect.stringContaining("api"));
  });

  it("falls back to process.env.DATABASE_URL, then the apps/api default, when none is passed", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);

    const promise = runMigrations({ apiRoot, spawnFn: spawnFn as never });
    queueMicrotask(() => child.emit("exit", 0));
    await promise;

    const [, , opts] = spawnFn.mock.calls[0];
    expect(opts.env.DATABASE_URL).toBe(process.env.DATABASE_URL ?? "file:./dev.db");
  });

  it("resolves when the prisma CLI exits 0 (including 'no pending migrations')", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);

    const promise = runMigrations({ apiRoot, spawnFn: spawnFn as never });
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("No pending migrations to apply."));
      child.emit("exit", 0);
    });

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with the captured output when the prisma CLI exits non-zero", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);

    const promise = runMigrations({ apiRoot, spawnFn: spawnFn as never });
    queueMicrotask(() => {
      child.stderr.emit("data", Buffer.from("P3009 migration failed"));
      child.emit("exit", 1);
    });

    await expect(promise).rejects.toThrow(/P3009 migration failed/);
  });

  it("rejects if the process fails to spawn at all", async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);

    const promise = runMigrations({ apiRoot, spawnFn: spawnFn as never });
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));

    await expect(promise).rejects.toThrow(/Failed to start database migration/);
  });
});
