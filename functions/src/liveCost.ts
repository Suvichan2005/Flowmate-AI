import { RequestFailure } from './policy.js';

/**
 * Financial envelope for server-relayed Gemini Live sessions.
 *
 * These bounds are only valid when the relay enforces every limit below and
 * pins the provider configuration (context compression and maxOutputTokens).
 * Direct browser-to-Gemini sessions cannot enforce the input-byte or output
 * bounds and must not use this estimate as authorization to issue a token.
 */
export const LIVE_SESSION_RESERVATION_MICRO_USD = 500_000;
export const LIVE_SESSION_STOP_AT_MICRO_USD = 400_000;
export const LIVE_SESSION_MAX_DURATION_MS = 5 * 60_000;
export const LIVE_SESSION_MAX_AUDIO_INPUT_BYTES = 1_920_000; // 60s, 16kHz, mono, 16-bit PCM
export const LIVE_SESSION_MAX_TEXT_CONTROL_BYTES = 10_000;
export const LIVE_SESSION_MAX_GENERATIONS = 4;
export const LIVE_SESSION_MAX_OUTPUT_TOKENS_PER_GENERATION = 512;
export const LIVE_SESSION_MAX_OUTPUT_TOKENS =
  LIVE_SESSION_MAX_GENERATIONS * LIVE_SESSION_MAX_OUTPUT_TOKENS_PER_GENERATION;
export const LIVE_CONTEXT_COMPRESSION_TRIGGER_TOKENS = 4_096;
export const LIVE_CONTEXT_COMPRESSION_TARGET_TOKENS = 2_048;
export const LIVE_PRICE_VERSION = 'gemini-live-standard-2026-10';

// Official Standard rates for Gemini 3.8 Live: input audio $3/M tokens,
// output audio $12/M, text transcription output $4.50/M. The estimate treats
// the entire context at the more expensive audio input rate and adds a 50%
// margin. Text, tool, and transcription bounds are deliberately conservative.
const INPUT_AUDIO_MICRO_USD_PER_MILLION = 3_000_000;
const OUTPUT_AUDIO_MICRO_USD_PER_MILLION = 12_000_000;
const TRANSCRIPT_MICRO_USD_PER_MILLION = 4_500_000;
const TOKENS_PER_MILLION = 1_000_000;
const LIVE_SESSION_MAX_CONTROL_TOKENS = LIVE_SESSION_MAX_TEXT_CONTROL_BYTES;
const LIVE_SESSION_MAX_AUDIO_TOKENS = 1_500; // 25 tokens/sec × 60 sec
const LIVE_SESSION_MAX_TRANSCRIPT_TOKENS = 8_000;
const LIVE_SESSION_SAFETY_MARGIN_BPS = 15_000; // 1.5x

const tokenCost = (tokens: number, rate: number): number =>
  Math.ceil(tokens * rate / TOKENS_PER_MILLION);

/**
 * Worst-case upper bound for one session under the enforced relay limits.
 * System instructions and tool declarations stay in context; prior turns are
 * bounded by the compression trigger; streamed user audio is bounded by bytes.
 */
export function maximumLiveSessionExposureMicroUsd(): number {
  const promptTokensPerGeneration = LIVE_CONTEXT_COMPRESSION_TRIGGER_TOKENS
    + LIVE_SESSION_MAX_CONTROL_TOKENS
    + LIVE_SESSION_MAX_AUDIO_TOKENS;
  const promptTokens = promptTokensPerGeneration * LIVE_SESSION_MAX_GENERATIONS;
  const outputTokens = LIVE_SESSION_MAX_OUTPUT_TOKENS;
  const transcripts = LIVE_SESSION_MAX_TRANSCRIPT_TOKENS;
  const raw = tokenCost(promptTokens, INPUT_AUDIO_MICRO_USD_PER_MILLION)
    + tokenCost(outputTokens, OUTPUT_AUDIO_MICRO_USD_PER_MILLION)
    + tokenCost(transcripts, TRANSCRIPT_MICRO_USD_PER_MILLION);
  return Math.ceil(raw * LIVE_SESSION_SAFETY_MARGIN_BPS / 10_000);
}

export function assertLiveSessionEnvelopeIsSafe(): void {
  const ceiling = maximumLiveSessionExposureMicroUsd();
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0 || ceiling > LIVE_SESSION_STOP_AT_MICRO_USD
    || LIVE_SESSION_STOP_AT_MICRO_USD > LIVE_SESSION_RESERVATION_MICRO_USD) {
    throw new RequestFailure('LIVE_COST_ENVELOPE_UNSAFE', 503);
  }
}
