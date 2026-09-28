import { useEffect } from "react";

/**
 * The Electron window is a fixed-size, always-interactive rectangle (see
 * overlay-window.ts) — even the part with nothing rendered in it still
 * blocks clicks to the desktop behind it. Watches #root's actual rendered
 * size and reports it to the main process on every change, so the real OS
 * window can be resized to match whatever's actually showing (a short
 * intervention card vs. the taller Settings panel) instead of always
 * occupying its original fixed size. A ResizeObserver reacts to layout
 * changes directly, so this only needs to run once per mount — no
 * dependency list tied to which screen is currently rendered.
 */
export function useReportContentSize(): void {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;

    let frame: number | null = null;
    const report = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        window.desktopAPI?.reportContentSize(root.scrollWidth, root.scrollHeight);
      });
    };

    const observer = new ResizeObserver(report);
    observer.observe(root);
    report();

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
}
