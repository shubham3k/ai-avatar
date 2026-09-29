interface DesktopApiBridge {
  fetchInbox(): Promise<unknown>;
  markDone(interventionId: string): Promise<unknown>;
  snooze(interventionId: string, minutes: number): Promise<unknown>;
  setInteractive(interactive: boolean): void;
  reportContentSize(width: number, height: number): void;
  connectGoogle(): Promise<void>;
  openSource(url: string): Promise<void>;
  getSettings(): Promise<unknown>;
  saveGroqKey(key: string): Promise<void>;
  /** ADR-006: primary AI provider key; saving restarts the app. Optional so older test doubles still type-check. */
  saveOpenAiKey?(key: string): Promise<void>;
  saveOpenAiModel?(model: string): Promise<void>;
  getUsageSummary?(): Promise<unknown>;
  saveGoogleCredentials(clientId: string, clientSecret: string): Promise<void>;
  googleStatus(): Promise<unknown>;
  disconnectGoogle(): Promise<unknown>;
  checkNow(): Promise<unknown>;
  createReminder(text: string, dueAt: string): Promise<unknown>;
  createReminderFromText(text: string): Promise<unknown>;
  createReminderFromVoice(audioBase64: string, mimeType: string, durationSeconds?: number): Promise<unknown>;
  /** Background check finished — refresh now. Optional so older bridges/test doubles still work. */
  onInboxChanged?(callback: () => void): () => void;
  /** ADR-006 (M2): Zara chat. Optional so older test doubles still type-check. */
  chatList?(): Promise<unknown>;
  chatMessages?(conversationId: string): Promise<unknown>;
  chatTranscribe?(audioBase64: string, mimeType: string, durationSeconds?: number): Promise<unknown>;
  chatSend?(conversationId: string | null, text: string, onEvent: (event: unknown) => void): Promise<unknown>;
}

declare global {
  interface Window {
    desktopAPI?: DesktopApiBridge;
  }
}

export {};
