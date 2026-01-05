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
 * Circuit breaker state for preventing cascading failures
 */
export interface CircuitBreakerState {
    failures: number;
    lastFailure: number;
    isOpen: boolean;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    /** Number of failures before opening circuit */
    failureThreshold: number;
    /** Time in ms before attempting to close circuit */
    resetTimeoutMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeoutMs: 60000, // 1 minute
};

/**
 * Create a circuit breaker
 */
export function createCircuitBreaker(
    config: Partial<CircuitBreakerConfig> = {}
): {
    execute: <T>(fn: () => Promise<T>) => Promise<T>;
    getState: () => CircuitBreakerState;
    reset: () => void;
} {
    const fullConfig = { ...DEFAULT_CIRCUIT_BREAKER, ...config };
    
    const state: CircuitBreakerState = {
        failures: 0,
        lastFailure: 0,
        isOpen: false,
    };
    
    const reset = () => {
        state.failures = 0;
        state.lastFailure = 0;
        state.isOpen = false;
    };
    
    const execute = async <T>(fn: () => Promise<T>): Promise<T> => {
        // Check if circuit is open
        if (state.isOpen) {
            const timeSinceLastFailure = Date.now() - state.lastFailure;
            
            // Try to close circuit after timeout
            if (timeSinceLastFailure >= fullConfig.resetTimeoutMs) {
                state.isOpen = false;
                state.failures = 0;
            } else {
                throw new Error('Circuit breaker is open. Service temporarily unavailable.');
            }
        }
        
        try {
            const result = await fn();
            // Success - reset failure count
            state.failures = 0;
            return result;
        } catch (error) {
            // Record failure
            state.failures++;
            state.lastFailure = Date.now();
            
            // Open circuit if threshold exceeded
            if (state.failures >= fullConfig.failureThreshold) {
                state.isOpen = true;
            }
            
            throw error;
        }
    };
    
    return {
        execute,
        getState: () => ({ ...state }),
        reset,
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
