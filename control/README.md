# Claudstermind — the "server app" (control panel)

One window on the work machine that shows the whole stack's health and starts/stops it, so you never have to
hunt through processes again. It's a **control panel over systemd** — it reads and controls the *same*
services that are already running (`claudstermind.service` = dashboard + relay bridge/tunnel;
`claudstermind-sessiond.service` = the agent engine). It does **not** respawn them, so opening the app while
the stack is live is **zero-downtime** — nothing restarts.

Closing the window quits only the *app*; the services keep running under systemd.

## There's no "install" like on Windows

The code already lives here. You do this **once**:

```bash
cd /home/ancientbox/ClaudeWS/Claudstermind
npm install                     # pulls Electron into node_modules (~150 MB, one time)
```

Then run it either way:

```bash
npm run app                     # from a terminal
# — or — double-click the desktop launcher (see below)
```

Read-only status without opening the window:

```bash
npm run status                  # or: node control/cli.mjs status
```

The app launches with `--no-sandbox` on purpose. Ubuntu 24.04+/26.04 restrict unprivileged user namespaces
via AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`), so a run-from-source Electron — which ships
no AppArmor profile — would otherwise abort at startup with a SUID-sandbox error. It's safe here: the window
only ever loads our own local HTML with `contextIsolation` on (no remote or untrusted content). The switch is
baked into `main.cjs` and both launchers, so nothing extra is needed.

## A double-clickable desktop shortcut (Linux)

`control/claudstermind.desktop` is the launcher (Linux's version of a Windows shortcut). Install it to your
app menu and/or desktop:

```bash
cp control/claudstermind.desktop ~/.local/share/applications/   # shows in the app menu
cp control/claudstermind.desktop ~/Desktop/                     # a desktop icon
chmod +x ~/Desktop/claudstermind.desktop                       # (some desktops require this)
```

(If the repo isn't at `/home/ancientbox/ClaudeWS/Claudstermind`, edit the two absolute paths in the file.)

## Password-free Start/Stop (recommended)

The two units are *system* services, so Start/Stop normally needs privilege. Install the polkit rule once so
the app's buttons work with no prompt (and nothing else is granted):

```bash
sudo cp control/polkit/49-claudstermind.rules /etc/polkit-1/rules.d/49-claudstermind.rules
sudo systemctl restart polkit
```

Without it, the app can still control the stack if you launch it with `CM_USE_SUDO=1` (which prompts).

## The tunnel light

Set your public relay URL so the app can show whether the remote gateway sees the bridge connected:

```bash
CM_RELAY_URL=https://your-relay.example npm run app
```

(Without it, status still works — the tunnel light just reads "n/a".)

## Later, if you want a single portable file

`electron-builder` can package this into one **AppImage** you double-click with zero dependencies. Not set up
yet — run-from-source is simpler while the app is being iterated. Ask and I'll add the builder config.
