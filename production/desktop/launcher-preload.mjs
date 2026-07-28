import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("animeSoulLauncher", {
  choose: (mode) => ipcRenderer.invoke("animesoul:choose-launch-mode", mode),
  getSettings: () => ipcRenderer.invoke("animesoul:get-launch-config"),
  saveSettings: (settings) => ipcRenderer.invoke("animesoul:update-launch-config", settings),
});
