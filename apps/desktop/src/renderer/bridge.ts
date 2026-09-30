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
  chatTranscribe?(
    audioBase64: string,
    mimeType: string,
    durationSeconds?: number,
    script?: "latin" | "devanagari",
  ): Promise<unknown>;
  chatSend?(
    conversationId: string | null,
    text: string,
    onEvent: (event: unknown) => void,
    options?: { incognito?: boolean; spoken?: boolean; history?: { role: "user" | "assistant"; content: string }[] },
  ): Promise<unknown>;
  /** ADR-006 (M3): each resolves `{ ok, value | message }`. Optional so older test doubles still type-check. */
  chatDelete?(conversationId: string): Promise<unknown>;
  chatDeleteAll?(): Promise<unknown>;
  memoryList?(): Promise<unknown>;
  memoryUpdate?(factId: string, content: string): Promise<unknown>;
  memoryDelete?(factId: string): Promise<unknown>;
  memoryDeleteAll?(): Promise<unknown>;
  activityList?(): Promise<unknown>;
  activityUndo?(entryId: string): Promise<unknown>;
  activityClear?(): Promise<unknown>;
  /** ADR-006 (M4): voice. Optional so older test doubles still type-check. */
  chatSpeak?(text: string, voice: string): Promise<unknown>;
  saveChatHotkey?(accelerator: string): Promise<unknown>;
  onHotkey?(callback: () => void): () => void;
  /** ADR-006 (M7). Optional so older test doubles still type-check. */
  actionsList?(): Promise<unknown>;
  actionsApprove?(actionId: string, payload?: unknown): Promise<unknown>;
  actionsCancel?(actionId: string): Promise<unknown>;
  actionsGetSettings?(): Promise<unknown>;
  actionsUpdateSettings?(writingStyle: string): Promise<unknown>;
  /** ADR-006 (M6). Optional so older test doubles still type-check. */
  recallGetSettings?(): Promise<unknown>;
  recallUpdateSettings?(patch: Record<string, unknown>): Promise<unknown>;
  recallStatus?(): Promise<unknown>;
  recallIndex?(): Promise<unknown>;
  recallChooseFolder?(): Promise<unknown>;
  recallOpenFolder?(): Promise<unknown>;
  /** ADR-006 (M5). Optional so older test doubles still type-check. */
  proactiveGetSettings?(): Promise<unknown>;
  proactiveUpdateSettings?(patch: Record<string, unknown>): Promise<unknown>;
  proactiveBriefingNow?(kind: "morning" | "wrap_up"): Promise<unknown>;
  onHoldChanged?(callback: (state: unknown) => void): () => void;
  onBriefing?(callback: (briefing: unknown) => void): () => void;
}

declare global {
  interface Window {
    desktopAPI?: DesktopApiBridge;
  }
}

export {};
