/** Embeddings are stored as little-endian float32 BLOBs (384 floats ≈ 1.5 KB per chunk). */
export function encodeVector(vector: Float32Array | number[]): Buffer {
  const array = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

export function decodeVector(blob: Uint8Array): Float32Array {
  // Copy: the Buffer's offset may not be 4-byte aligned.
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}

/** Vectors are L2-normalised when created, so cosine similarity is a dot product. */
export function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

/**
 * Reciprocal-rank fusion: merges the keyword ranking and the meaning
 * ranking without having to compare their very different scores.
 */
export function reciprocalRankFusion(rankings: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  return scores;
}
