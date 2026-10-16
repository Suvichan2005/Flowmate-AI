/**
 * Flowmate Architectural Invariant Checker — Platform Boundary (P1-08)
 *
 * Mechanically verifies that:
 * 1. Flowmate Core (kernel, context, ai, platform ports) contains NO direct
 *    imports of React, ReactDOM, or Firebase SDKs.
 * 2. Flowmate Core contains NO direct usage of browser/DOM globals
 *    (window, document, navigator.geolocation, navigator.vibrate, Notification).
 * 3. Services Platform contracts and adapters strictly adhere to ZERO `any`.
 */

import fs from 'node:fs';
import path from 'node:path';

const CORE_DIRS = [
  'services/kernel',
  'services/context',
  'services/ai',
];

const CORE_PLATFORM_FILES = [
  'services/platform/ports.ts',
  'services/platform/nullAdapter.ts',
  'services/platform/registry.ts',
];

const PLATFORM_DIR = 'services/platform';

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"]react['"]/,
  /from\s+['"]react-dom/,
  /from\s+['"]firebase/,
  /from\s+['"]@firebase/,
];

const FORBIDDEN_GLOBAL_PATTERNS = [
  /\bwindow\./,
  /\bdocument\./,
  /\bnavigator\.geolocation\b/,
  /\bnavigator\.permissions\b/,
  /\bnavigator\.vibrate\b/,
  /\bnavigator\.mediaDevices\b/,
  /\bnew\s+Notification\b/,
  /\bnew\s+AudioContext\b/,
  /\bnew\s+webkitAudioContext\b/,
];

function getTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getTsFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      results.push(fullPath);
    }
  }
  return results;
}

let violations = 0;

console.log('=== P1-08 Architectural Boundary Invariant Check ===\n');

// 1. Check Core imports and browser globals
const allCoreFiles = [
  ...CORE_DIRS.flatMap(dir => getTsFiles(dir)),
  ...CORE_PLATFORM_FILES,
];

console.log(`Checking ${allCoreFiles.length} Core files for forbidden imports and platform globals...`);

for (const file of allCoreFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // Strip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    // Check imports
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.test(line)) {
        console.error(`[VIOLATION] Forbidden import in ${file}:${index + 1}`);
        console.error(`  Line: ${line.trim()}`);
        violations++;
      }
    }

    // Check platform globals
    for (const pattern of FORBIDDEN_GLOBAL_PATTERNS) {
      if (pattern.test(line)) {
        // Exclude legitimate word matches like sliding message history "window[...]"
        if (line.includes('window[') && !line.includes('window.location') && !line.includes('window.')) {
          continue;
        }
        console.error(`[VIOLATION] Direct platform global access in Core ${file}:${index + 1}`);
        console.error(`  Line: ${line.trim()}`);
        violations++;
      }
    }
  });
}

// 2. Check Platform files & Sync files for ZERO ANY
const platformFiles = [...getTsFiles(PLATFORM_DIR), ...getTsFiles('services/sync')];
console.log(`\nChecking ${platformFiles.length} Platform and Sync files for ZERO 'any' invariant...`);

for (const file of platformFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    if (/:\s*any\b/.test(line) || /\bas\s+any\b/.test(line) || /<any>/.test(line)) {
      console.error(`[VIOLATION] 'any' type discovered in ${file}:${index + 1}`);
      console.error(`  Line: ${line.trim()}`);
      violations++;
    }
  });
}

console.log('\n----------------------------------------------------');
if (violations > 0) {
  console.error(`FAIL: ${violations} platform boundary violation(s) found.`);
  process.exit(1);
} else {
  console.log('PASS: All Core modules and Platform adapters satisfy architectural invariants.');
  process.exit(0);
}
