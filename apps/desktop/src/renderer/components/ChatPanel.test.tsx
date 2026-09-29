import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import type { ZaraChat } from "../state/use-zara-chat";

function makeChat(overrides: Partial<ZaraChat> = {}): ZaraChat {
  return {
    conversationId: null,
    messages: [],
    status: null,
    error: null,
    sending: false,
    recording: false,
    transcribing: false,
    view: "chat",
    conversations: [],
    send: vi.fn(async () => {}),
    newChat: vi.fn(),
    showHistory: vi.fn(async () => {}),
    showChat: vi.fn(),
    openConversation: vi.fn(async () => {}),
    toggleRecording: vi.fn(),
    speaking: false,
    stopSpeaking: vi.fn(),
    handsFree: false,
    stopListening: vi.fn(),
    voiceNotice: null,
    busy: false,
    ...overrides,
  };
}

describe("ChatPanel auto-hide (ADR-006 M2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides after the configured quiet period", () => {
    const onClose = vi.fn();
    render(<ChatPanel chat={makeChat()} onClose={onClose} autoHideSeconds={30} />);

    act(() => vi.advanceTimersByTime(29_000));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restarts the countdown on activity (typing)", () => {
    const onClose = vi.fn();
    render(<ChatPanel chat={makeChat()} onClose={onClose} autoHideSeconds={30} />);

    act(() => vi.advanceTimersByTime(20_000));
    fireEvent.change(screen.getByRole("textbox", { name: "Message Zara" }), { target: { value: "h" } });
    act(() => vi.advanceTimersByTime(20_000));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never hides while Zara is working or the mic is open", () => {
    const onClose = vi.fn();
    render(<ChatPanel chat={makeChat({ busy: true, sending: true })} onClose={onClose} autoHideSeconds={30} />);

    act(() => vi.advanceTimersByTime(120_000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("0 means never hide", () => {
    const onClose = vi.fn();
    render(<ChatPanel chat={makeChat()} onClose={onClose} autoHideSeconds={0} />);

    act(() => vi.advanceTimersByTime(600_000));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ChatPanel", () => {
  it("sends on Enter and ignores blank input", () => {
    const chat = makeChat();
    render(<ChatPanel chat={chat} onClose={() => {}} autoHideSeconds={0} />);
    const input = screen.getByRole("textbox", { name: "Message Zara" });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(chat.send).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  what's on today?  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chat.send).toHaveBeenCalledWith("what's on today?");
  });

  it("shows a typing indicator while the reply hasn't started, and the listening hint while recording", () => {
    const { rerender } = render(
      <ChatPanel
        chat={makeChat({ messages: [{ id: "s", role: "assistant", content: "", streaming: true }], busy: true, sending: true })}
        onClose={() => {}}
        autoHideSeconds={0}
      />,
    );
    expect(screen.getByText("•••")).toBeInTheDocument();

    rerender(<ChatPanel chat={makeChat({ recording: true, busy: true })} onClose={() => {}} autoHideSeconds={0} />);
    expect(screen.getByText(/Listening…/)).toBeInTheDocument();
  });

  it("lists past chats in history view", () => {
    const chat = makeChat({
      view: "history",
      conversations: [{ id: "c1", title: "Plan my Monday", updatedAt: new Date().toISOString() }],
    });
    render(<ChatPanel chat={chat} onClose={() => {}} autoHideSeconds={0} />);

    fireEvent.click(screen.getByText("Plan my Monday"));
    expect(chat.openConversation).toHaveBeenCalledWith("c1");
  });
});

describe("ChatPanel voice (ADR-006 M4)", () => {
  it("typing interrupts Zara's speech", () => {
    const stopSpeaking = vi.fn();
    render(<ChatPanel chat={makeChat({ speaking: true, busy: true, stopSpeaking })} onClose={vi.fn()} autoHideSeconds={0} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message Zara" }), { target: { value: "w" } });
    expect(stopSpeaking).toHaveBeenCalledOnce();
  });

  it("shows a Stop button while she speaks, and lets you type while she talks", () => {
    const stopSpeaking = vi.fn();
    render(<ChatPanel chat={makeChat({ speaking: true, busy: true, stopSpeaking })} onClose={vi.fn()} autoHideSeconds={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stopSpeaking).toHaveBeenCalledOnce();
    const input = screen.getByRole("textbox", { name: "Message Zara" });
    fireEvent.change(input, { target: { value: "next question" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("shows hands-free listening and never auto-hides while it's on", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ChatPanel chat={makeChat({ handsFree: true, busy: true })} onClose={onClose} autoHideSeconds={5} />);
    expect(screen.getByText(/Listening hands-free/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("puts the cursor in the message box when the hotkey signal changes", () => {
    const { rerender } = render(<ChatPanel chat={makeChat()} onClose={vi.fn()} autoHideSeconds={0} focusSignal={0} />);
    const input = screen.getByRole("textbox", { name: "Message Zara" });
    input.blur();
    rerender(<ChatPanel chat={makeChat()} onClose={vi.fn()} autoHideSeconds={0} focusSignal={1} />);
    expect(input).toHaveFocus();
  });
});
