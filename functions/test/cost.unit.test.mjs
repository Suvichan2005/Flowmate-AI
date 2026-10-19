import assert from 'node:assert/strict';
import test from 'node:test';
import { actualTextGenerationCost, estimateTextGenerationCost, modelPrice, outputEnvelope } from '../lib/cost.js';
import { RequestFailure } from '../lib/policy.js';

test('conservative estimate includes the full counted context and output, with integer micro-USD', () => {
  const estimate = estimateTextGenerationCost('gemini-3.8-flash', 10_000, 2_000, new Date('2026-10-20T12:00:00Z'));
  assert.equal(estimate.estimatedMicroUsd, 18_750);
  assert.equal(estimate.pricingVersion, 'gemini-standard-2026-10');
});

test('a full-context request reserves a bounded maximum-output exposure with margin', () => {
  const estimate = estimateTextGenerationCost('gemini-3.8-flash', 1_000_000, 8_192, new Date('2026-10-20T12:00:00Z'));
  assert.equal(estimate.estimatedMicroUsd, 975_900);
  assert.equal(outputEnvelope('chat', 'guest', false), 8_192);
  assert.equal(outputEnvelope('chat', 'account', false), 16_384);
  assert.equal(outputEnvelope('chat', 'guest', true), 32_768);
  assert.equal(outputEnvelope('briefing', 'account', true), 8_192);
});

test('catalogue pricing automatically selects dated prices and the Pro large-prompt tier', () => {
  assert.equal(modelPrice('gemini-3.8-flash', 1, new Date('2027-01-01T00:00:00Z')).price.inputMicroUsdPerMillion, 1_500_000);
  assert.equal(modelPrice('gemini-4-argon', 1, new Date('2026-12-01T00:00:00Z')).price.outputMicroUsdPerMillion, 20_000_000);
  assert.equal(modelPrice('gemini-3.1-pro-preview', 200_000, new Date('2026-10-20T00:00:00Z')).price.inputMicroUsdPerMillion, 2_000_000);
  assert.equal(modelPrice('gemini-3.1-pro-preview', 200_001, new Date('2026-10-20T00:00:00Z')).price.inputMicroUsdPerMillion, 4_000_000);
});

test('provider-reported output, including thinking tokens, is costed and missing metadata stays unsettled', () => {
  const actual = actualTextGenerationCost('gemini-3.8-flash', {
    promptTokenCount: 10_000, candidatesTokenCount: 2_000, thoughtsTokenCount: 500, totalTokenCount: 12_500,
  }, new Date('2026-10-20T12:00:00Z'));
  assert.deepEqual(actual, { actualMicroUsd: 16_875, pricingVersion: 'gemini-standard-2026-10' });
  assert.deepEqual(actualTextGenerationCost('gemini-3.8-flash', {
    promptTokenCount: 10_000, candidatesTokenCount: 2_000, totalTokenCount: 12_500,
  }, new Date('2026-10-20T12:00:00Z')), actual, 'aggregate output supports providers that omit the separate thoughts counter');
  assert.equal(actualTextGenerationCost('gemini-3.8-flash', {
    promptTokenCount: 10_000, candidatesTokenCount: 2_000,
  }, new Date('2026-10-20T12:00:00Z')), null, 'missing thought and total counters retain the reservation');
  assert.equal(actualTextGenerationCost('gemini-3.8-flash', {
    promptTokenCount: 10_000, candidatesTokenCount: 2_000, thoughtsTokenCount: 500, totalTokenCount: 12_001,
  }, new Date('2026-10-20T12:00:00Z')), null, 'inconsistent provider totals cannot settle the reservation');
  assert.equal(actualTextGenerationCost('gemini-3.8-flash', { promptTokenCount: 10_000 }, new Date('2026-10-20T12:00:00Z')), null);
});

test('invalid pricing dates fail closed instead of allowing an unpriced request', () => {
  assert.throws(() => estimateTextGenerationCost('gemini-3.8-flash', 1_000, 1_000, new Date('2026-01-01T00:00:00Z')),
    error => error instanceof RequestFailure && error.code === 'PRICING_POLICY_UNAVAILABLE');
});
