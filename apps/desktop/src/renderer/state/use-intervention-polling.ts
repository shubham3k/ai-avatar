import { useCallback, useEffect, useRef, useState } from "react";
import {
  inboxResponseSchema,
  type InterventionDto,
} from "@ai-agent/shared";

export const POLL_INTERVAL_MS = 15_000;

export interface PollingState {
  interventions: InterventionDto[];
  loadError: string | null;
}

/**
 * Polls the inbox through the desktop bridge and exposes the full,
 * priority-ordered list (the API already orders by priority) so the
 * renderer can page through all pending items, not just the top one.
 * Guarantees at most one in-flight request and cleans up on unmount.
 */
export function useInterventionPolling() {
  const [state, setState] = useState<PollingState>({
    interventions: [],
    loadError: null,
  });
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    if (!window.desktopAPI) {
      setState({ interventions: [], loadError: "Desktop bridge unavailable" });
      return;
    }
    inFlight.current = true;
    try {
      const raw = await window.desktopAPI.fetchInbox();
      const parsed = inboxResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Unexpected response shape from API");
      }
      setState({
        interventions: parsed.data.items,
        loadError: null,
      });
    } catch {
      // Keep the last known interventions visible; just surface the error.
      setState((prev) => ({
        ...prev,
        loadError: "Could not reach the API",
      }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    // Push from the main process's scheduler (a due reminder, a new email):
    // refresh immediately; the interval above is only the fallback.
    const unsubscribe = window.desktopAPI?.onInboxChanged?.(() => {
      void refresh();
    });
    return () => {
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [refresh]);

  return { ...state, refresh };
}
