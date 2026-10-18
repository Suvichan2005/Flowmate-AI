import assert from 'node:assert/strict';
import test from 'node:test';
import { isManagedAiEnabledForIdentity, sanitizeUsageMetadata } from '../lib/ledger.js';

test('test mode enables only explicitly listed identities, including against privileged bypass', () => {
  const control = { enabled: true, mode: 'test', allowedTestUids: ['synthetic-uid'] };
  assert.equal(isManagedAiEnabledForIdentity(control, 'synthetic-uid', false), true);
  assert.equal(isManagedAiEnabledForIdentity(control, 'other-uid', false), false);
  assert.equal(isManagedAiEnabledForIdentity(control, 'privileged-uid', true), false);
  assert.equal(isManagedAiEnabledForIdentity({ ...control, enabled: false }, 'synthetic-uid', false), false);
  assert.equal(isManagedAiEnabledForIdentity({ ...control, mode: 'general' }, 'other-uid', false), true);
});

test('usage metadata admits only bounded numeric token counters', () => {
  assert.deepEqual(sanitizeUsageMetadata({
    promptTokenCount: 120,
    candidatesTokenCount: 37,
    totalTokenCount: 157,
    thoughtsTokenCount: '8',
    prompt: 'private prompt text',
    response: 'private answer text',
    apiKey: 'never persist or log this',
    malformed: Number.POSITIVE_INFINITY,
    negative: -1,
  }), {
    promptTokenCount: 120,
    candidatesTokenCount: 37,
    totalTokenCount: 157,
    thoughtsTokenCount: 8,
  });
});
