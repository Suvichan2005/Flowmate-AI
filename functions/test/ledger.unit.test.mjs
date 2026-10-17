import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeUsageMetadata } from '../lib/ledger.js';

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
