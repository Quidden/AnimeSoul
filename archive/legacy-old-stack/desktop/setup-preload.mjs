import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("animeSoulSetup", {
  save: (input) => ipcRenderer.invoke("animesoul:save-launch-config", input),
});
