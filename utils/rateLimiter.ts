/**
 * Client-side rate limiter using sliding window counters.
 * Tracks API call timestamps per operation type and enforces per-user limits.
 */

export interface RateLimitConfig {
  max: number;        // Maximum calls allowed in the window
  windowMs: number;   // Window duration in milliseconds
}

// Per-operation rate limits
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  chat:        { max: 60, windowMs: 3_600_000 },     // 60/hour
  briefing:    { max: 3,  windowMs: 86_400_000 },    // 3/day
  agent:       { max: 10, windowMs: 3_600_000 },     // 10/hour
  textImprove: { max: 20, windowMs: 3_600_000 },     // 20/hour
  knowledge:   { max: 20, windowMs: 3_600_000 },     // 20/hour
  graphFix:    { max: 10, windowMs: 3_600_000 },     // 10/hour
};

// Module-level storage: operation → timestamps of recent calls
const callTimestamps: Map<string, number[]> = new Map();

/**
 * Check if a call is allowed under the rate limit for the given operation.
 * Returns { allowed, remaining, resetMs }.
 */
export function checkRateLimit(operation: string): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
} {
  const config = RATE_LIMITS[operation];
  if (!config) {
    // Unknown operation — allow by default
    return { allowed: true, remaining: Infinity, resetMs: 0 };
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Get and prune timestamps
  let timestamps = callTimestamps.get(operation) || [];
  timestamps = timestamps.filter(t => t > windowStart);
  callTimestamps.set(operation, timestamps);

  const count = timestamps.length;
  const remaining = Math.max(0, config.max - count);
  const resetMs = timestamps.length > 0
    ? timestamps[0] + config.windowMs - now
    : 0;

  return {
    allowed: count < config.max,
    remaining,
    resetMs,
  };
}

/**
 * Record a call for rate limiting. Call this AFTER successfully making the API call.
 */
export function recordCall(operation: string): void {
  const timestamps = callTimestamps.get(operation) || [];
  timestamps.push(Date.now());
  callTimestamps.set(operation, timestamps);
}

/**
 * Combined check + record. Returns true if allowed (and records the call).
 * Returns false if rate limited (does not record).
 */
export function tryCall(operation: string): boolean {
  const { allowed } = checkRateLimit(operation);
  if (allowed) {
    recordCall(operation);
    return true;
  }
  return false;
}

/**
 * Get current usage stats for all operations. Useful for debug console.
 */
export function getRateLimitStats(): Record<string, { used: number; max: number; remaining: number }> {
  const stats: Record<string, { used: number; max: number; remaining: number }> = {};
  for (const [op, config] of Object.entries(RATE_LIMITS)) {
    const { remaining } = checkRateLimit(op);
    const used = config.max - remaining;
    stats[op] = { used, max: config.max, remaining };
  }
  return stats;
}

/**
 * Reset rate limit counters for a specific operation or all operations.
 */
export function resetRateLimit(operation?: string): void {
  if (operation) {
    callTimestamps.delete(operation);
  } else {
    callTimestamps.clear();
  }
}
