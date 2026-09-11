#!/usr/bin/env node
// Bee SessionStart hook: auto-configure statusline globally
// Copies bee-statusline.js to ~/.claude/hooks/ with version injected
// Always overwrites to ensure latest statusline persists across sessions

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOKS_DIR = path.join(os.homedir(), '.claude', 'hooks');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const TARGET_SCRIPT = path.join(HOOKS_DIR, 'bee-statusline.js');
const SOURCE_SCRIPT = path.join(__dirname, 'bee-statusline.js');
const PLUGIN_JSON = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');
const STATUSLINE_CMD = `node "${TARGET_SCRIPT}"`;

try {
  // 1. Ensure ~/.claude/hooks/ exists
  fs.mkdirSync(HOOKS_DIR, { recursive: true });

  // 2. Copy bee-statusline.js with version injected
  if (fs.existsSync(SOURCE_SCRIPT)) {
    let source = fs.readFileSync(SOURCE_SCRIPT, 'utf8');

    // Inject version from plugin.json into the BEE_VERSION constant
    try {
      if (fs.existsSync(PLUGIN_JSON)) {
        const pluginData = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
        if (pluginData.version) {
          source = source.replace(
            "const BEE_VERSION = '__BEE_VERSION__'",
            `const BEE_VERSION = '${pluginData.version}'`
          );
        }
      }
    } catch (e) {
      // Continue without version injection
    }

    fs.writeFileSync(TARGET_SCRIPT, source);
  }

  // 3. Always set statusLine in ~/.claude/settings.json
  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  }

  settings.statusLine = { type: 'command', command: STATUSLINE_CMD };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
} catch (e) {
  // Silent fail - never break session start
}
