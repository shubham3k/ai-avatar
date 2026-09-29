import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../lib/relative-time";
import type { ZaraChat } from "../state/use-zara-chat";

export interface ChatPanelProps {
  chat: ZaraChat;
  onClose: () => void;
  /** Seconds of inactivity before the panel hides itself (conversation kept); 0 = never. */
  autoHideSeconds: number;
}

/**
 * Zara's chat (ADR-006, M2): a small panel directly above the dock. Replies
 * stream in; New chat starts fresh; 🕘 lists past chats. Hides itself after
 * autoHideSeconds without activity — never while Zara is working or the
 * mic is open.
 */
export function ChatPanel({ chat, onClose, autoHideSeconds }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [activityTick, setActivityTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bump = () => setActivityTick((tick) => tick + 1);

  const lastMessage = chat.messages.at(-1);
  const contentSignature = `${chat.messages.length}:${lastMessage?.content.length ?? 0}:${chat.status ?? ""}`;

  // Keep the newest message in view as replies stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [contentSignature]);

  // Auto-hide after a quiet period; any activity (typing, pointer, new
  // text, tool status) restarts the countdown.
  useEffect(() => {
    if (autoHideSeconds <= 0 || chat.busy) return;
    const timer = setTimeout(onClose, autoHideSeconds * 1000);
    return () => clearTimeout(timer);
  }, [autoHideSeconds, chat.busy, onClose, activityTick, contentSignature, draft, chat.view]);

  const submit = () => {
    const text = draft.trim();
    if (!text || chat.busy) return;
    setDraft("");
    void chat.send(text);
  };

  return (
    <div
      className="chat-panel"
      data-testid="chat-panel"
      onPointerMove={bump}
      onPointerDown={bump}
      onKeyDown={(e) => {
        bump();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="chat-header">
        <img className="chat-avatar" src="./character.svg" alt="" aria-hidden="true" />
        <div className="chat-title">
          Zara{chat.incognito && <span className="chat-incognito-badge">Incognito</span>}
        </div>
        <button
          type="button"
          className={`chat-icon-button${chat.incognito ? " chat-icon-active" : ""}`}
          aria-label="Incognito chat"
          aria-pressed={chat.incognito}
          title="Incognito chat — not saved, nothing learned"
          onClick={() => (chat.incognito ? chat.newChat() : chat.startIncognito())}
        >
          🕶
        </button>
        <button
          type="button"
          className="chat-icon-button"
          aria-label={chat.view === "history" ? "Back to chat" : "Chat history"}
          title={chat.view === "history" ? "Back to chat" : "Chat history"}
          onClick={() => (chat.view === "history" ? chat.showChat() : void chat.showHistory())}
        >
          {chat.view === "history" ? "←" : "🕘"}
        </button>
        <button type="button" className="chat-icon-button" aria-label="New chat" title="New chat" onClick={chat.newChat}>
          ＋
        </button>
        <button type="button" className="chat-icon-button" aria-label="Close chat" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {chat.view === "history" ? (
        <div className="chat-history" data-testid="chat-history">
          {chat.conversations.length === 0 ? (
            <div className="chat-empty">No past chats yet.</div>
          ) : (
            chat.conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`chat-history-row${conversation.id === chat.conversationId ? " chat-history-current" : ""}`}
              >
                <button
                  type="button"
                  className="chat-history-item"
                  onClick={() => void chat.openConversation(conversation.id)}
                >
                  <span className="chat-history-title">{conversation.title}</span>
                  <span className="chat-history-time">{formatRelativeTime(new Date(conversation.updatedAt).getTime())}</span>
                </button>
                <button
                  type="button"
                  className="chat-icon-button chat-history-delete"
                  aria-label={`Delete chat "${conversation.title}"`}
                  title="Delete this chat"
                  onClick={() => void chat.deleteConversation(conversation.id)}
                >
                  🗑
                </button>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          {chat.incognito && (
            <div className="chat-incognito-note">Incognito — this chat isn't saved and I won't remember anything from it.</div>
          )}
          <div className="chat-messages" ref={scrollRef} data-testid="chat-messages" aria-live="polite">
            {chat.messages.length === 0 && !chat.recording && (
              <div className="chat-empty">
                Hi, I'm Zara. Ask about your day, your email, or say "remind me in 10 minutes to stretch". Tell me
                things worth remembering, like "Rahul is my manager".
              </div>
            )}
            {chat.messages.map((message) => (
              <div key={message.id} className={`chat-bubble chat-${message.role}`}>
                {message.content || (message.streaming ? <span className="chat-typing">•••</span> : null)}
                {message.provider === "groq" && !message.streaming && (
                  <div className="chat-backup-note">answered by backup (Groq)</div>
                )}
              </div>
            ))}
          </div>
          {chat.recording && <div className="chat-status chat-listening">Listening… click 🎤 again when you're done.</div>}
          {chat.transcribing && <div className="chat-status">Turning your voice into text…</div>}
          {chat.status && <div className="chat-status">{chat.status}</div>}
          {chat.error && (
            <div className="chat-error" role="alert">
              {chat.error}
            </div>
          )}
          <div className="chat-input-row">
            <input
              className="chat-input"
              type="text"
              autoFocus
              aria-label="Message Zara"
              placeholder="Message Zara…"
              value={draft}
              disabled={chat.recording || chat.transcribing}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button
              type="button"
              className="chat-send"
              aria-label="Send"
              disabled={!draft.trim() || chat.busy}
              onClick={submit}
            >
              ↵
            </button>
          </div>
        </>
      )}
    </div>
  );
}
