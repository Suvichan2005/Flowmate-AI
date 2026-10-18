import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'dist');
const manifestPath = path.join(outputDir, 'release-manifest.json');

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/i.test(sourceSha)) throw new Error('Could not resolve a full Git source SHA');

function collectFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Build output contains a symbolic link: ${relativePath}`);
    if (entry.isDirectory()) return collectFiles(absolutePath, relativePath);
    if (!entry.isFile() || relativePath === 'release-manifest.json') return [];
    const bytes = readFileSync(absolutePath);
    return [{ path: relativePath.replaceAll(path.sep, '/'), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }];
  });
}

const files = collectFiles(outputDir).sort((a, b) => a.path.localeCompare(b.path));
if (!files.some(file => file.path === 'index.html')) throw new Error('Build output is missing index.html');

writeFileSync(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  sourceSha,
  builtAt: new Date().toISOString(),
  files,
}, null, 2)}\n`, 'utf8');
