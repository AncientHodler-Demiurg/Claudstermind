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
  const stamp = `CM_VERSION=${SAFE(version)} CM_GIT_SHA=${SAFE(gitSha)} CM_BUILT_AT=${SAFE(builtAt)}`;
  // Box-side: tag a rollback image, extract over the deploy dir (relay/.env + the override are
  // excluded from the tar, so both survive), rebuild the relay service ONLY (never caddy), then
  // HEALTH-CHECK the new container — if it builds but crash-loops, restore the rollback image so
  // a runtime-broken build never takes the live site down.
  const box = [
    `set -e`,
    `docker tag claudstermind-relay:latest claudstermind-relay:rollback 2>/dev/null || true`,
    `cd ${remoteDir}`,
    `tar xzf ${tarball}`,
    `test -f relay/.env || { echo "FATAL relay/.env missing on the box"; exit 3; }`,
    `cd relay`,
    `${stamp} docker compose up -d --build relay`,
    `set +e`,
    // wait up to ~45s for the Dockerfile HEALTHCHECK to report healthy; roll back otherwise
    `ok=0; for i in $(seq 1 15); do st=$(docker inspect -f '{{.State.Health.Status}}' relay-relay-1 2>/dev/null); echo "health: $st"; [ "$st" = healthy ] && { ok=1; break; }; [ "$st" = unhealthy ] && break; sleep 3; done`,
    `if [ "$ok" != 1 ]; then echo "✗ new container unhealthy — rolling back to claudstermind-relay:rollback"; docker tag claudstermind-relay:rollback claudstermind-relay:latest && docker compose up -d relay; exit 1; fi`,
    `docker ps --filter name=relay-relay-1 --format 'relay: {{.Status}}'`,
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
