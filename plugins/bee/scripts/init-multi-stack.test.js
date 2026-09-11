#!/usr/bin/env node
// Tests for init.md multi-stack detection feature
// Validates that the init command markdown contains the correct instructions
// for scanning subdirectories, detecting multiple stacks, and writing config.
// Since there is no test runner, this script validates behavior directly.

const fs = require('fs');
const path = require('path');

const INIT_MD = path.join(__dirname, '..', 'commands', 'init.md');
const CONFIG_TEMPLATE = path.join(__dirname, '..', 'skills', 'core', 'templates', 'project-config.json');

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

const initContent = fs.readFileSync(INIT_MD, 'utf8');
const configTemplate = fs.readFileSync(CONFIG_TEMPLATE, 'utf8');

console.log('Testing init.md multi-stack detection...\n');

// Test 1: Step 2 includes instruction to scan first-level subdirectories for manifest files
console.log('Test 1: Step 2 scans first-level subdirectories for manifests');
{
  // Should mention scanning subdirectories for package.json and composer.json
  assert(
    initContent.includes('*/package.json') || initContent.includes('first-level subdirector'),
    'Step 2 mentions scanning subdirectory manifests'
  );
  // Specifically should use Glob for subdirectory scanning
  assert(
    initContent.includes('*/package.json') && initContent.includes('*/composer.json'),
    'Uses glob patterns */package.json and */composer.json for subdirectory scanning'
  );
}

// Test 2: Step 2 instructs to analyze each manifest with the existing detection rules
console.log('Test 2: Each subdirectory manifest is analyzed with detection rules');
{
  // The instructions should mention applying detection rules to each found manifest
  assert(
    initContent.includes('each') && (initContent.includes('manifest') || initContent.includes('subdirectory')),
    'Instructions mention analyzing each manifest/subdirectory'
  );
}

// Test 3: Step 2 shows detected stack-path pairs to the developer
console.log('Test 3: Developer sees stack-path pairs');
{
  // Should show format like "stackname at 'path'"
  assert(
    initContent.includes('stack-path') || (initContent.includes(' at ') && initContent.includes("'.'")),
    'Shows stack-path pairs to developer'
  );
}

// Test 4: Developer can confirm, adjust, or remove detected stacks
console.log('Test 4: Developer can confirm, adjust, or remove entries');
{
  assert(
    initContent.includes('confirm') && initContent.includes('adjust') && initContent.includes('remove'),
    'Developer can confirm, adjust, or remove detected stacks'
  );
}

// Test 5: Developer can manually add stacks not auto-detected
console.log('Test 5: Developer can manually add stacks');
{
  assert(
    initContent.includes('manually add') || initContent.includes('add stack'),
    'Developer can manually add stacks not auto-detected'
  );
}

// Test 6: Step 4 writes stacks array with name and path fields
console.log('Test 6: Config writes stacks array with name and path');
{
  // The config template in Step 4 should show a stacks array with entries having name and path
  assert(
    initContent.includes('"stacks"') && initContent.includes('"name"') && initContent.includes('"path"'),
    'Config JSON in Step 4 has stacks array with name and path fields'
  );
}

// Test 7: Single-stack projects produce one-element stacks array with path "."
console.log('Test 7: Single-stack projects get path "."');
{
  assert(
    initContent.includes('"path": "."') || initContent.includes("path: '.'"),
    'Single-stack projects use path "."'
  );
}

// Test 8: The original detection rules table is still present and unchanged
console.log('Test 8: Original detection rules table preserved');
{
  assert(
    initContent.includes('laravel/framework') && initContent.includes('vue') && initContent.includes('laravel-inertia-vue'),
    'Laravel+Vue detection rule preserved'
  );
  assert(
    initContent.includes('@nestjs/core') && initContent.includes('nestjs'),
    'NestJS detection rule preserved'
  );
  assert(
    initContent.includes('expo') && initContent.includes('react-native') && initContent.includes('react-native-expo'),
    'React Native Expo detection rule preserved'
  );
  assert(
    initContent.includes('| `package.json` has `next`') && initContent.includes('nextjs'),
    'Next.js detection rule preserved exactly'
  );
}

// Test 9: Multi-stack example prompt shows realistic output
console.log('Test 9: Multi-stack example shows realistic format');
{
  // Should have an example like "laravel-inertia-vue at '.'" or similar multi-stack display
  assert(
    initContent.includes("Detected stacks:") || initContent.includes("detected stack"),
    'Has a multi-stack detection prompt/example'
  );
}

// Test 10: Project Detection section scans subdirectory manifests
console.log('Test 10: Project Detection section includes subdirectory scanning');
{
  // The Project Detection block at the top should mention scanning subdirectories
  // or the Step 2 should include Glob instructions for subdirectory manifests
  const hasGlobInstruction = initContent.includes('Glob') && initContent.includes('*/package.json');
  assert(
    hasGlobInstruction,
    'Uses Glob tool to find subdirectory manifests'
  );
}

// Test 11: Config template still has stacks array format
console.log('Test 11: Config template uses stacks array format');
{
  const templateData = JSON.parse(configTemplate);
  assert(
    Array.isArray(templateData.stacks),
    'Config template has stacks as array'
  );
  assert(
    templateData.stacks[0].name === '{STACK}',
    'Config template stacks[0].name is placeholder'
  );
  assert(
    templateData.stacks[0].path === '.',
    'Config template stacks[0].path is "."'
  );
}

// Test 12: Step 4 config block shows multiple stacks example or instruction
console.log('Test 12: Step 4 handles multiple stack entries in config');
{
  // Step 4 should explain how to write multiple entries in the stacks array
  // when multiple stacks are confirmed
  const step4Match = initContent.includes('confirmed stack-path pair') ||
    initContent.includes('one entry per') ||
    initContent.includes('each confirmed');
  assert(
    step4Match,
    'Step 4 writes one config entry per confirmed stack-path pair'
  );
}

// Test 13: Single-stack backward compatibility is preserved
console.log('Test 13: Single-stack backward compatibility');
{
  // The init command should still handle single-stack projects normally
  assert(
    initContent.includes('single') || initContent.includes('one manifest') || initContent.includes('only one'),
    'Mentions single-stack/single-manifest case for backward compatibility'
  );
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
