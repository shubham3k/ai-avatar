import { useEffect, useState } from "react";

export type HoldReason = "fullscreen" | "presentation" | "call" | "quiet_hours";

export interface HoldState {
  holding: boolean;
  reason: HoldReason | null;
}

const NOT_HOLDING: HoldState = { holding: false, reason: null };
const REASONS: HoldReason[] = ["fullscreen", "presentation", "call", "quiet_hours"];

export function parseHoldState(raw: unknown): HoldState {
  if (!raw || typeof raw !== "object") return NOT_HOLDING;
  const value = raw as { holding?: unknown; reason?: unknown };
  if (value.holding !== true) return NOT_HOLDING;
  return { holding: true, reason: REASONS.includes(value.reason as HoldReason) ? (value.reason as HoldReason) : null };
}

/** "presenting" etc. — for the dock's quiet "held" label. */
export function holdLabel(reason: HoldReason | null): string {
  switch (reason) {
    case "presentation":
      return "while you present";
    case "fullscreen":
      return "while you're full-screen";
    case "call":
      return "during your call";
    case "quiet_hours":
      return "during quiet hours";
    default:
      return "for now";
  }
}

/**
 * ADR-006 M5: pop-ups are held while the user presents, is full-screen,
 * is on a call, or is in quiet hours — decided by the main process, pushed
 * here as it changes.
 */
export function useHoldState(): HoldState {
  const [state, setState] = useState<HoldState>(NOT_HOLDING);

  useEffect(() => {
    let active = true;
    window.desktopAPI
      ?.getSettings()
      .then((raw) => {
        const hold = raw && typeof raw === "object" ? (raw as { hold?: unknown }).hold : null;
        if (active) setState(parseHoldState(hold));
      })
      .catch(() => undefined);
    const unsubscribe = window.desktopAPI?.onHoldChanged?.((raw) => setState(parseHoldState(raw)));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return state;
}
