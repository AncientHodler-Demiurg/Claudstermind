// hive-http-utils.js
//
// Neutral leaf module for HTTP transport helpers shared by hive-server.js
// and hive-snapshot.js. This module MUST NOT require('./hive-server') or
// require('./hive-snapshot') — doing so would re-introduce the circular
// require that motivated D-001 in Q11. The topology is a DAG:
//
//   hive-server.js ──┐
//                    ├──→ hive-http-utils.js (leaf)
//   hive-snapshot.js ┘
//
// Both consumers import from here; this file imports from neither. Keeping
// the helper in a leaf module lets createFileHandler live in hive-snapshot.js
// (alongside createSnapshotHandler / createConfigHandler / createEventsHandler)
// without any cross-module load-order fragility.

// Small JSON error helper — used by createFileHandler's many error paths and
// by hive-server.js's per-route catch blocks. Writes a single application/json
// response with `Cache-Control: no-store` and any caller-provided extra
// headers merged on top (e.g. `Allow: GET` for 405 responses).
function sendJsonError(res, status, message, extraHeaders) {
  const body = JSON.stringify({ error: message });
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(extraHeaders || {}),
  });
  res.end(body);
}

module.exports = { sendJsonError };
