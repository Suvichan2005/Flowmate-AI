import { RequestFailure, type ManagedModelId } from './policy.js';

export const MICRO_USD_PER_USD = 1_000_000;
export const TOKENS_PER_MILLION = 1_000_000;

export interface ModelPrice {
  inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
}

export interface CostEstimate {
  estimatedMicroUsd: number;
  pricingVersion: string;
  inputTokens: number;
  maximumOutputTokens: number;
}

const PRICING_START = '2026-10-20';
const FLASH_PRICE_CHANGE = '2027-01-01';
const ARGON_PRICE_CHANGE = '2026-12-01';

/**
 * Paid-tier standard Gemini Developer API prices. Amounts use integer micro-USD
 * per million tokens. Cached input is charged at the uncached rate for estimates,
 * so cache discounts can never make a reservation optimistic.
 */
export function modelPrice(model: ManagedModelId, inputTokens: number, at = new Date()): { price: ModelPrice; version: string } {
  const day = at.toISOString().slice(0, 10);
  if (day < PRICING_START) throw new RequestFailure('PRICING_POLICY_UNAVAILABLE', 503);

  if (model === 'gemini-3.8-flash' || model === 'gemini-3.6-flash') {
    const future = day >= FLASH_PRICE_CHANGE;
    return {
      price: future
        ? { inputMicroUsdPerMillion: 1_500_000, outputMicroUsdPerMillion: 7_500_000 }
        : { inputMicroUsdPerMillion: 750_000, outputMicroUsdPerMillion: 3_750_000 },
      version: future ? 'gemini-standard-2027-01' : 'gemini-standard-2026-10',
    };
  }
  if (model === 'gemini-3.5-flash-lite') {
    return { price: { inputMicroUsdPerMillion: 300_000, outputMicroUsdPerMillion: 2_500_000 }, version: 'gemini-standard-2026-10' };
  }
  if (model === 'gemini-3.1-pro-preview') {
    const large = inputTokens > 200_000;
    return {
      price: large
        ? { inputMicroUsdPerMillion: 4_000_000, outputMicroUsdPerMillion: 18_000_000 }
        : { inputMicroUsdPerMillion: 2_000_000, outputMicroUsdPerMillion: 12_000_000 },
      version: large ? 'gemini-standard-2026-10-pro-large' : 'gemini-standard-2026-10-pro',
    };
  }
  if (model === 'gemini-4-argon') {
    const future = day >= ARGON_PRICE_CHANGE;
    return {
      price: future
        ? { inputMicroUsdPerMillion: 4_000_000, outputMicroUsdPerMillion: 20_000_000 }
        : { inputMicroUsdPerMillion: 2_000_000, outputMicroUsdPerMillion: 10_000_000 },
      version: future ? 'gemini-standard-2026-12-argon' : 'gemini-standard-2026-10-argon',
    };
  }
  throw new RequestFailure('PRICING_POLICY_UNAVAILABLE', 503);
}

const tokenCost = (tokens: number, microUsdPerMillion: number): number =>
  Math.ceil((tokens * microUsdPerMillion) / TOKENS_PER_MILLION);

/** Conservative upper estimate with a 25% margin over current list pricing. */
export function estimateTextGenerationCost(
  model: ManagedModelId,
  inputTokens: number,
  maximumOutputTokens: number,
  at = new Date(),
): CostEstimate {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
      !Number.isSafeInteger(maximumOutputTokens) || maximumOutputTokens < 1) {
    throw new RequestFailure('PRICING_POLICY_UNAVAILABLE', 503);
  }
  const { price, version } = modelPrice(model, inputTokens, at);
  const listCost = tokenCost(inputTokens, price.inputMicroUsdPerMillion)
    + tokenCost(maximumOutputTokens, price.outputMicroUsdPerMillion);
  const estimatedMicroUsd = Math.ceil(listCost * 1.25);
  if (!Number.isSafeInteger(estimatedMicroUsd) || estimatedMicroUsd <= 0) {
    throw new RequestFailure('PRICING_POLICY_UNAVAILABLE', 503);
  }
  return { estimatedMicroUsd, pricingVersion: version, inputTokens, maximumOutputTokens };
}

/** Keep meaningful long-form responses while bounding worst-case provider output. */
export function outputEnvelope(purpose: 'chat' | 'briefing', allowance: 'guest' | 'account', privileged: boolean): number {
  // Briefings are a fixed, compact product surface rather than open-ended chat.
  if (purpose === 'briefing') return 8_192;
  if (privileged) return 32_768;
  return allowance === 'guest' ? 8_192 : 16_384;
}

/**
 * Usage settlement charges reported input and output (thinking is part of
 * output billing). Return null when provider accounting is incomplete; callers
 * must keep the original reservation in that case.
 */
export function actualTextGenerationCost(
  model: ManagedModelId,
  usage: Record<string, unknown> | null | undefined,
  at = new Date(),
): { actualMicroUsd: number; pricingVersion: string } | null {
  const rawInput = usage?.promptTokenCount;
  const rawCandidateOutput = usage?.candidatesTokenCount;
  const rawThoughts = usage?.thoughtsTokenCount;
  const rawTotal = usage?.totalTokenCount;
  const rawExtraToolInput = usage?.toolUsePromptTokenCount;
  if (typeof rawInput !== 'number' || typeof rawCandidateOutput !== 'number' ||
      (rawThoughts !== undefined && typeof rawThoughts !== 'number') ||
      (rawTotal !== undefined && typeof rawTotal !== 'number') ||
      (rawExtraToolInput !== undefined && typeof rawExtraToolInput !== 'number')) return null;
  const input = rawInput as number;
  const candidateOutput = rawCandidateOutput as number;
  const thoughts = rawThoughts === undefined ? null : rawThoughts as number;
  const total = rawTotal === undefined ? null : rawTotal as number;
  const extraToolInput = rawExtraToolInput === undefined ? 0 : rawExtraToolInput as number;
  if (![input, candidateOutput, extraToolInput].every(value => Number.isSafeInteger(value) && value >= 0) || input + extraToolInput <= 0 ||
      (thoughts !== null && (!Number.isSafeInteger(thoughts) || thoughts < 0)) ||
      (total !== null && (!Number.isSafeInteger(total) || total < 0))) return null;
  // maxOutputTokens is a combined candidate + thinking ceiling and Google bills
  // both at the output rate. Prefer the aggregate reported by totalTokenCount
  // when thoughtsTokenCount is omitted, but reject inconsistent accounting.
  const outputFromParts = thoughts === null ? null : candidateOutput + thoughts;
  const outputFromTotal = total === null ? null : total - input - extraToolInput;
  if (outputFromParts !== null && !Number.isSafeInteger(outputFromParts)) return null;
  if (outputFromTotal !== null && (!Number.isSafeInteger(outputFromTotal) || outputFromTotal < 0)) return null;
  if (outputFromParts !== null && outputFromTotal !== null && outputFromParts !== outputFromTotal) return null;
  const output = outputFromParts ?? outputFromTotal;
  if (output === null) return null;
  const totalInput = input + extraToolInput;
  if (!Number.isSafeInteger(totalInput)) return null;
  const { price, version } = modelPrice(model, totalInput, at);
  const actualMicroUsd = tokenCost(totalInput, price.inputMicroUsdPerMillion)
    + tokenCost(output, price.outputMicroUsdPerMillion);
  if (!Number.isSafeInteger(actualMicroUsd)) return null;
  return { actualMicroUsd, pricingVersion: version };
}
