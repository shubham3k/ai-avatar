import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { startEmbeddedApiServer } from "./api-server.js";

const listen = vi.fn();
const close = vi.fn().mockResolvedValue(undefined);
const address = vi.fn();

const buildApp = vi.fn(() => ({
  listen,
  close,
  server: { address },
}));

function makeImportApiModule() {
  return vi.fn().mockResolvedValue({ buildApp });
}

describe("startEmbeddedApiServer", () => {
  it("imports <apiRoot>/dist/app.js by file URL, not the bare package specifier", async () => {
    listen.mockResolvedValue(undefined);
    address.mockReturnValue({ port: 54321, address: "127.0.0.1", family: "IPv4" });
    const importApiModule = makeImportApiModule();

    await startEmbeddedApiServer({ apiRoot: "C:\\resources\\api", importApiModule });

    const [calledUrl] = importApiModule.mock.calls[0];
    expect(calledUrl).toBe(pathToFileURL("C:\\resources\\api\\dist\\app.js").href);
  });

  it("listens on the fixed default port (4000) — required for Google OAuth's registered redirect URI to match — and resolves the URL from the bound address", async () => {
    listen.mockResolvedValue(undefined);
    address.mockReturnValue({ port: 4000, address: "127.0.0.1", family: "IPv4" });

    const server = await startEmbeddedApiServer({
      apiRoot: "C:\\resources\\api",
      importApiModule: makeImportApiModule(),
    });

    expect(listen).toHaveBeenCalledWith({ port: 4000, host: "127.0.0.1" });
    expect(server.url).toBe("http://127.0.0.1:4000");
  });

  it("accepts an explicit port override", async () => {
    listen.mockResolvedValue(undefined);
    address.mockReturnValue({ port: 4321, address: "127.0.0.1", family: "IPv4" });

    await startEmbeddedApiServer({
      apiRoot: "C:\\resources\\api",
      importApiModule: makeImportApiModule(),
      port: 4321,
    });

    expect(listen).toHaveBeenCalledWith({ port: 4321, host: "127.0.0.1" });
  });

  it("closes the underlying Fastify instance when close() is called", async () => {
    listen.mockResolvedValue(undefined);
    address.mockReturnValue({ port: 54321, address: "127.0.0.1", family: "IPv4" });

    const server = await startEmbeddedApiServer({
      apiRoot: "C:\\resources\\api",
      importApiModule: makeImportApiModule(),
    });
    await server.close();

    expect(close).toHaveBeenCalled();
  });

  it("closes the server and throws if the bound address has no port", async () => {
    listen.mockResolvedValue(undefined);
    address.mockReturnValue(null);

    await expect(
      startEmbeddedApiServer({ apiRoot: "C:\\resources\\api", importApiModule: makeImportApiModule() }),
    ).rejects.toThrow(/port/i);
    expect(close).toHaveBeenCalled();
  });

  it("propagates a listen() failure (e.g. missing required env config)", async () => {
    listen.mockRejectedValue(new Error("ENCRYPTION_KEY is not configured"));

    await expect(
      startEmbeddedApiServer({ apiRoot: "C:\\resources\\api", importApiModule: makeImportApiModule() }),
    ).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});
