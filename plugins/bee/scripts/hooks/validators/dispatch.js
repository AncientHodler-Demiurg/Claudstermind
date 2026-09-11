#!/usr/bin/env node
// SubagentStop dispatcher — routes to the right per-agent validator IN-PROCESS,
// replacing the 25 per-agent hooks.json matcher entries. Rules are the original
// hooks.json matchers, verbatim and in order; first match wins (the matchers are
// mutually exclusive, so this equals the harness running the single matching one).
const path = require('path');
const { readStdinSync, safeJsonParse, emitVerdict } = require('./validators-lib.js');

function stripBee(a) { return typeof a === 'string' ? a.replace(/^bee:/, '') : ''; }

// [regex, validator-filename] — ORDER MATTERS (mirrors hooks.json top-to-bottom).
const RULES = [
  [/(?<!quick-)implementer$/, 'implementer'],
  [/^fixer$/, 'fixer'],
  [/^researcher$/, 'researcher'],
  [/^assumptions-analyzer$/, 'assumptions-analyzer'],
  [/^dependency-auditor$/, 'dependency-auditor'],
  [/(?<!audit-)bug-detector$/, 'bug-detector'],
  [/pattern-reviewer$/, 'pattern-reviewer'],
  [/^plan-compliance-reviewer$/, 'plan-compliance-reviewer'],
  [/stack-reviewer$/, 'stack-reviewer'],
  [/^quick-implementer$/, 'quick-implementer'],
  [/^security-auditor$/, 'security-auditor'],
  [/^error-handling-auditor$/, 'error-handling-auditor'],
  [/^database-auditor$/, 'database-auditor'],
  [/^architecture-auditor$/, 'architecture-auditor'],
  [/^api-auditor$/, 'api-auditor'],
  [/^frontend-auditor$/, 'frontend-auditor'],
  [/^performance-auditor$/, 'performance-auditor'],
  [/^testing-auditor$/, 'testing-auditor'],
  [/^audit-bug-detector$/, 'audit-bug-detector'],
  [/^audit-finding-validator$/, 'audit-finding-validator'],
  [/^finding-validator$/, 'finding-validator'],
  [/^audit-report-generator$/, 'audit-report-generator'],
  [/^debug-investigator$/, 'debug-investigator'],
  [/^integration-checker$/, 'integration-checker'],
  [/^swarm-consolidator$/, 'swarm-consolidator'],
];

function pickValidator(agentType) {
  const a = stripBee(agentType);
  for (const [re, name] of RULES) if (re.test(a)) return name;
  return null;
}

function main(rawInput) {
  const raw = typeof rawInput === 'string' ? rawInput : readStdinSync();
  const payload = safeJsonParse(raw);
  const name = pickValidator(payload && payload.agent_type);
  if (!name) return; // no validator for this agent — no-op (same as no matching hook)
  require('./' + name + '.js').main(raw);
}

if (require.main === module) {
  try { main(); } catch (err) { emitVerdict(false, 'dispatch threw: ' + ((err && err.message) || String(err))); }
  process.exit(0);
}

module.exports = { pickValidator, main };
