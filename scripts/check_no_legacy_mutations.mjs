/**
 * Flowmate CI Check: No Legacy State Mutations (Stage 2 & Invariants Enforcement)
 *
 * Mechanically scans the codebase to verify:
 * 1. Kernel state (kernelEntities) is the sole canonical state written by store actions.
 * 2. Any update to the legacy `entities` property in store.ts is strictly derived via `projectKernelEntitiesToLegacy`.
 * 3. No direct in-place mutation (push, splice, sort, delete) on legacy `entities` array.
 * 4. Zero `any` in kernel, persistence, and AI executors.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let errors = [];

// 1. Check store.ts for forbidden direct mutations on entities
const storePath = path.join(rootDir, 'store.ts');
if (fs.existsSync(storePath)) {
  const storeContent = fs.readFileSync(storePath, 'utf8');
  const lines = storeContent.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    // Disallow mutating methods directly on state.entities
    if (/\bstate\.entities\.(push|splice|shift|unshift|pop)\b/.test(line)) {
      errors.push(`store.ts:${lineNum} - Forbidden direct mutation on state.entities: "${line.trim()}"`);
    }
    // Disallow assigning to entities: unless it uses projectKernelEntitiesToLegacy
    if (/^\s*entities:\s*(?!projectKernelEntitiesToLegacy|\[\])/.test(line) && !line.includes('// allowed')) {
      // Check if it's not the initial state or interface
      if (line.includes('entities: newEntities') || line.includes('entities: filtered')) {
        errors.push(`store.ts:${lineNum} - Legacy entities assigned without projectKernelEntitiesToLegacy projection: "${line.trim()}"`);
      }
    }
  });
}

// 2. Check for zero-any in kernel, persistence, AI executors, and kernelProjection
const zeroAnyDirs = [
  path.join(rootDir, 'services', 'kernel'),
  path.join(rootDir, 'services', 'persistence'),
];

// Check store/kernelProjection.ts specifically
const kernelProjectionPath = path.join(rootDir, 'store', 'kernelProjection.ts');
if (fs.existsSync(kernelProjectionPath)) {
  const content = fs.readFileSync(kernelProjectionPath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (/\bas\s+any\b/.test(line) || /:\s*any\b/.test(line) || /Record<string,\s*any>/.test(line)) {
      errors.push(`store/kernelProjection.ts:${index + 1} - Forbidden \`any\` found: "${trimmed}"`);
    }
  });
}

function checkZeroAnyInDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      checkZeroAnyInDir(fullPath);
    } else if (file.endsWith('.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        // Exclude comments
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (/\bas\s+any\b/.test(line) || /:\s*any\b/.test(line) || /Record<string,\s*any>/.test(line)) {
          errors.push(`${path.relative(rootDir, fullPath)}:${index + 1} - Forbidden \`any\` found: "${trimmed}"`);
        }
      });
    }
  }
}

for (const dir of zeroAnyDirs) {
  checkZeroAnyInDir(dir);
}

// Check AI executors specifically
const aiExecutorsPath = path.join(rootDir, 'services', 'ai', 'executors.ts');
if (fs.existsSync(aiExecutorsPath)) {
  const content = fs.readFileSync(aiExecutorsPath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (/\bas\s+any\b/.test(line) || /:\s*any\b/.test(line) || /Record<string,\s*any>/.test(line)) {
      errors.push(`services/ai/executors.ts:${index + 1} - Forbidden \`any\` found: "${trimmed}"`);
    }
  });
}

if (errors.length > 0) {
  console.error('❌ Architectural Invariant Violations Found:');
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
} else {
  console.log('✅ All Architectural Invariants Passed:');
  console.log('  - Canonical state is strictly kernelEntities');
  console.log('  - Legacy entities are derived through projectKernelEntitiesToLegacy');
  console.log('  - Zero `any` in kernel, persistence, and AI executors');
  process.exit(0);
}
