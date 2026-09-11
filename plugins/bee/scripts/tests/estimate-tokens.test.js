#!/usr/bin/env node
// Test: estimate-tokens.js produces a heat-map markdown + JSON sidecar
// covering plugins/bee/agents, plugins/bee/commands, plugins/bee/skills,
// and plugins/bee/hooks/hooks.json. Verifies:
//   - script file exists at the canonical path
//   - script runs to completion via `node` with no error
//   - markdown output contains required sections
//   - top-20 entries are sorted descending by token count
//   - JSON sidecar exists with required fields
//   - pipeline cost table includes worst-case + best-case rows for all 3 pipelines

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const os = require('os');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const SCRIPT_PATH = path.join(PLUGIN_DIR, 'scripts', 'estimate-tokens.js');
const REPO_ROOT = path.join(PLUGIN_DIR, '..', '..');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Script existence + structural sanity
// ---------------------------------------------------------------------------

console.log('=== estimate-tokens.js: file existence ===');

assert(fs.existsSync(SCRIPT_PATH), 'estimate-tokens.js exists at plugins/bee/scripts/');

const scriptSrc = readFile(SCRIPT_PATH);
assert(scriptSrc !== null, 'estimate-tokens.js is readable');

if (scriptSrc !== null) {
  assert(
    /^#!\/usr\/bin\/env node/.test(scriptSrc),
    'estimate-tokens.js has the canonical Node shebang'
  );
  assert(
    /chars\s*\/\s*4|content\.length\s*\/\s*4/i.test(scriptSrc),
    'estimate-tokens.js header documents the chars/4 approximation'
  );
  assert(
    /(10|15)\s*%/.test(scriptSrc),
    'estimate-tokens.js header documents the 10-15% accuracy bound'
  );
}

// ---------------------------------------------------------------------------
// 2. Run the script in a sandbox repo root (we point it at the real repo)
// ---------------------------------------------------------------------------

console.log('\n=== estimate-tokens.js: execution ===');

// Create a temp output dir so we don't clobber the committed artifacts during
// the test run. The script accepts BEE_METRICS_DIR + BEE_DATE env overrides.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estimate-tokens-test-'));
const FIXED_DATE = '2099-01-01';

let runOk = false;
let runErr = null;
try {
  // execFileSync (not exec) -- argv array, no shell interpretation.
  childProcess.execFileSync('node', [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BEE_METRICS_DIR: tmpDir,
      BEE_DATE: FIXED_DATE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  runOk = true;
} catch (e) {
  runErr = e;
}

assert(runOk, `estimate-tokens.js runs without error${runErr ? ' (' + runErr.message + ')' : ''}`);

// ---------------------------------------------------------------------------
// 3. Markdown output structure
// ---------------------------------------------------------------------------

console.log('\n=== heat-map markdown output ===');

const mdPath = path.join(tmpDir, `heat-map-${FIXED_DATE}.md`);
const md = readFile(mdPath);
assert(md !== null, `heat-map markdown exists at ${mdPath}`);

if (md !== null) {
  assert(/^#\s*Token Heat-Map/m.test(md), 'markdown has "# Token Heat-Map" heading');
  assert(/^##\s*Summary/m.test(md), 'markdown has "## Summary" section');
  assert(/^##\s*Top 20 Token Sinks/m.test(md), 'markdown has "## Top 20 Token Sinks" section');
  assert(
    /^##\s*Pipeline Cost Simulations/m.test(md),
    'markdown has "## Pipeline Cost Simulations" section'
  );
  assert(/^##\s*Methodology/m.test(md), 'markdown has "## Methodology" section');
  assert(/chars\s*\/\s*4/i.test(md), 'methodology section documents chars/4 approximation');
  assert(/(10|15)\s*%/.test(md), 'methodology section documents 10-15% accuracy bound');

  // Top-20 table: parse the rows and verify descending sort by token count.
  const top20Match = md.match(/##\s*Top 20 Token Sinks[\s\S]*?(?=\n##\s|$)/);
  assert(top20Match !== null, 'top-20 section can be extracted');
  if (top20Match) {
    const tableBlock = top20Match[0];
    const rowRe = /\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/g;
    const tokens = [];
    let m;
    while ((m = rowRe.exec(tableBlock)) !== null) {
      tokens.push(parseInt(m[2], 10));
    }
    assert(tokens.length > 0, 'top-20 table contains at least one row');
    assert(tokens.length <= 20, 'top-20 table contains at most 20 rows');
    let sortedDesc = true;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i] > tokens[i - 1]) {
        sortedDesc = false;
        break;
      }
    }
    assert(sortedDesc, 'top-20 entries are sorted descending by token count');
    // F-002 regression: top-20 table must include a "% of category total" column.
    assert(
      /%\s*of\s*category\s*total/i.test(tableBlock),
      'top-20 table header includes "% of category total" column'
    );
    assert(
      /\d+\.\d+%/.test(tableBlock),
      'top-20 table rows render percentages as XX.X%'
    );
  }

  // Pipeline cost table: verify each pipeline appears with worst+best rows.
  const pipelineSection = md.match(/##\s*Pipeline Cost Simulations[\s\S]*?(?=\n##\s|$)/);
  assert(pipelineSection !== null, 'pipeline cost simulations section can be extracted');
  if (pipelineSection) {
    const block = pipelineSection[0];
    for (const pipeline of ['/bee:review', '/bee:ship', '/bee:quick']) {
      assert(block.includes(pipeline), `pipeline section names ${pipeline}`);
    }
    // Count Worst / Best occurrences -- must be at least 3 of each (one per pipeline).
    const worstCount = (block.match(/Worst/g) || []).length;
    const bestCount = (block.match(/Best/g) || []).length;
    assert(worstCount >= 3, `pipeline section has worst-case rows for all 3 pipelines (found ${worstCount})`);
    assert(bestCount >= 3, `pipeline section has best-case rows for all 3 pipelines (found ${bestCount})`);
    // F-001 regression: each pipeline table must include the "Refactor savings (projected)" row.
    const refactorRowCount = (block.match(/Refactor savings \(projected\)/g) || []).length;
    assert(
      refactorRowCount >= 3,
      `pipeline section has refactor-savings row for all 3 pipelines (found ${refactorRowCount})`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. JSON sidecar
// ---------------------------------------------------------------------------

console.log('\n=== heat-map JSON sidecar ===');

const jsonPath = path.join(tmpDir, `heat-map-${FIXED_DATE}.json`);
const jsonSrc = readFile(jsonPath);
assert(jsonSrc !== null, `heat-map JSON sidecar exists at ${jsonPath}`);

if (jsonSrc !== null) {
  let parsed = null;
  try {
    parsed = JSON.parse(jsonSrc);
  } catch (_e) {
    parsed = null;
  }
  assert(parsed !== null, 'JSON sidecar is valid JSON');

  if (parsed) {
    assert(typeof parsed.generated_at === 'string', 'JSON has generated_at (ISO string)');
    assert(parsed.approximation === 'chars/4', 'JSON has approximation = "chars/4"');
    assert(
      parsed.totals_by_type && typeof parsed.totals_by_type === 'object',
      'JSON has totals_by_type object'
    );
    for (const t of ['agents', 'commands', 'skills', 'hooks']) {
      assert(
        typeof parsed.totals_by_type[t] === 'number',
        `totals_by_type.${t} is a number`
      );
    }

    assert(Array.isArray(parsed.top_sinks), 'JSON has top_sinks array');
    assert(parsed.top_sinks.length > 0, 'top_sinks has at least one entry');
    assert(parsed.top_sinks.length <= 20, 'top_sinks has at most 20 entries');
    if (parsed.top_sinks[0]) {
      const first = parsed.top_sinks[0];
      assert(typeof first.path === 'string', 'top_sinks[0].path is a string');
      assert(typeof first.tokens === 'number', 'top_sinks[0].tokens is a number');
      assert(typeof first.type === 'string', 'top_sinks[0].type is a string');
    }
    // Verify top_sinks descending sort.
    let topSorted = true;
    for (let i = 1; i < parsed.top_sinks.length; i++) {
      if (parsed.top_sinks[i].tokens > parsed.top_sinks[i - 1].tokens) {
        topSorted = false;
        break;
      }
    }
    assert(topSorted, 'top_sinks is sorted descending by tokens');

    assert(parsed.pipelines && typeof parsed.pipelines === 'object', 'JSON has pipelines object');
    for (const p of ['review', 'ship', 'quick']) {
      assert(
        parsed.pipelines[p] && typeof parsed.pipelines[p] === 'object',
        `pipelines.${p} is an object`
      );
      if (parsed.pipelines[p]) {
        assert(typeof parsed.pipelines[p].worst === 'number', `pipelines.${p}.worst is a number`);
        assert(typeof parsed.pipelines[p].best === 'number', `pipelines.${p}.best is a number`);
        assert(
          typeof parsed.pipelines[p].agent_count === 'number',
          `pipelines.${p}.agent_count is a number`
        );
        assert(
          parsed.pipelines[p].best <= parsed.pipelines[p].worst,
          `pipelines.${p}: best <= worst (caching cannot make it worse)`
        );
        // F-001 regression: refactor_savings must be a positive number (each
        // pipeline includes at least one finding-producing reviewer agent).
        assert(
          typeof parsed.pipelines[p].refactor_savings === 'number',
          `pipelines.${p}.refactor_savings is a number`
        );
        assert(
          parsed.pipelines[p].refactor_savings > 0,
          `pipelines.${p}.refactor_savings is positive`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. F-004 regression: malformed BEE_DATE must be rejected (no path traversal)
// ---------------------------------------------------------------------------

console.log('\n=== BEE_DATE input validation (F-004) ===');

const traversalTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estimate-tokens-traversal-'));
const TODAY = new Date().toISOString().slice(0, 10);
let traversalRunOk = false;
let traversalStderr = '';
try {
  const result = childProcess.spawnSync('node', [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BEE_METRICS_DIR: traversalTmpDir,
      BEE_DATE: '../../../tmp/pwned',
    },
    encoding: 'utf8',
  });
  traversalRunOk = result.status === 0;
  traversalStderr = result.stderr || '';
} catch (_e) {
  traversalRunOk = false;
}

assert(traversalRunOk, 'estimate-tokens.js still completes when BEE_DATE is malformed (no throw)');
assert(
  /BEE_DATE rejected/i.test(traversalStderr),
  'malformed BEE_DATE produces a warning on stderr'
);

// Today's-date filename should exist; the malformed-date filename should NOT,
// and nothing should escape the traversal tmp dir.
const todayMd = path.join(traversalTmpDir, `heat-map-${TODAY}.md`);
const todayJson = path.join(traversalTmpDir, `heat-map-${TODAY}.json`);
assert(fs.existsSync(todayMd), 'fallback uses today\'s date for the markdown file');
assert(fs.existsSync(todayJson), 'fallback uses today\'s date for the JSON sidecar');

// Confirm no traversal-named file was written anywhere outside the tmp dir.
// (path.join would have collapsed the .. segments and escaped traversalTmpDir.)
const escapedPath = path.join(traversalTmpDir, 'heat-map-../../../tmp/pwned.md');
const normalizedEscape = path.normalize(escapedPath);
assert(
  !fs.existsSync(normalizedEscape),
  'malformed BEE_DATE does not produce a traversal-escaped file'
);

try {
  fs.rmSync(traversalTmpDir, { recursive: true, force: true });
} catch (_e) {
  // Best effort; not a test failure.
}

// ---------------------------------------------------------------------------
// Cleanup + results
// ---------------------------------------------------------------------------

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (_e) {
  // Best effort; not a test failure.
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
