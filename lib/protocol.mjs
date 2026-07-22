// The reverse-tunnel envelope shared by the bridge (agent) and the relay.
//
// Every message on the WebSocket is one JSON frame with a `t` (type) discriminator.
// Nothing acts on a frame until validateFrame() has vouched for its shape — a relay
// forwarding a malformed `command`, or a bridge dispatching one, is exactly the class
// of bug that turns a transport into an exploit.
//
//   agent → relay:  HELLO (auth) · SNAPSHOT (state push) · RESULT (command reply) · PONG
//   relay → agent:  WELCOME (auth ok) · COMMAND (execute this) · PING
//
// The command whitelist lives here too, so "what may cross the tunnel" is one list.

export const FRAME = Object.freeze({
  HELLO: "hello",
  WELCOME: "welcome",
  SNAPSHOT: "snapshot",
  COMMAND: "command",
  RESULT: "result",
  PING: "ping",
  PONG: "pong",
  // Remote-workspace streaming (Claude sessions driven from the web). Unlike COMMAND/RESULT
  // these are a continuous bidirectional stream, not one request→one reply:
  //   WS_IN  (relay → agent): a user action  — kind ∈ prompt | permission | stop | control
  //   WS_OUT (agent → relay): session output — kind ∈ event | permission | state | done | error
  WS_IN: "ws.in",
  WS_OUT: "ws.out",
});

// Workspace-management actions carried by a WS_IN "control" frame — the fixed set of
// non-prompt operations the web may drive. WorkspaceManager._control() gates on this list,
// so an action missing here cannot cross the tunnel no matter what the web sends.
export const WS_CONTROL_ACTIONS = Object.freeze([
  "newFolder", "newRepo", "list", "tree", "delete",
  "setTrusted", "setMode",                       // permission mode: workspace default or one pane
  "history", "open", "search", "dataSizes",
]);

// The only command types that may travel down the tunnel and be executed locally.
// Kept in sync with lib/commands.mjs COMMAND_TYPES (that module imports this set).
export const COMMAND_TYPES = Object.freeze([
  "git.commit",
  "git.push",
  "git.pull",
  "backup",
  "restore",
  "pollinate.dryrun",
  "tokens.save",
]);

const COMMAND_SET = new Set(COMMAND_TYPES);
export const isCommandType = (t) => typeof t === "string" && COMMAND_SET.has(t);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;

/**
 * @returns {{ok: true} | {ok: false, reason: string}}
 * Structural only — it does NOT authenticate (the relay checks the secret) or
 * authorize (commands.mjs gates the command type). It guarantees the fields the
 * handlers read exist and have the right shape.
 */
export function validateFrame(frame) {
  if (!isObj(frame)) return { ok: false, reason: "frame is not an object" };
  const t = frame.t;
  switch (t) {
    case FRAME.HELLO:
      if (!isStr(frame.deviceSecret)) return { ok: false, reason: "hello: deviceSecret missing" };
      return { ok: true };
    case FRAME.WELCOME:
    case FRAME.PING:
    case FRAME.PONG:
      return { ok: true };
    case FRAME.SNAPSHOT:
      if (!isObj(frame.data)) return { ok: false, reason: "snapshot: data missing" };
      return { ok: true };
    case FRAME.WS_IN:
    case FRAME.WS_OUT:
      if (!isStr(frame.kind)) return { ok: false, reason: `${t}: kind missing` };
      return { ok: true };
    case FRAME.COMMAND:
      if (!isStr(frame.id)) return { ok: false, reason: "command: id missing" };
      if (!isObj(frame.cmd)) return { ok: false, reason: "command: cmd missing" };
      if (!isStr(frame.cmd.type)) return { ok: false, reason: "command: cmd.type missing" };
      return { ok: true };
    case FRAME.RESULT:
      if (!isStr(frame.id)) return { ok: false, reason: "result: id missing" };
      if (!isObj(frame.result)) return { ok: false, reason: "result: result missing" };
      return { ok: true };
    default:
      return { ok: false, reason: `unknown frame type: ${String(t)}` };
  }
}
