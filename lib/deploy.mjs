// The deploy pipeline — ships the local build to the live box and rebuilds the relay.
// Orchestration lives HERE (on the work machine, which holds the source + SSH to the box), never
// in the live container. The command sequence is a pure function so it's unit-testable; runDeploy
// executes it, streaming each line to onLog for the SSE terminal.
import { spawn } from "node:child_process";

const SAFE = (s) => String(s || "").replace(/[^A-Za-z0-9._:-]/g, "");   // version/sha stamps only

/** The ordered deploy steps. Pure — no I/O — so a test can assert the sequence + args.
 *  The local tarball is a bare RELATIVE name written into repoRoot (cwd) — a Windows absolute
 *  path like `C:\…` is misread as a remote host by both tar and scp; a colon-free relative path
 *  and cwd=repoRoot dodge that on Windows and Linux alike. remoteTarball is the box's /tmp path. */
export function deploySteps({ repoRoot, host = "stoanodeprime", localTarball = "cm-deploy.tgz",
  remoteTarball = "/tmp/cm-deploy.tgz", remoteDir = "/opt/claudstermind", version = "0.0.0", gitSha = "unknown", builtAt = "" }) {
  const tarball = remoteTarball;   // box-side name
  const stamp = `--build-arg CM_VERSION=${SAFE(version)} --build-arg CM_GIT_SHA=${SAFE(gitSha)} --build-arg CM_BUILT_AT=${SAFE(builtAt)}`;
  // Zero-downtime BLUE-GREEN: build the image, start the NEW container on the INACTIVE port
  // (8088↔8089), health-check it, flip the nginx `cm_relay` upstream (with `nginx -t` gate),
  // verify, THEN stop the old container. nginx is only touched after the new one is healthy, and
  // every failure aborts leaving the current live container serving. A one-time nginx upstream
  // include (conf.d/cm-relay-upstream.conf → `upstream cm_relay { server 127.0.0.1:PORT; }`) is
  // assumed present; the site proxies to http://cm_relay.
  const UP = "/etc/nginx/conf.d/cm-relay-upstream.conf";
  const box = [
    `set -e`,
    `cd ${remoteDir}`,
    `tar xzf ${tarball}`,
    `test -f relay/.env || { echo "FATAL relay/.env missing on the box"; exit 3; }`,
    // which port/container is live right now?
    `ACTIVE=$(grep -oE '127.0.0.1:(8088|8089)' ${UP} 2>/dev/null | grep -oE '(8088|8089)' | head -1); [ -z "$ACTIVE" ] && ACTIVE=8088`,
    `if [ "$ACTIVE" = 8088 ]; then TPORT=8089; TNAME=cm-relay-b; else TPORT=8088; TNAME=cm-relay-a; fi`,
    `echo "active=$ACTIVE → deploying to $TNAME:$TPORT"`,
    // build the stamped image (docker build, not compose → never starts caddy)
    `docker tag claudstermind-relay:latest claudstermind-relay:rollback 2>/dev/null || true`,
    `docker build -f relay/Dockerfile -t claudstermind-relay:latest ${stamp} ${remoteDir}`,
    // start the NEW (green) container on the inactive port
    `docker rm -f "$TNAME" 2>/dev/null || true`,
    `docker run -d --name "$TNAME" --env-file relay/.env -e PORT=8080 -e HOST=0.0.0.0 -p 127.0.0.1:$TPORT:8080 --restart unless-stopped claudstermind-relay:latest`,
    `set +e`,
    // health-check the green container before touching nginx
    `ok=0; for i in $(seq 1 20); do st=$(docker inspect -f '{{.State.Health.Status}}' "$TNAME" 2>/dev/null); echo "green health: $st"; [ "$st" = healthy ] && { ok=1; break; }; [ "$st" = unhealthy ] && break; sleep 3; done`,
    `if [ "$ok" != 1 ]; then echo "✗ green unhealthy — aborting, nginx untouched, live stays on $ACTIVE"; docker rm -f "$TNAME"; exit 1; fi`,
    // flip the upstream, validate, reload — revert on any failure
    `echo "upstream cm_relay { server 127.0.0.1:$TPORT; }" > ${UP}`,
    `if ! nginx -t 2>/tmp/nt; then echo "✗ nginx -t failed — reverting"; cat /tmp/nt; echo "upstream cm_relay { server 127.0.0.1:$ACTIVE; }" > ${UP}; docker rm -f "$TNAME"; exit 1; fi`,
    `nginx -s reload; sleep 2`,
    // verify the green really serves; if not, flip back to the old (still-running) container
    `code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$TPORT/api/version)`,
    `if [ "$code" != 200 ]; then echo "✗ green not serving ($code) — reverting to $ACTIVE"; echo "upstream cm_relay { server 127.0.0.1:$ACTIVE; }" > ${UP}; nginx -s reload; docker rm -f "$TNAME"; exit 1; fi`,
    `echo "✓ flipped to $TNAME:$TPORT (zero-downtime)"`,
    // now retire the old container(s)
    `for c in relay-relay-1 cm-relay-a cm-relay-b; do [ "$c" != "$TNAME" ] && { docker stop "$c" 2>/dev/null && docker rm "$c" 2>/dev/null; }; done; true`,
    `docker ps --filter name="$TNAME" --format 'live: {{.Names}} {{.Status}}'`,
  ].join("\n");
  return [
    { label: "Package", cmd: "tar", args: ["czf", localTarball, "--exclude=relay/.env", "--exclude=relay/docker-compose.override.yml", "--exclude=node_modules", "--exclude=*.test.mjs", "dashboard", "lib", "relay", "package.json", ".dockerignore"], cwd: repoRoot },
    { label: "Ship", cmd: "scp", args: ["-o", "BatchMode=yes", localTarball, `${host}:${tarball}`], cwd: repoRoot },
    { label: "Rebuild", cmd: "ssh", args: ["-o", "BatchMode=yes", host, box] },
    { label: "Cleanup", cmd: "ssh", args: ["-o", "BatchMode=yes", host, `rm -f ${tarball}`] },
  ];
}

function runStep(step, onLog) {
  return new Promise((resolve) => {
    onLog(`\n$ ${step.cmd} ${step.label === "Rebuild" ? "(remote build…)" : step.args.slice(-1)[0]}`);
    let child;
    try { child = spawn(step.cmd, step.args, { cwd: step.cwd, windowsHide: true }); }
    catch (e) { onLog(`  ✗ spawn failed: ${e.message}`); return resolve({ code: -1 }); }
    const pipe = (buf) => { for (const line of buf.toString().split(/\r?\n/)) if (line) onLog("  " + line); };
    child.stdout.on("data", pipe);
    child.stderr.on("data", pipe);
    child.on("error", (e) => { onLog(`  ✗ ${e.message}`); resolve({ code: -1 }); });
    child.on("close", (code) => resolve({ code }));
  });
}

/**
 * Run the whole pipeline, streaming to onLog. Resolves { ok, code }.
 * opts: { repoRoot, host, version, gitSha, builtAt, onLog }
 */
export async function runDeploy(opts) {
  const onLog = opts.onLog || (() => {});
  const steps = deploySteps(opts);
  onLog(`Deploying v${opts.version} (${opts.gitSha}) → ${opts.host || "stoanodeprime"}`);
  for (const step of steps) {
    onLog(`\n── ${step.label} ──`);
    const { code } = await runStep(step, onLog);
    if (code !== 0) { onLog(`\n✗ ${step.label} failed (exit ${code}). Aborting — the live site is unchanged (or rolled back).`); return { ok: false, failedAt: step.label }; }
  }
  onLog("\n✓ Deploy complete. Verify the version chip on the live site.");
  return { ok: true };
}
