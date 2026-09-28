import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver (see
// use-report-content-size.ts) — a harmless no-op stub so components using
// it render normally under tests instead of throwing "ResizeObserver is
// not defined".
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
