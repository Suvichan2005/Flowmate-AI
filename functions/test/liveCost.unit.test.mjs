import test from 'node:test';
import assert from 'node:assert/strict';
import { audioInputByteLength, usageCost } from '../lib/liveRelayServer.js';
import {
  LIVE_CONTEXT_COMPRESSION_TARGET_TOKENS,
  LIVE_CONTEXT_COMPRESSION_TRIGGER_TOKENS,
  LIVE_PRICE_VERSION,
  LIVE_SESSION_MAX_AUDIO_INPUT_BYTES,
  LIVE_SESSION_MAX_DURATION_MS,
  LIVE_SESSION_MAX_GENERATIONS,
  LIVE_SESSION_MAX_OUTPUT_TOKENS,
  LIVE_SESSION_MAX_TEXT_CONTROL_BYTES,
  LIVE_SESSION_RESERVATION_MICRO_USD,
  LIVE_SESSION_STOP_AT_MICRO_USD,
  assertLiveSessionEnvelopeIsSafe,
  maximumLiveSessionExposureMicroUsd,
} from '../lib/liveCost.js';

test('relayed Live envelope has finite transport, context, and output ceilings', () => {
  assert.equal(LIVE_SESSION_MAX_DURATION_MS, 5 * 60_000);
  assert.equal(LIVE_SESSION_MAX_AUDIO_INPUT_BYTES, 1_920_000);
  assert.equal(LIVE_SESSION_MAX_TEXT_CONTROL_BYTES, 10_000);
  assert.equal(LIVE_SESSION_MAX_GENERATIONS, 4);
  assert.equal(LIVE_SESSION_MAX_OUTPUT_TOKENS, 2_048);
  assert.equal(LIVE_CONTEXT_COMPRESSION_TRIGGER_TOKENS, 4_096);
  assert.equal(LIVE_CONTEXT_COMPRESSION_TARGET_TOKENS, 2_048);
  assert.equal(LIVE_PRICE_VERSION, 'gemini-live-standard-2026-10');
});

test('worst-case Live token and transcription exposure remains below the reserved cap with margin', () => {
  const estimate = maximumLiveSessionExposureMicroUsd();
  assert.ok(estimate > 0);
  assert.ok(estimate <= LIVE_SESSION_STOP_AT_MICRO_USD);
  assert.ok(LIVE_SESSION_STOP_AT_MICRO_USD <= LIVE_SESSION_RESERVATION_MICRO_USD);
  assert.doesNotThrow(assertLiveSessionEnvelopeIsSafe);
});

test('Live metering requires consistent authoritative modality totals and charges transcription separately', () => {
  const measured = usageCost({ usageMetadata: {
    promptTokenCount: 100,
    responseTokenCount: 50,
    thoughtsTokenCount: 5,
    toolUsePromptTokenCount: 0,
    totalTokenCount: 155,
    promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 100 }],
    responseTokensDetails: [
      { modality: 'AUDIO', tokenCount: 48 },
      { modality: 'TEXT', tokenCount: 2 },
    ],
    toolUsePromptTokensDetails: [],
  } });
  assert.deepEqual(measured, { microUsd: 945, inputTokens: 100, outputTokens: 55 });
  assert.equal(usageCost({ usageMetadata: { promptTokenCount: 100 } }), null);
  assert.equal(usageCost({ usageMetadata: {
    promptTokenCount: 0, responseTokenCount: 0, thoughtsTokenCount: 0, toolUsePromptTokenCount: 0,
    totalTokenCount: 0, promptTokensDetails: [], responseTokensDetails: [], toolUsePromptTokensDetails: [],
  } }), null);
  assert.equal(usageCost({ usageMetadata: {
    promptTokenCount: 1, responseTokenCount: 1, thoughtsTokenCount: 0, toolUsePromptTokenCount: 0,
    totalTokenCount: 99,
    promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 1 }],
    responseTokensDetails: [{ modality: 'TEXT', tokenCount: 1 }],
    toolUsePromptTokensDetails: [],
  } }), null);
});

test('Live audio frames reject malformed base64 and data beyond the frame byte limit', () => {
  assert.equal(audioInputByteLength(Buffer.alloc(8_192).toString('base64')), 8_192);
  assert.equal(audioInputByteLength('###not-base64###'), null);
  assert.equal(audioInputByteLength(Buffer.alloc(8_193).toString('base64')), null);
});
