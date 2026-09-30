import { useCallback, useEffect, useRef, useState } from "react";

export type ActionKind = "email_send" | "calendar_create" | "calendar_update" | "calendar_cancel" | "mcp_call";
export type ActionStatus = "pending" | "sending" | "done" | "cancelled" | "failed";

export interface ActionCardData {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  payload: Record<string, unknown>;
  before: { title: string; start: string; end: string; location: string | null; attendees: string[] } | null;
  newRecipients: string[];
  notifies: string[];
  executeAt: string | null;
  error: string | null;
  /** M8: what an approved connection tool returned. */
  result: string | null;
  createdAt: string;
  voiceApprovable: boolean;
}

const KINDS: ActionKind[] = ["email_send", "calendar_create", "calendar_update", "calendar_cancel", "mcp_call"];
const STATUSES: ActionStatus[] = ["pending", "sending", "done", "cancelled", "failed"];

export function parseActionCard(raw: unknown): ActionCardData | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !KINDS.includes(value.kind as ActionKind) || !STATUSES.includes(value.status as ActionStatus)) return null;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
  return {
    id: value.id,
    kind: value.kind as ActionKind,
    status: value.status as ActionStatus,
    payload: value.payload && typeof value.payload === "object" ? (value.payload as Record<string, unknown>) : {},
    before: value.before && typeof value.before === "object" ? (value.before as ActionCardData["before"]) : null,
    newRecipients: strings(value.newRecipients),
    notifies: strings(value.notifies),
    executeAt: typeof value.executeAt === "string" ? value.executeAt : null,
    error: typeof value.error === "string" ? value.error : null,
    result: typeof value.result === "string" ? value.result : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    voiceApprovable: value.voiceApprovable === true,
  };
}

function readResult(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw && typeof raw === "object" && "ok" in raw) {
    const result = raw as { ok: unknown; value?: unknown; message?: unknown };
    if (result.ok === true) return { ok: true, value: result.value };
    if (typeof result.message === "string") return { ok: false, message: result.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

export interface ActionCards {
  cards: ActionCardData[];
  /** A card arrived in the chat stream (or changed). */
  upsert: (raw: unknown) => void;
  refresh: () => Promise<void>;
  /** Resolves null on success, else a message. trustTool (M8): also let this read-only tool run without asking from now on. */
  approve: (id: string, payload?: Record<string, unknown>, options?: { trustTool?: boolean }) => Promise<string | null>;
  cancel: (id: string) => Promise<string | null>;
  /** Hide a finished card. */
  dismiss: (id: string) => void;
  /** Ticks every second while an email is in its 30 s window, for the countdown. */
  now: number;
}

/**
 * ADR-006 M7: approval cards shown in Zara's chat. The cards live in the
 * API's database, so they survive the panel closing; this keeps them in
 * sync, and ticks the countdown during an email's 30-second undo window.
 */
export function useActionCards(): ActionCards {
  const [cards, setCards] = useState<ActionCardData[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const dismissed = useRef(new Set<string>());

  const upsert = useCallback((raw: unknown) => {
    const card = parseActionCard(raw);
    if (!card || dismissed.current.has(card.id)) return;
    setCards((prev) => {
      const others = prev.filter((existing) => existing.id !== card.id);
      return [...others, card].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const refresh = useCallback(async () => {
    const result = readResult(await (window.desktopAPI?.actionsList?.() ?? Promise.resolve(null)).catch(() => null));
    if (!result.ok) return;
    const list = (result.value as { actions?: unknown })?.actions;
    if (!Array.isArray(list)) return;
    const parsed = list.map(parseActionCard).filter((card): card is ActionCardData => !!card && !dismissed.current.has(card.id));
    setCards(parsed.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sending = cards.some((card) => card.status === "sending");
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      // Once a window has passed, fetch the result ("Sent ✓" or an error).
      const due = cards.some((card) => card.status === "sending" && card.executeAt && new Date(card.executeAt).getTime() <= Date.now() - 1000);
      if (due) void refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, [sending, cards, refresh]);

  const approve = useCallback(
    async (id: string, payload?: Record<string, unknown>, options?: { trustTool?: boolean }) => {
      const result = readResult(
        await (window.desktopAPI?.actionsApprove?.(id, payload, options?.trustTool === true) ?? Promise.resolve(null)).catch(() => null),
      );
      if (!result.ok) return result.message;
      upsert(result.value);
      setNow(Date.now());
      return null;
    },
    [upsert],
  );

  const cancel = useCallback(
    async (id: string) => {
      const result = readResult(await (window.desktopAPI?.actionsCancel?.(id) ?? Promise.resolve(null)).catch(() => null));
      if (!result.ok) {
        void refresh();
        return result.message;
      }
      upsert(result.value);
      return null;
    },
    [upsert, refresh],
  );

  const dismiss = useCallback((id: string) => {
    dismissed.current.add(id);
    setCards((prev) => prev.filter((card) => card.id !== id));
  }, []);

  return { cards, upsert, refresh, approve, cancel, dismiss, now };
}
