/**
 * ADR-006 M6: long text (documents, notes, email bodies) is split into
 * overlapping chunks so a search hit points at the relevant part, and only
 * that part is ever shown to the AI.
 */
export const CHUNK_TARGET_CHARS = 900;
export const CHUNK_OVERLAP_CHARS = 150;
/** Keeps one enormous file from flooding the index. */
export const MAX_CHUNKS_PER_SOURCE = 200;

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits on paragraph, then sentence boundaries where possible; chunks
 * overlap slightly so a sentence cut at a boundary is still found.
 */
export function chunkText(raw: string, target = CHUNK_TARGET_CHARS, overlap = CHUNK_OVERLAP_CHARS): string[] {
  const text = normalize(raw);
  if (!text) return [];
  if (text.length <= target) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS_PER_SOURCE) {
    let end = Math.min(start + target, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("। "), window.lastIndexOf("\n"));
      if (breakAt > target * 0.5) end = start + breakAt + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
