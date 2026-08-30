// Preload bridge: the ONLY surface the isolated renderer can call. Exposes just two thin, safe calls that
// forward to the main process (which owns lib/controlPlane.mjs). No Node, no filesystem, no arbitrary IPC.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cm", {
  status: () => ipcRenderer.invoke("cm:status"),               // → { units, probes, overall } (manual/first paint)
  control: (action, id) => ipcRenderer.invoke("cm:control", action, id),   // action: start|stop|restart, id: engine|web|null
  onStatus: (cb) => ipcRenderer.on("cm:status", (_e, s) => cb(s)),         // main pushes a fresh snapshot every few seconds
});
