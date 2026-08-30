// Electron main process for the Claudstermind "server app" — a thin window over lib/controlPlane.mjs.
// CommonJS (.cjs) on purpose: it's the robust Electron entry, and it dynamically imports the ESM core, so
// there's ONE source of truth for status/control shared with the CLI. Closing the window quits only the APP
// — the two systemd services keep running underneath (this is a control panel, not their parent).
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const RELAY_URL = process.env.CM_RELAY_URL || null;                       // set to your public relay URL → real tunnel light
const DASH_URL = process.env.CM_DASHBOARD_URL || "http://localhost:3001"; // local dashboard the bridge serves
const USE_SUDO = process.env.CM_USE_SUDO === "1";                          // fallback if no polkit rule is installed

// Load the ESM control-plane core once (dynamic import works from CommonJS). Same module the CLI uses.
let _core = null;
function core() { return _core || (_core = import("../../lib/controlPlane.mjs")); }

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 540, height: 640, minWidth: 440, minHeight: 500,
    title: "Claudstermind",
    backgroundColor: "#0e1420",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,   // renderer can't touch Node; it talks to main only through the preload bridge
      nodeIntegration: false,
      sandbox: false,           // preload needs `require('electron')`; the renderer stays isolated regardless
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
}

// Read-only status snapshot for the renderer's poll.
ipcMain.handle("cm:status", async () => {
  const c = await core();
  return c.gatherStatus({ dashboardUrl: DASH_URL, relayUrl: RELAY_URL });
});

// Start/stop/restart. `id` = "engine" | "web" | null (both). Confirmation is the renderer's job (styled, not a
// native popup). Engine BEFORE web on start (web's bridge dials the engine socket); reversed on stop to drain.
ipcMain.handle("cm:control", async (_e, action, id) => {
  const c = await core();
  const units = id ? c.UNITS.filter((u) => u.id === id) : c.UNITS.slice();
  const ordered = action === "stop" ? [...units].reverse() : units;
  const results = [];
  for (const u of ordered) results.push({ id: u.id, label: u.label, ...c.controlUnit(action, u.unit, { useSudo: USE_SUDO }) });
  return results;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// Closing the window quits the APP — but NOT the stack. The systemd services keep running; reopen anytime.
app.on("window-all-closed", () => app.quit());
