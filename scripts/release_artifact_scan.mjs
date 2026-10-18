import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const credentialRules = [
  ['google-api-key-requires-review', /AIza[0-9A-Za-z_-]{35}/],
  ['openai-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['url-credentials', /https?:\/\/[^\s/"'<>:@]+:[^\s/"'<>@]+@/],
  ['windows-home-path', /[A-Za-z]:(?:\\+|\/)Users(?:\\+|\/)[^\s"'<>]+/],
  ['model-build-injection', /import\.meta\.env\.VITE_(?:GEMINI|OPENAI|ANTHROPIC)_API_KEY/],
];
const forbiddenPath = /(?:^|\/)(?:\.env(?:\.(?!example$)[^/]+)?|\.codex|\.gemini|agent-journal|competitive-intelligence|FLOWMATE_KNOWLEDGE_BASE)(?:\/|$)/i;

function safeLocator(locator, sentinels = []) {
  let safe = locator;
  for (const [, pattern] of credentialRules) safe = safe.replace(new RegExp(pattern.source, 'g'), '[withheld]');
  for (const sentinel of sentinels) if (sentinel) safe = safe.split(sentinel).join('[withheld]');
  return safe;
}
const safeFindings = (findings, sentinels = []) => findings.map(f => ({ ...f, locator: safeLocator(f.locator, sentinels) }));

/** Content matches are never echoed. Suspicious locator values are redacted too. */
export function scanText(text, locator, sentinels = [], checkClientInjection = true, approvedFirebasePublicKeys = []) {
  const findings = [];
  for (const [rule, pattern] of credentialRules) {
    if (rule === 'model-build-injection' && !checkClientInjection) continue;
    const matched = rule === 'google-api-key-requires-review'
      ? [...text.matchAll(new RegExp(pattern.source, 'g'))].some(([value]) => !approvedFirebasePublicKeys.includes(value))
      : pattern.test(text);
    if (matched) findings.push({ rule, locator });
  }
  for (const sentinel of sentinels) {
    if (sentinel && text.includes(sentinel)) findings.push({ rule: 'controlled-sentinel', locator });
  }
  return safeFindings(findings, sentinels);
}

export function scanDirectory(directory, sentinels = [], approvedFirebasePublicKeys = []) {
  const root = resolve(directory);
  const findings = [];
  let files = 0, bytes = 0;
  function visit(path) {
    for (const item of readdirSync(path).sort()) {
      const full = join(path, item), entry = lstatSync(full);
      const locator = relative(root, full).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) { findings.push({ rule: 'uninspected-symlink', locator }); continue; }
      if (entry.isDirectory()) { visit(full); continue; }
      if (!entry.isFile()) { findings.push({ rule: 'uninspected-file-type', locator }); continue; }
      files++;
      const content = readFileSync(full); bytes += content.length;
      // Inspect complete bytes, including binary prefixes/tails, before any reporting or truncation.
      findings.push(...scanText(content.toString('utf8'), locator, sentinels, true, approvedFirebasePublicKeys));
      if (forbiddenPath.test(locator)) findings.push({ rule: 'private-path', locator });
    }
  }
  visit(root);
  if (!files) findings.push({ rule: 'empty-artifact-directory', locator: '.' });
  return { files, bytes, findings: safeFindings(findings, sentinels), passed: findings.length === 0 };
}

export function scanHistory(cwd, baseRef, candidateRef, sentinels = [], approvedFirebasePublicKeys = []) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const base = git('rev-parse', '--verify', baseRef + '^{commit}').trim();
  const candidate = git('rev-parse', '--verify', candidateRef + '^{commit}').trim();
  const ancestry = spawnSync('git', ['merge-base','--is-ancestor',base,candidate], { cwd });
  if (ancestry.status !== 0) return { base, candidate, passed: false, findings: [{ rule: 'baseline-not-ancestor', locator: candidate }] };
  const commits = git('rev-list', base + '..' + candidate).trim().split('\n').filter(Boolean);
  const seen = new Set(), findings = [];
  // Scan each new commit tree, not only the final diff; deleted historical leaks still fail.
  for (const commit of commits.length ? commits : [candidate]) {
    for (const entry of git('ls-tree','-r','-z',commit).split('\0').filter(Boolean)) {
      const [header, path] = entry.split('\t');
      const [mode, type, oid] = header.split(' ');
      const locator = commit + ':' + path;
      if (forbiddenPath.test(path)) findings.push({ rule: 'private-path', locator });
      if (mode === '120000' || type !== 'blob') { findings.push({ rule: 'uninspected-git-entry', locator }); continue; }
      if (!seen.has(oid)) {
        seen.add(oid);
        findings.push(...scanText(git('cat-file','blob',oid), locator, sentinels, commit === candidate, approvedFirebasePublicKeys));
      }
    }
  }
  return { base, candidate, commits: commits.length, blobs: seen.size, findings: safeFindings(findings, sentinels), passed: findings.length === 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), allowed = new Set(['--directory','--base','--candidate','--sentinel-env','--firebase-key-env']);
    const supplied = new Set();
    for (let i=0; i<args.length; i+=2) {
      if (!allowed.has(args[i]) || supplied.has(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Invalid arguments');
      supplied.add(args[i]);
    }
    if (supplied.has('--base') !== supplied.has('--candidate')) throw new Error('Both Git references are required');
    const value = flag => args[args.indexOf(flag) + 1];
    const sentinelName = args.includes('--sentinel-env') ? value('--sentinel-env') : null;
    if (sentinelName && !process.env[sentinelName]) throw new Error('Requested sentinel environment variable is missing');
    const sentinels = sentinelName ? [process.env[sentinelName]] : [];
    const firebaseKeyName = args.includes('--firebase-key-env') ? value('--firebase-key-env') : null;
    if (firebaseKeyName && !/^AIza[0-9A-Za-z_-]{35}$/.test(process.env[firebaseKeyName] || '')) throw new Error('Requested Firebase public key is missing or malformed');
    const approvedFirebasePublicKeys = firebaseKeyName ? [process.env[firebaseKeyName]] : [];
    const result = { schemaVersion: 1 };
    if (args.includes('--directory')) result.artifacts = scanDirectory(value('--directory'), sentinels, approvedFirebasePublicKeys);
    if (args.includes('--base') && args.includes('--candidate')) result.history = scanHistory(process.cwd(), value('--base'), value('--candidate'), sentinels, approvedFirebasePublicKeys);
    if (!result.artifacts && !result.history) throw new Error('Specify --directory and/or both --base and --candidate');
    result.passed = (!result.artifacts || result.artifacts.passed) && (!result.history || result.history.passed);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch {
    // Fail closed without exposing subprocess stdout/stderr or environment values.
    console.log(JSON.stringify({ schemaVersion: 1, passed: false, error: 'Scan could not complete; inspect local inputs and Git references' }));
    process.exitCode = 2;
  }
}
