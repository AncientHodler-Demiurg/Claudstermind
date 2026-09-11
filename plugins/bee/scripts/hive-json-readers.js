#!/usr/bin/env node
// hive-json-readers.js
// Read-only helpers for loading .bee/ JSON artifacts used by the Bee Hive
// dashboard server. Every reader returns null (or an empty array where the
// contract demands a collection) when the source file is missing or contains
// invalid JSON. Readers never throw on IO or parse errors — the caller can
// trust the return shape and render a graceful fallback.

const fs = require('fs');
const path = require('path');

/**
 * Parse a JSON file from disk. Returns null when the file does not exist or
 * its contents cannot be parsed as JSON. Never throws.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @returns {any|null} Parsed JSON value, or null on any error.
 */
function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read `{beeDir}/config.json`.
 *
 * @param {string} beeDir Absolute path to the project's `.bee` directory.
 * @returns {object|null} Parsed config object, or null if missing/invalid.
 */
function readConfig(beeDir) {
  return safeReadJson(path.join(beeDir, 'config.json'));
}

/**
 * Read `{beeDir}/metrics/health-history.json`.
 *
 * @param {string} beeDir Absolute path to the project's `.bee` directory.
 * @returns {Array|null} Parsed health history array, or null if missing/invalid.
 */
function readHealthHistory(beeDir) {
  return safeReadJson(path.join(beeDir, 'metrics', 'health-history.json'));
}

/**
 * Scan `{beeDir}/metrics/` for per-spec subdirectories and collect every
 * `phase-*.json` file inside each one. Returns an array of objects, one per
 * spec folder, of the form:
 *
 *   [
 *     { spec: '2026-04-10-my-spec', phases: [ { ...phase1 }, { ...phase2 } ] },
 *     ...
 *   ]
 *
 * Files that fail to parse are skipped (not fatal). If the metrics directory
 * does not exist, returns an empty array.
 *
 * @param {string} beeDir Absolute path to the project's `.bee` directory.
 * @returns {Array<{spec: string, phases: Array<object>}>} Grouped phase metrics.
 */
function readPhaseMetrics(beeDir) {
  const metricsDir = path.join(beeDir, 'metrics');

  let entries;
  try {
    entries = fs.readdirSync(metricsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const groups = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const specName = entry.name;
    const specDir = path.join(metricsDir, specName);

    let specFiles;
    try {
      specFiles = fs.readdirSync(specDir);
    } catch {
      continue;
    }

    const phases = [];
    for (const file of specFiles) {
      if (!file.startsWith('phase-') || !file.endsWith('.json')) continue;
      const parsed = safeReadJson(path.join(specDir, file));
      if (parsed !== null) {
        phases.push(parsed);
      }
    }

    groups.push({ spec: specName, phases });
  }

  return groups;
}

/**
 * Read `{beeDir}/workspaces.json` if present.
 *
 * @param {string} beeDir Absolute path to the project's `.bee` directory.
 * @returns {object|null} Parsed workspaces object, or null if missing/invalid.
 */
function readWorkspaces(beeDir) {
  return safeReadJson(path.join(beeDir, 'workspaces.json'));
}

module.exports = {
  readConfig,
  readHealthHistory,
  readPhaseMetrics,
  readWorkspaces,
};
