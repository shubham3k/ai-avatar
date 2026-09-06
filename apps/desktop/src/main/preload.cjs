const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
  fetchInbox: () => ipcRenderer.invoke("inbox:get"),
  markDone: (interventionId) =>
    ipcRenderer.invoke("intervention:done", interventionId),
  snooze: (interventionId, minutes) =>
    ipcRenderer.invoke("intervention:snooze", interventionId, minutes),
  setInteractive: (interactive) =>
    ipcRenderer.send("overlay:set-interactive", interactive),
};

contextBridge.exposeInMainWorld("desktopAPI", bridge);