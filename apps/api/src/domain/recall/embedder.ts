import { join } from "node:path";

/**
 * ADR-006 §7: meaning-based search runs on the user's PC with a small
 * multilingual model (English, Hindi, Hinglish) — no text is sent anywhere
 * to be embedded. The model (~120 MB) is downloaded once on first use into
 * RECALL_MODEL_DIR (the desktop points this at its app-data folder) and
 * runs through ONNX Runtime on the CPU.
 */
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const EMBEDDING_DIMENSIONS = 384;
const BATCH_SIZE = 16;

export type EmbedKind = "query" | "passage";

export type EmbedderState = "idle" | "loading" | "ready" | "failed";

export interface Embedder {
  /** L2-normalised vectors, one per text. */
  embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]>;
  state(): EmbedderState;
  /** Why loading failed (e.g. offline on first use), if it did. */
  error(): string | null;
}

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

export function defaultModelDir(): string {
  return process.env.RECALL_MODEL_DIR || join(process.cwd(), ".cache", "models");
}

/**
 * Loads the model lazily on the first embed() call. A failed load (e.g. no
 * internet the first time) is retried on the next call after a minute —
 * keyword search keeps working meanwhile.
 */
export function createLocalEmbedder(options?: { modelDir?: string }): Embedder {
  let extractor: Extractor | null = null;
  let loading: Promise<Extractor> | null = null;
  let state: EmbedderState = "idle";
  let lastError: string | null = null;
  let failedAt = 0;

  async function load(): Promise<Extractor> {
    if (extractor) return extractor;
    // Tests set this so the suite never downloads the model.
    if (process.env.RECALL_DISABLE_EMBEDDINGS === "1") {
      state = "failed";
      lastError = "Local search model disabled.";
      throw new Error(lastError);
    }
    if (state === "failed" && Date.now() - failedAt < 60_000) throw new Error(lastError ?? "Search model unavailable.");
    loading ??= (async () => {
      state = "loading";
      try {
        const transformers = await import("@huggingface/transformers");
        transformers.env.cacheDir = options?.modelDir ?? defaultModelDir();
        transformers.env.allowRemoteModels = true;
        const pipe = await transformers.pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
        extractor = pipe as unknown as Extractor;
        state = "ready";
        lastError = null;
        return extractor;
      } catch (err) {
        state = "failed";
        failedAt = Date.now();
        lastError = err instanceof Error ? err.message.slice(0, 200) : "Search model failed to load.";
        throw err;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  return {
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      const run = await load();
      const vectors: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        // e5 models are trained with these prefixes.
        const batch = texts.slice(i, i + BATCH_SIZE).map((text) => `${kind}: ${text}`);
        const output = await run(batch, { pooling: "mean", normalize: true });
        for (const row of output.tolist()) vectors.push(Float32Array.from(row));
      }
      return vectors;
    },
    state: () => state,
    error: () => lastError,
  };
}

/**
 * Deterministic stand-in for tests: hashed bag of words, normalised — texts
 * sharing words get similar vectors. Never used by the app itself.
 */
export function createHashingEmbedder(dimensions = 64): Embedder {
  return {
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(dimensions);
        for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
          let hash = 0;
          for (const ch of word) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
          const slot = hash % dimensions;
          vector[slot] = (vector[slot] ?? 0) + 1;
        }
        const norm = Math.hypot(...vector) || 1;
        return vector.map((value) => value / norm);
      });
    },
    state: () => "ready",
    error: () => null,
  };
}
