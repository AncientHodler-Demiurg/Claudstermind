#!/usr/bin/env node
// Nectar consistency check — guards the invariants that keep the plugin coherent:
// 1. Shared discipline blocks are byte-identical everywhere they appear
//    (finding format, severity scale, verdict definitions).
// 2. Every SKILL.md has frontmatter with a name and a description that states
//    both its triggers ("Use when") and its boundary ("Not for").
// 3. The README skill table matches the skills that exist on disk.
// 4. Agents referenced by skills exist as files; agent frontmatter is sane.
// 5. plugin.json, marketplace.json, and CHANGELOG.md agree on the version.
//
// Zero dependencies. Exit 0 = all pass, exit 1 = failures printed.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };

// --- helpers ---------------------------------------------------------------

function extractSection(content, heading) {
  // Returns the body of a "## heading" section up to the next "## " or EOF.
  const re = new RegExp(`^## ${heading}\\s*$`, 'm');
  const m = content.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = content.slice(start);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function extractFencedBlock(sectionBody) {
  const m = sectionBody && sectionBody.match(/```(?:markdown)?\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}

function extractBullets(sectionBody, prefixes) {
  if (!sectionBody) return null;
  return sectionBody
    .split('\n')
    .filter((l) => prefixes.some((p) => l.trim().startsWith(p)))
    .map((l) => l.trim())
    .join('\n');
}

function frontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

function fmField(fm, field) {
  const m = fm && fm.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

// --- load files ------------------------------------------------------------

const skillDirs = fs
  .readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const skills = Object.fromEntries(
  skillDirs.map((s) => [s, read(`skills/${s}/SKILL.md`)])
);
const agents = {
  implementer: read('agents/implementer.md'),
  lens: read('agents/lens.md'),
  validator: read('agents/validator.md'),
};

console.log('nectar consistency check\n');

// --- 1. shared blocks stay identical ----------------------------------------

console.log('shared blocks:');

const findingFormatCopies = {
  'review SKILL': extractFencedBlock(extractSection(skills.review, 'Finding format')),
  'audit SKILL': extractFencedBlock(extractSection(skills.audit, 'Finding format')),
  'lens agent': extractFencedBlock(extractSection(agents.lens, 'Finding format')),
};
compareCopies('finding format', findingFormatCopies);

const severityCopies = {
  'review SKILL': extractBullets(extractSection(skills.review, 'Severity scale'), ['- CRITICAL', '- HIGH', '- MEDIUM', '- LOW']),
  'audit SKILL': extractBullets(extractSection(skills.audit, 'Severity scale'), ['- CRITICAL', '- HIGH', '- MEDIUM', '- LOW']),
  'lens agent': extractBullets(extractSection(agents.lens, 'Severity scale'), ['- CRITICAL', '- HIGH', '- MEDIUM', '- LOW']),
  'validator agent': extractBullets(extractSection(agents.validator, 'Severity scale'), ['- CRITICAL', '- HIGH', '- MEDIUM', '- LOW']),
};
compareCopies('severity scale', severityCopies);

// Definition lines only: "- VERDICT — <definition>". Prose lines that merely
// start with a verdict name (e.g. "- STYLISTIC findings are presented...") don't count.
const verdictPrefixes = ['- CONFIRMED — ', '- REFUTED — ', '- STYLISTIC — '];
const verdictCopies = {
  'review SKILL': extractBullets(skills.review, verdictPrefixes),
  'audit SKILL': extractBullets(skills.audit, verdictPrefixes),
  'validator agent': extractBullets(extractSection(agents.validator, 'Verdicts'), verdictPrefixes),
};
compareCopies('verdict definitions', verdictCopies);

function compareCopies(label, copies) {
  const entries = Object.entries(copies);
  const missing = entries.filter(([, v]) => !v);
  if (missing.length) {
    fail(`${label}: missing in ${missing.map(([k]) => k).join(', ')}`);
    return;
  }
  const [refName, refVal] = entries[0];
  const diverged = entries.filter(([, v]) => v !== refVal);
  if (diverged.length) {
    fail(`${label}: diverged from ${refName} in ${diverged.map(([k]) => k).join(', ')}`);
  } else {
    pass(`${label}: identical across ${entries.map(([k]) => k).join(', ')}`);
  }
}

// --- 2. skill frontmatter ----------------------------------------------------

console.log('\nskill frontmatter:');

for (const [name, content] of Object.entries(skills)) {
  const fm = frontmatter(content);
  const fmName = fmField(fm, 'name');
  const desc = fmField(fm, 'description') || '';
  if (fmName !== name) fail(`${name}: frontmatter name "${fmName}" != directory name`);
  else if (!/^Use (when|for|after)/.test(desc)) fail(`${name}: description must open with its trigger ("Use when/for/after ...")`);
  else if (!desc.includes('Not for')) fail(`${name}: description must state a "Not for" boundary`);
  else pass(`${name}: name, triggers, and boundary present`);
}

// --- 3. README table matches disk ---------------------------------------------

console.log('\nreadme:');

const readme = read('README.md');
// Skill rows are "| name |" with a bare lowercase word; the agents table uses
// backticked `nectar:*` names, so it never matches this pattern.
const tableSkills = [...readme.matchAll(/^\| (\w[\w-]*) \|/gm)]
  .map((m) => m[1])
  .filter((s) => s !== 'Skill' && s !== 'Agent');
const missingRows = skillDirs.filter((s) => !tableSkills.includes(s));
const extraRows = tableSkills.filter((s) => !skillDirs.includes(s));
if (missingRows.length) fail(`README table missing skills: ${missingRows.join(', ')}`);
else if (extraRows.length) fail(`README table lists skills that do not exist on disk: ${extraRows.join(', ')}`);
else pass(`README table matches skills on disk (${skillDirs.length} skills)`);

// --- 4. agent references + frontmatter ----------------------------------------

console.log('\nagents:');

const referenced = new Set();
for (const content of Object.values(skills)) {
  for (const m of content.matchAll(/nectar:(\w+)/g)) referenced.add(m[1]);
}
for (const ref of referenced) {
  if (!agents[ref]) fail(`skills reference nectar:${ref} but agents/${ref}.md does not exist`);
  else pass(`nectar:${ref} referenced by skills and exists on disk`);
}
for (const [name, content] of Object.entries(agents)) {
  const fm = frontmatter(content);
  const tools = fmField(fm, 'tools') || '';
  if (fmField(fm, 'name') !== name) fail(`agent ${name}: frontmatter name mismatch`);
  if ((name === 'lens' || name === 'validator') && /\b(Write|Edit|Bash)\b/.test(tools)) {
    fail(`agent ${name}: must be read-only but declares tools: ${tools}`);
  } else {
    pass(`agent ${name}: frontmatter and tool restrictions sane`);
  }
}

// --- 5. version agreement ------------------------------------------------------

console.log('\nversion:');

const pluginVersion = JSON.parse(read('.claude-plugin/plugin.json')).version;
const changelog = read('CHANGELOG.md');
if (!changelog.includes(`## ${pluginVersion} `) && !changelog.includes(`## ${pluginVersion}\n`)) {
  fail(`plugin.json version ${pluginVersion} has no CHANGELOG heading`);
} else {
  pass(`plugin.json ${pluginVersion} has a CHANGELOG entry`);
}
const marketplacePath = path.join(ROOT, '..', '..', '.claude-plugin', 'marketplace.json');
if (fs.existsSync(marketplacePath)) {
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  const entry = (marketplace.plugins || []).find((p) => p.name === 'nectar');
  if (!entry) fail('marketplace.json has no nectar entry');
  else if (entry.version !== pluginVersion) fail(`marketplace.json nectar version ${entry.version} != plugin.json ${pluginVersion}`);
  else pass(`marketplace.json agrees on ${pluginVersion}`);
}

// --- result ---------------------------------------------------------------------

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
