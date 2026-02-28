/**
 * API Retry Utilities
 * 
 * Provides exponential backoff and retry logic for API calls
 */

export interface RetryConfig {
    /** Maximum number of retry attempts */
    maxRetries: number;
    /** Initial delay in milliseconds */
    initialDelayMs: number;
    /** Maximum delay between retries in milliseconds */
    maxDelayMs: number;
    /** Multiplier for exponential backoff */
    backoffMultiplier: number;
    /** Add random jitter to delays */
    jitter: boolean;
    /** HTTP status codes that should trigger a retry */
    retryableStatusCodes: number[];
    /** Error types/names that should trigger a retry */
    retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'NetworkError', 'AbortError'],
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateDelay(
    attempt: number,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
    // Exponential backoff: delay = initial * (multiplier ^ attempt)
    let delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
    
    // Cap at maximum delay
    delay = Math.min(delay, config.maxDelayMs);
    
    // Add jitter (±25% randomness)
    if (config.jitter) {
        const jitterRange = delay * 0.25;
        delay = delay + (Math.random() * jitterRange * 2 - jitterRange);
    }
    
    return Math.round(delay);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(
    error: any,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean {
    // Check HTTP status codes
    const status = error?.status || error?.response?.status;
    if (status && config.retryableStatusCodes.includes(status)) {
        return true;
    }
    
    // Check error names/codes
    const errorName = error?.name || error?.code || '';
    if (config.retryableErrors.some(e => errorName.includes(e))) {
        return true;
    }
    
    // Check for rate limiting
    if (error?.message?.toLowerCase().includes('rate limit')) {
        return true;
    }
    
    // Check for network errors
    if (error?.message?.toLowerCase().includes('network')) {
        return true;
    }
    
    // Check for timeout
    if (error?.message?.toLowerCase().includes('timeout')) {
        return true;
    }
    
    return false;
}

/**
 * Retry callback for logging/monitoring
 */
export type RetryCallback = (attempt: number, error: any, delay: number) => void;

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    onRetry?: RetryCallback
): Promise<T> {
    const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: any;
    
    for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            
            // Don't retry if we've exhausted attempts
            if (attempt >= fullConfig.maxRetries) {
                break;
            }
            
            // Don't retry non-retryable errors
            if (!isRetryableError(error, fullConfig)) {
                throw error;
            }
            
            // Calculate delay for next attempt
            const delay = calculateDelay(attempt, fullConfig);
            
            // Notify via callback
            if (onRetry) {
                onRetry(attempt + 1, error, delay);
            }
            
            // Wait before retrying
            await sleep(delay);
        }
    }
    
    // All retries exhausted
    throw lastError;
}

/**
 * Create a retry wrapper for fetch-like functions
 */
export function createRetryFetch(
    config: Partial<RetryConfig> = {},
    onRetry?: RetryCallback
): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        return withRetry(
            async () => {
                const response = await fetch(input, init);
                
                // Treat certain status codes as errors for retry
                if (!response.ok && (config.retryableStatusCodes || DEFAULT_RETRY_CONFIG.retryableStatusCodes)
                    .includes(response.status)) {
                    const error: any = new Error(`HTTP ${response.status}`);
                    error.status = response.status;
                    error.response = response;
                    throw error;
                }
                
                return response;
            },
            config,
            onRetry
        );
    };
}

/**
 * Circuit breaker state machine:
 *   CLOSED → (failures >= threshold in window) → OPEN
 *   OPEN → (wait resetTimeoutMs) → HALF_OPEN
 *   HALF_OPEN → (1 success) → CLOSED
 *   HALF_OPEN → (1 failure) → OPEN
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerState {
    state: CircuitState;
    failures: number;
    lastFailure: number;
    /** @deprecated Use `state === 'OPEN'` instead */
    isOpen: boolean;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    /** Number of failures before opening circuit */
    failureThreshold: number;
    /** Time in ms before transitioning OPEN → HALF_OPEN */
    resetTimeoutMs: number;
    /** Time window in ms for counting failures (default: 5 minutes) */
    failureWindowMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,    // 30 seconds
    failureWindowMs: 300_000,  // 5 minutes
};

/**
 * Create a circuit breaker with CLOSED → OPEN → HALF_OPEN state machine
 */
export function createCircuitBreaker(
    config: Partial<CircuitBreakerConfig> = {}
): {
    execute: <T>(fn: () => Promise<T>) => Promise<T>;
    getState: () => CircuitBreakerState;
    reset: () => void;
    isAvailable: () => boolean;
} {
    const fullConfig = { ...DEFAULT_CIRCUIT_BREAKER, ...config };
    
    let circuitState: CircuitState = 'CLOSED';
    const failureTimestamps: number[] = [];
    let lastFailure = 0;
    
    const reset = () => {
        circuitState = 'CLOSED';
        failureTimestamps.length = 0;
        lastFailure = 0;
    };

    const getState = (): CircuitBreakerState => ({
        state: circuitState,
        failures: failureTimestamps.length,
        lastFailure,
        isOpen: circuitState === 'OPEN',
    });

    /** Check if the breaker will accept a call right now */
    const isAvailable = (): boolean => {
        if (circuitState === 'CLOSED') return true;
        if (circuitState === 'OPEN') {
            // Check if enough time has passed to transition to HALF_OPEN
            if (Date.now() - lastFailure >= fullConfig.resetTimeoutMs) {
                return true; // Will become HALF_OPEN on next execute
            }
            return false;
        }
        // HALF_OPEN: allow exactly one probe call
        return true;
    };
    
    const execute = async <T>(fn: () => Promise<T>): Promise<T> => {
        if (circuitState === 'OPEN') {
            const timeSinceLastFailure = Date.now() - lastFailure;
            if (timeSinceLastFailure >= fullConfig.resetTimeoutMs) {
                // Transition OPEN → HALF_OPEN: allow one probe call
                circuitState = 'HALF_OPEN';
            } else {
                throw new Error('Circuit breaker is open. Service temporarily unavailable.');
            }
        }
        
        try {
            const result = await fn();

            if (circuitState === 'HALF_OPEN') {
                // Probe succeeded → HALF_OPEN → CLOSED
                reset();
            } else {
                // CLOSED: clear stale failures outside window
                const windowStart = Date.now() - fullConfig.failureWindowMs;
                while (failureTimestamps.length > 0 && failureTimestamps[0] < windowStart) {
                    failureTimestamps.shift();
                }
            }

            return result;
        } catch (error) {
            const now = Date.now();
            lastFailure = now;

            if (circuitState === 'HALF_OPEN') {
                // Probe failed → HALF_OPEN → OPEN
                circuitState = 'OPEN';
            } else {
                // CLOSED: record failure, check threshold
                failureTimestamps.push(now);

                // Prune old failures outside window
                const windowStart = now - fullConfig.failureWindowMs;
                while (failureTimestamps.length > 0 && failureTimestamps[0] < windowStart) {
                    failureTimestamps.shift();
                }

                if (failureTimestamps.length >= fullConfig.failureThreshold) {
                    circuitState = 'OPEN';
                }
            }
            
            throw error;
        }
    };
    
    return {
        execute,
        getState,
        reset,
        isAvailable,
    };
}

/**
 * Helper to create a resilient API client
 */
export function createResilientClient<T extends Record<string, (...args: any[]) => Promise<any>>>(
    client: T,
    retryConfig: Partial<RetryConfig> = {},
    onRetry?: RetryCallback
): T {
    const wrapped = {} as T;
    
    for (const key of Object.keys(client) as (keyof T)[]) {
        const method = client[key];
        if (typeof method === 'function') {
            (wrapped as any)[key] = (...args: any[]) => 
                withRetry(() => method.apply(client, args), retryConfig, onRetry);
        } else {
            (wrapped as any)[key] = method;
        }
    }
    
    return wrapped;
}
