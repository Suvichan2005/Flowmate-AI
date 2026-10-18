import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { scanDirectory, scanHistory, scanText } from '../scripts/release_artifact_scan.mjs';

const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'flowmate-release-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('Public release privacy gate', () => {
  it('detects the controlled sentinel even beyond a large prefix without exposing it', () => {
    const sentinel = ['SYNTHETIC','RELEASE','MARKER'].join('_');
    const result = scanText('x'.repeat(2*1024*1024) + sentinel, 'asset.js', [sentinel]);
    expect(result).toEqual([{ rule: 'controlled-sentinel', locator: 'asset.js' }]);
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });
  it('inspects nested and binary-tail bytes rather than truncating them', () => {
    const root = temp(); mkdirSync(join(root, 'nested'));
    const key = ['AIza', 'a'.repeat(35)].join('');
    writeFileSync(join(root, 'nested', 'file.bin'), Buffer.concat([Buffer.from([0,1,2]), Buffer.from(key)]));
    const result = scanDirectory(root);
    expect(result.passed).toBe(false);
    expect(result.findings[0].rule).toBe('google-api-key-requires-review');
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it('rejects credentialed URLs and machine home paths without printing them', () => {
    const text = ['https:', '//user', ':synthetic-password', '@example.invalid'].join('');
    const path = ['C:', 'Users', 'SyntheticUser', 'private.txt'].join('\\');
    expect(scanText(JSON.stringify({ error: { url: text, path } }), 'error.json').map(f => f.rule))
      .toEqual(['url-credentials','windows-home-path']);
  });
  it('does not infer key privilege from harmless Firebase identifiers or Google key shape', () => {
    expect(scanText('firebaseProjectId: "example", appId: "public-app"', 'config.json')).toEqual([]);
    expect(scanText(['import.meta.env.', 'VITE_GEMINI_API_KEY'].join(''), 'client.ts')[0].rule).toBe('model-build-injection');
  });
  it('allows only an explicitly reviewed Firebase browser key and still catches other key-shaped values', () => {
    const approved = ['AIza', 'a'.repeat(35)].join('');
    const unrelated = ['AIza', 'b'.repeat(35)].join('');
    expect(scanText(`apiKey: "${approved}"`, 'firebase-config.js', [], true, [approved])).toEqual([]);
    expect(scanText(`apiKey: "${approved}", other: "${unrelated}"`, 'bundle.js', [], true, [approved]))
      .toEqual([{ rule: 'google-api-key-requires-review', locator: 'bundle.js' }]);
  });
  it('fails closed on an empty artifact directory and unsafe filenames', () => {
    const root = temp();
    expect(scanDirectory(root).passed).toBe(false);
    writeFileSync(join(root, '.env.local'), 'not-a-secret');
    expect(scanDirectory(root).findings.some(f => f.rule === 'private-path')).toBe(true);
  });
  it('detects content removed from HEAD but still present in public-bound history', () => {
    const root=temp(), git=(...args: string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
    git('init','-q'); git('config','user.name','Synthetic test'); git('config','user.email','test@example.invalid');
    writeFileSync(join(root,'safe.txt'),'safe'); git('add','.'); git('commit','-qm','base');
    const base=git('rev-parse','HEAD').trim();
    writeFileSync(join(root,'artifact.txt'), ['AIza','b'.repeat(35)].join('')); git('add','.'); git('commit','-qm','leak');
    git('rm','-q','artifact.txt'); git('commit','-qm','remove');
    expect(scanHistory(root,base,'HEAD').passed).toBe(false);
    expect(scanHistory(root,base,'HEAD').findings.some(f=>f.rule==='google-api-key-requires-review')).toBe(true);
  }, 30000);
  it('checks removed injection code as historical design, not an exposed secret', () => {
    const root=temp(), git=(...args: string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
    git('init','-q'); git('config','user.name','Synthetic test'); git('config','user.email','test@example.invalid');
    writeFileSync(join(root,'safe.txt'),'safe'); git('add','.'); git('commit','-qm','base');
    const base=git('rev-parse','HEAD').trim();
    writeFileSync(join(root,'client.ts'), ['import.meta.env.', 'VITE_GEMINI_API_KEY'].join('')); git('add','.'); git('commit','-qm','injection');
    expect(scanHistory(root,base,'HEAD').passed).toBe(false);
    git('rm','-q','client.ts'); git('commit','-qm','remove injection');
    expect(scanHistory(root,base,'HEAD').passed).toBe(true);
  }, 30000);

  it('fails closed when CLI history arguments or values are incomplete', () => {
    const script = join(process.cwd(),'scripts','release_artifact_scan.mjs');
    for (const args of [['--directory',temp(),'--base','HEAD'],['--directory'],['--directory','--base']]) {
      const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout).passed).toBe(false);
    }
  }, 30000);
  it('withholds credential-shaped values in filenames as well as contents',()=>{
    const key=['AIza','c'.repeat(35)].join('');
    expect(JSON.stringify(scanText(key,key+'.js'))).not.toContain(key);
    expect(scanText(key,'firebase-config.json')[0].rule).toBe('google-api-key-requires-review');
    expect(JSON.stringify(scanText('controlled-marker','controlled-marker.js',['controlled-marker']))).not.toContain('controlled-marker');
  });

});
