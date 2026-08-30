// Electron main process for the Claudstermind "server app" — a thin window + tray over lib/controlPlane.mjs.
// CommonJS (.cjs) on purpose: robust Electron entry, and it dynamically imports the ESM core, so status/
// control have ONE source of truth shared with the CLI. This is a control panel, not the services' parent:
// closing the window hides to the tray; the two systemd services keep running regardless. Only "Quit" (tray)
// exits the app — and even that leaves the stack running.
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require("electron");
const path = require("path");
const { stateDot } = require("./icon.cjs");

// Ubuntu 24.04+/26.04 restrict unprivileged user namespaces via AppArmor
// (kernel.apparmor_restrict_unprivileged_userns=1), so a run-from-source Electron — which ships no AppArmor
// profile — can't create the namespace its sandbox needs and would abort at launch. The renderer here loads
// ONLY our own local HTML with contextIsolation on (no remote/untrusted content, no nodeIntegration), so the
// Chromium sandbox adds little; disabling it is the pragmatic, standard choice for a local control panel.
// Belt-and-suspenders with the `--no-sandbox` flag in the launchers (npm script + .desktop).
app.commandLine.appendSwitch("no-sandbox");

const RELAY_URL = process.env.CM_RELAY_URL || null;                       // set to your public relay URL → real tunnel light
const DASH_URL = process.env.CM_DASHBOARD_URL || "http://localhost:3001"; // local dashboard the bridge serves
const USE_SUDO = process.env.CM_USE_SUDO === "1";                          // fallback if no polkit rule is installed
const POLL_MS = 3000;

let _core = null;
function core() { return _core || (_core = import("../../lib/controlPlane.mjs")); }

let win = null, tray = null, pollTimer = null;

function createWindow() {
  win = new BrowserWindow({
    width: 540, height: 660, minWidth: 440, minHeight: 500,
    title: "Claudstermind",
    backgroundColor: "#0e1420",
    autoHideMenuBar: true,
    icon: nativeImage.createFromBuffer(stateDot("up", 64)),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
  // Closing the window HIDES it to the tray (the app + status dot stay); only "Quit" really exits.
  win.on("close", (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else { win.show(); win.focus(); }
}

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(stateDot("unknown", 22)));
  tray.setToolTip("Claudstermind — starting…");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open control panel", click: showWindow },
    { type: "separator" },
    { label: "Quit app (services keep running)", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", showWindow);   // left-click behaviour varies by desktop; the menu is the reliable path
}

// One poller in MAIN: refresh the tray colour/tooltip AND push to the window (so a hidden window costs nothing
// and the tray is always live). The renderer just listens; it never polls on its own.
async function poll() {
  let s = null;
  try { const c = await core(); s = await c.gatherStatus({ dashboardUrl: DASH_URL, relayUrl: RELAY_URL }); } catch { /* keep last */ }
  if (!s) { if (tray) tray.setToolTip("Claudstermind — control app error"); return; }
  if (tray) { tray.setImage(nativeImage.createFromBuffer(stateDot(s.overall, 22))); tray.setToolTip("Claudstermind — " + String(s.overall || "?").toUpperCase()); }
  if (win && !win.isDestroyed()) win.webContents.send("cm:status", s);
}

// Renderer asks for an immediate snapshot (first paint / manual refresh).
ipcMain.handle("cm:status", async () => { const c = await core(); return c.gatherStatus({ dashboardUrl: DASH_URL, relayUrl: RELAY_URL }); });

// Start/stop/restart. `id` = "engine" | "web" | null (both). Confirmation is the renderer's job (styled).
ipcMain.handle("cm:control", async (_e, action, id) => {
  const c = await core();
  const units = id ? c.UNITS.filter((u) => u.id === id) : c.UNITS.slice();
  const ordered = action === "stop" ? [...units].reverse() : units;   // start engine→web; stop web→engine
  const results = [];
  for (const u of ordered) results.push({ id: u.id, label: u.label, ...c.controlUnit(action, u.unit, { useSudo: USE_SUDO }) });
  poll();   // reflect the change immediately
  return results;
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  poll();
  pollTimer = setInterval(poll, POLL_MS);
  app.on("activate", () => showWindow());
});
// Do NOT quit when the window is hidden/closed — we live in the tray. Real exit is the tray "Quit".
app.on("window-all-closed", () => { /* stay resident in the tray */ });
app.on("before-quit", () => { app.isQuitting = true; if (pollTimer) clearInterval(pollTimer); });
