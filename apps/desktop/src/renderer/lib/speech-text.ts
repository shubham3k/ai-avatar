/**
 * ADR-006 M4: Zara starts speaking as soon as her first sentence has
 * streamed in, instead of waiting for the whole reply. This cuts the
 * streamed text into speakable chunks.
 */

/** Sentence ends: . ! ? … and the Devanagari danda (।), followed by whitespace; or a line break. */
const BOUNDARY = /([.!?…।]+["')\]]?)\s+|\n+/g;

/** Chunks shorter than this are merged with the next sentence — fewer, more natural-sounding requests. */
const MIN_CHUNK_CHARS = 24;
/** A chunk never exceeds the API's limit; long run-ons are cut at a space. */
export const MAX_CHUNK_CHARS = 400;

/** Strips things that sound bad read aloud: list bullets, markdown symbols, URLs. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/[*_#`~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLong(chunk: string): string[] {
  const parts: string[] = [];
  let rest = chunk;
  while (rest.length > MAX_CHUNK_CHARS) {
    const cut = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
    const at = cut > MAX_CHUNK_CHARS / 2 ? cut : MAX_CHUNK_CHARS;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export interface SentenceChunker {
  /** Adds streamed text; returns any chunks that are now complete. */
  push(delta: string): string[];
  /** The reply finished — returns whatever is left. */
  flush(): string[];
}

export function createSentenceChunker(): SentenceChunker {
  let buffer = "";
  let pending = "";

  function take(raw: string): string[] {
    const cleaned = cleanForSpeech(raw);
    if (!cleaned) return [];
    pending = pending ? `${pending} ${cleaned}` : cleaned;
    if (pending.length < MIN_CHUNK_CHARS) return [];
    const out = splitLong(pending);
    pending = "";
    return out;
  }

  return {
    push(delta) {
      buffer += delta;
      const out: string[] = [];
      let last = 0;
      BOUNDARY.lastIndex = 0;
      for (let match = BOUNDARY.exec(buffer); match; match = BOUNDARY.exec(buffer)) {
        const end = match.index + (match[1]?.length ?? 0);
        out.push(...take(buffer.slice(last, end)));
        last = match.index + match[0].length;
      }
      buffer = buffer.slice(last);
      return out;
    },
    flush() {
      const rest = cleanForSpeech(`${pending} ${buffer}`);
      buffer = "";
      pending = "";
      return rest ? splitLong(rest) : [];
    },
  };
}

/** True when text is mostly Devanagari — used to pick a Hindi Windows voice. */
export function isMostlyDevanagari(text: string): boolean {
  // Vowel signs (ी, े) are combining marks, not letters — count them too.
  const letters = text.match(/[\p{L}\p{M}]/gu) ?? [];
  if (letters.length === 0) return false;
  const devanagari = letters.filter((ch) => /[ऀ-ॿ]/.test(ch)).length;
  return devanagari / letters.length > 0.5;
}
