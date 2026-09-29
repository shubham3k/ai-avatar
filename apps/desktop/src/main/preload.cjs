const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
  fetchInbox: () => ipcRenderer.invoke("inbox:get"),
  markDone: (interventionId) =>
    ipcRenderer.invoke("intervention:done", interventionId),
  snooze: (interventionId, minutes) =>
    ipcRenderer.invoke("intervention:snooze", interventionId, minutes),
  setInteractive: (interactive) =>
    ipcRenderer.send("overlay:set-interactive", interactive),
  reportContentSize: (width, height) =>
    ipcRenderer.send("overlay:content-size", width, height),
  connectGoogle: () => ipcRenderer.invoke("integrations:connect-google"),
  openSource: (url) => ipcRenderer.invoke("intervention:open-source", url),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveGroqKey: (key) => ipcRenderer.invoke("settings:save-groq-key", key),
  saveOpenAiKey: (key) => ipcRenderer.invoke("settings:save-openai-key", key),
  saveOpenAiModel: (model) => ipcRenderer.invoke("settings:save-openai-model", model),
  getUsageSummary: () => ipcRenderer.invoke("usage:summary"),
  saveGoogleCredentials: (clientId, clientSecret) =>
    ipcRenderer.invoke("settings:save-google-credentials", clientId, clientSecret),
  googleStatus: () => ipcRenderer.invoke("integrations:google-status"),
  disconnectGoogle: () => ipcRenderer.invoke("integrations:disconnect-google"),
  checkNow: () => ipcRenderer.invoke("assistant:check-now"),
  createReminder: (text, dueAt) => ipcRenderer.invoke("reminders:create", text, dueAt),
  createReminderFromText: (text) =>
    ipcRenderer.invoke("reminders:create-from-text", text),
  createReminderFromVoice: (audioBase64, mimeType, durationSeconds) =>
    ipcRenderer.invoke("reminders:create-from-voice", audioBase64, mimeType, durationSeconds),
  chatList: () => ipcRenderer.invoke("chat:list"),
  chatMessages: (conversationId) => ipcRenderer.invoke("chat:messages", conversationId),
  chatTranscribe: (audioBase64, mimeType, durationSeconds, script) =>
    ipcRenderer.invoke("chat:transcribe", audioBase64, mimeType, durationSeconds, script),
  chatSend: (conversationId, text, onEvent, options) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event, id, chatEvent) => {
      if (id === requestId) onEvent(chatEvent);
    };
    ipcRenderer.on("chat:event", listener);
    return ipcRenderer
      .invoke("chat:send", requestId, conversationId, text, options)
      .finally(() => ipcRenderer.removeListener("chat:event", listener));
  },
  chatDelete: (conversationId) => ipcRenderer.invoke("chat:delete", conversationId),
  chatDeleteAll: () => ipcRenderer.invoke("chat:delete-all"),
  memoryList: () => ipcRenderer.invoke("memory:list"),
  memoryUpdate: (factId, content) => ipcRenderer.invoke("memory:update", factId, content),
  memoryDelete: (factId) => ipcRenderer.invoke("memory:delete", factId),
  memoryDeleteAll: () => ipcRenderer.invoke("memory:delete-all"),
  activityList: () => ipcRenderer.invoke("activity:list"),
  activityUndo: (entryId) => ipcRenderer.invoke("activity:undo", entryId),
  activityClear: () => ipcRenderer.invoke("activity:clear"),
  chatSpeak: (text, voice) => ipcRenderer.invoke("chat:speak", text, voice),
  saveChatHotkey: (accelerator) => ipcRenderer.invoke("settings:save-hotkey", accelerator),
  onHotkey: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("zara:hotkey", listener);
    return () => ipcRenderer.removeListener("zara:hotkey", listener);
  },
  recallGetSettings: () => ipcRenderer.invoke("recall:get-settings"),
  recallUpdateSettings: (patch) => ipcRenderer.invoke("recall:update-settings", patch),
  recallStatus: () => ipcRenderer.invoke("recall:status"),
  recallIndex: () => ipcRenderer.invoke("recall:index"),
  recallChooseFolder: () => ipcRenderer.invoke("recall:choose-folder"),
  recallOpenFolder: () => ipcRenderer.invoke("recall:open-folder"),
  proactiveGetSettings: () => ipcRenderer.invoke("proactive:get-settings"),
  proactiveUpdateSettings: (patch) => ipcRenderer.invoke("proactive:update-settings", patch),
  proactiveBriefingNow: (kind) => ipcRenderer.invoke("proactive:briefing-now", kind),
  onHoldChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("proactive:hold", listener);
    return () => ipcRenderer.removeListener("proactive:hold", listener);
  },
  onBriefing: (callback) => {
    const listener = (_event, briefing) => callback(briefing);
    ipcRenderer.on("zara:briefing", listener);
    return () => ipcRenderer.removeListener("zara:briefing", listener);
  },
  onInboxChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("inbox:changed", listener);
    return () => ipcRenderer.removeListener("inbox:changed", listener);
  },
};

contextBridge.exposeInMainWorld("desktopAPI", bridge);