import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('======================================================================');
console.log('Flowmate Release Candidate — Multi-Gate Invariant Verification');
console.log('======================================================================\n');

const results = [];

// Gate 1: Canonical State & Zero Legacy Mutations
console.log('[Gate 1/3] Checking Canonical State Invariants & Zero Any...');
const g1 = spawnSync('node', [path.join(__dirname, 'check_no_legacy_mutations.mjs')], {
  cwd: rootDir,
  stdio: 'inherit',
});
if (g1.status === 0) {
  results.push({ name: 'Canonical State & Zero-Any Invariants', status: 'PASS' });
} else {
  results.push({ name: 'Canonical State & Zero-Any Invariants', status: 'FAIL' });
}

// Gate 2: Platform Boundary Invariants
console.log('\n[Gate 2/3] Checking Architectural Platform Boundaries...');
const g2 = spawnSync('node', [path.join(__dirname, 'check_platform_boundary.mjs')], {
  cwd: rootDir,
  stdio: 'inherit',
});
if (g2.status === 0) {
  results.push({ name: 'Platform Boundary Invariants', status: 'PASS' });
} else {
  results.push({ name: 'Platform Boundary Invariants', status: 'FAIL' });
}

// Gate 3: Scholarly Citation & Research Integrity
console.log('\n[Gate 3/3] Checking Scholarly Citation & Research Integrity...');
const ciDir = path.join(rootDir, 'docs', 'competitive-intelligence');
const ciExists = fs.existsSync(ciDir);

const g3 = spawnSync('node', [path.join(__dirname, 'check_citation_integrity.mjs')], {
  cwd: rootDir,
  stdio: 'inherit',
});

if (g3.status === 0) {
  if (ciExists) {
    results.push({ name: 'Scholarly Citation Whitelist', status: 'PASS' });
  } else {
    results.push({ name: 'Scholarly Citation Whitelist', status: 'NOT APPLICABLE (Dossiers omitted)' });
  }
} else {
  results.push({ name: 'Scholarly Citation Whitelist', status: 'FAIL' });
}

// Summary Matrix
console.log('\n======================================================================');
console.log('Flowmate Invariant Gate Execution Summary:');
console.log('======================================================================');
let hasFailure = false;
for (const [idx, r] of results.entries()) {
  console.log(`  [${idx + 1}/3] ${r.name.padEnd(42)}: ${r.status}`);
  if (r.status === 'FAIL') hasFailure = true;
}
console.log('======================================================================');

if (hasFailure) {
  console.error('\nResult: FAILED — One or more mandatory architectural invariants failed.');
  process.exit(1);
} else {
  console.log('\nResult: ALL APPLICABLE PRODUCT GATES SATISFIED.');
  process.exit(0);
}
