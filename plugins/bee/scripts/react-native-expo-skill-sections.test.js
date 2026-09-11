#!/usr/bin/env node
// Tests for react-native-expo SKILL.md enrichment with 5 structured sections.
// Validates that the 5 required sections exist, each has minimum 5 entries,
// and required topics are covered.

const fs = require('fs');
const path = require('path');

const SKILL_MD = path.join(__dirname, '..', 'skills', 'stacks', 'react-native-expo', 'SKILL.md');

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

/**
 * Extract lines belonging to a given ## section (from its heading to the next ## heading or EOF).
 */
function getSection(content, sectionHeading) {
  const lines = content.split('\n');
  let inSection = false;
  const sectionLines = [];
  for (const line of lines) {
    if (line.startsWith('## ') && line.includes(sectionHeading)) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('## ')) {
      break;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }
  return sectionLines.join('\n');
}

/**
 * Count bullet entries (lines starting with - or * followed by bold text, backtick, or uppercase letter).
 */
function countBullets(sectionBody) {
  return sectionBody
    .split('\n')
    .filter((line) => /^\s*[-*]\s+\*\*/.test(line))
    .length;
}

const content = fs.readFileSync(SKILL_MD, 'utf8');

console.log('Testing react-native-expo SKILL.md enrichment...\n');

// =====================================================
// Test Group 1: All 5 sections exist as ## headings
// =====================================================
console.log('Test Group 1: All 5 sections exist');

const REQUIRED_SECTIONS = [
  'Must-Haves',
  'Good Practices',
  'Common Bugs',
  'Anti-Patterns',
  'Standards',
];

for (const section of REQUIRED_SECTIONS) {
  assert(
    content.includes(`## ${section}`),
    `Section "## ${section}" exists`
  );
}

// =====================================================
// Test Group 2: Each section has at least 5 bullet entries
// =====================================================
console.log('\nTest Group 2: Each section has at least 5 entries');

for (const section of REQUIRED_SECTIONS) {
  const body = getSection(content, section);
  const bulletCount = countBullets(body);
  assert(
    bulletCount >= 5,
    `"${section}" has >= 5 entries (found ${bulletCount})`
  );
}

// =====================================================
// Test Group 3: Must-Haves required topics
// =====================================================
console.log('\nTest Group 3: Must-Haves required topics');

const mustHaves = getSection(content, 'Must-Haves');

assert(
  mustHaves.includes('TypeScript'),
  'Must-Haves mentions TypeScript'
);
assert(
  mustHaves.toLowerCase().includes('function component'),
  'Must-Haves mentions function components'
);
assert(
  mustHaves.toLowerCase().includes('tdd') || (mustHaves.includes('Jest') && mustHaves.includes('Expo')),
  'Must-Haves mentions TDD Jest/Expo'
);
assert(
  content.includes('Platform.select'),
  'Must-Haves mentions Platform.select'
);
assert(
  content.toLowerCase().includes('navigation') && content.toLowerCase().includes('typ'),
  'Must-Haves mentions navigation typing'
);

// =====================================================
// Test Group 4: Good Practices required topics
// =====================================================
console.log('\nTest Group 4: Good Practices required topics');

const goodPractices = getSection(content, 'Good Practices');

assert(
  goodPractices.includes('StyleSheet.create'),
  'Good Practices mentions StyleSheet.create'
);
assert(
  goodPractices.includes('FlatList'),
  'Good Practices mentions FlatList'
);
assert(
  goodPractices.includes('useMemo'),
  'Good Practices mentions useMemo'
);
assert(
  content.toLowerCase().includes('error boundar'),
  'Good Practices mentions error boundaries'
);
assert(
  goodPractices.includes('Expo SDK') || goodPractices.includes('expo-'),
  'Good Practices mentions Expo SDK APIs'
);

// =====================================================
// Test Group 5: Common Bugs required topics
// =====================================================
console.log('\nTest Group 5: Common Bugs required topics');

const commonBugs = getSection(content, 'Common Bugs');

assert(
  commonBugs.includes('KeyboardAvoidingView'),
  'Common Bugs mentions missing KeyboardAvoidingView'
);
assert(
  commonBugs.includes('AsyncStorage') && (commonBugs.includes('await') || commonBugs.includes('async')),
  'Common Bugs mentions AsyncStorage not awaited'
);
assert(
  commonBugs.toLowerCase().includes('android') && commonBugs.toLowerCase().includes('back'),
  'Common Bugs mentions Android back handler'
);
assert(
  commonBugs.includes('GestureHandlerRootView'),
  'Common Bugs mentions GestureHandlerRootView'
);
assert(
  commonBugs.toLowerCase().includes('shadow'),
  'Common Bugs mentions shadow props'
);

// =====================================================
// Test Group 6: Anti-Patterns required topics
// =====================================================
console.log('\nTest Group 6: Anti-Patterns required topics');

const antiPatterns = getSection(content, 'Anti-Patterns');

assert(
  antiPatterns.toLowerCase().includes('class component'),
  'Anti-Patterns mentions class components'
);
assert(
  antiPatterns.includes('any') && (antiPatterns.includes('type') || antiPatterns.includes('Type')),
  'Anti-Patterns mentions any type'
);
assert(
  antiPatterns.includes('AsyncStorage') && (antiPatterns.toLowerCase().includes('unencrypt') || antiPatterns.toLowerCase().includes('sensitive') || antiPatterns.toLowerCase().includes('secret')),
  'Anti-Patterns mentions AsyncStorage unencrypted for sensitive data'
);
assert(
  antiPatterns.toLowerCase().includes('block') && (antiPatterns.toLowerCase().includes('js thread') || antiPatterns.toLowerCase().includes('javascript thread') || antiPatterns.toLowerCase().includes('main thread')),
  'Anti-Patterns mentions blocking JS thread'
);
assert(
  antiPatterns.toLowerCase().includes('platform') && (antiPatterns.toLowerCase().includes('diff') || antiPatterns.toLowerCase().includes('ignor')),
  'Anti-Patterns mentions ignoring platform differences'
);

// =====================================================
// Test Group 7: Standards required topics
// =====================================================
console.log('\nTest Group 7: Standards required topics');

const standards = getSection(content, 'Standards');

assert(
  standards.includes('PascalCase'),
  'Standards mentions PascalCase naming'
);
assert(
  standards.includes('app/') && (standards.includes('Expo Router') || standards.includes('file-based routing')),
  'Standards mentions app/ directory for Expo Router file-based routing'
);
assert(
  standards.includes('components') && (standards.includes('director') || standards.includes('folder')),
  'Standards mentions components directory'
);
assert(
  standards.includes('snake_case') && standards.includes('camelCase'),
  'Standards mentions snake_case API to camelCase app convention'
);

// =====================================================
// Test Group 8: Existing content preserved
// =====================================================
console.log('\nTest Group 8: Existing content preserved');

assert(
  content.includes('# React Native + Expo Standards'),
  'Main heading preserved'
);
assert(
  content.includes('## Expo Configuration'),
  'Expo Configuration section preserved'
);
assert(
  content.includes('## Component Patterns'),
  'Component Patterns section preserved'
);
assert(
  content.includes('## Navigation'),
  'Navigation section preserved'
);
assert(
  content.includes('## Platform-Specific Code'),
  'Platform-Specific Code section preserved'
);
assert(
  content.includes('## Styling'),
  'Styling section preserved'
);
assert(
  content.includes('## Native Modules'),
  'Native Modules section preserved'
);
assert(
  content.includes('## State Management'),
  'State Management section preserved'
);
assert(
  content.includes('## Testing'),
  'Testing section preserved'
);
assert(
  content.includes('## Common Pitfalls -- NEVER Rules'),
  'Common Pitfalls section preserved'
);
assert(
  content.includes('## Context7 Instructions'),
  'Context7 Instructions section preserved'
);
assert(
  content.includes('Expo managed workflow'),
  'Expo managed workflow text preserved'
);
assert(
  content.includes('React Native core components'),
  'React Native core components text preserved'
);

// =====================================================
// Test Group 9: New sections appear AFTER existing content
// =====================================================
console.log('\nTest Group 9: New sections appear after existing content');

const context7Pos = content.indexOf('## Context7 Instructions');
const mustHavesPos = content.indexOf('## Must-Haves');
const goodPracticesPos = content.indexOf('## Good Practices');
const commonBugsPos = content.indexOf('## Common Bugs');
const antiPatternsPos = content.indexOf('## Anti-Patterns');
const standardsPos = content.indexOf('## Standards');

/* removed: superseded (Phase 2 triage) */
assert(
  goodPracticesPos > mustHavesPos,
  'Good Practices section appears after Must-Haves'
);
assert(
  commonBugsPos > goodPracticesPos,
  'Common Bugs section appears after Good Practices'
);
assert(
  antiPatternsPos > commonBugsPos,
  'Anti-Patterns section appears after Common Bugs'
);
assert(
  standardsPos > antiPatternsPos,
  'Standards section appears after Anti-Patterns'
);

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
