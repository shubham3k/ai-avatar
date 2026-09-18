/** Reads the existing Phase 2.3/2.5 `Signal.importanceHints.confidence` field, if present. */
export function extractSignalConfidence(importanceHints: unknown): "high" | "medium" | null {
  if (
    importanceHints &&
    typeof importanceHints === "object" &&
    "confidence" in importanceHints
  ) {
    const value = (importanceHints as { confidence?: unknown }).confidence;
    if (value === "high" || value === "medium") return value;
  }
  return null;
}
