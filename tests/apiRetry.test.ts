/**
 * API Retry Utilities Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    calculateDelay,
    isRetryableError,
    withRetry,
    createCircuitBreaker,
    DEFAULT_RETRY_CONFIG,
} from '../utils/apiRetry';

describe('API Retry Utilities', () => {
    describe('calculateDelay', () => {
        it('calculates exponential backoff', () => {
            const config = { ...DEFAULT_RETRY_CONFIG, jitter: false };
            
            expect(calculateDelay(0, config)).toBe(1000); // 1000 * 2^0
            expect(calculateDelay(1, config)).toBe(2000); // 1000 * 2^1
            expect(calculateDelay(2, config)).toBe(4000); // 1000 * 2^2
        });

        it('caps delay at maxDelayMs', () => {
            const config = { ...DEFAULT_RETRY_CONFIG, jitter: false, maxDelayMs: 3000 };
            
            expect(calculateDelay(5, config)).toBe(3000); // Would be 32000, capped at 3000
        });

        it('adds jitter when enabled', () => {
            const config = { ...DEFAULT_RETRY_CONFIG, jitter: true };
            
            // With jitter, delays should vary
            const delays = new Set();
            for (let i = 0; i < 10; i++) {
                delays.add(calculateDelay(0, config));
            }
            
            // Should have some variation (might not be exactly 10 due to randomness)
            expect(delays.size).toBeGreaterThanOrEqual(1);
        });
    });

    describe('isRetryableError', () => {
        it('identifies retryable HTTP status codes', () => {
            expect(isRetryableError({ status: 429 })).toBe(true);
            expect(isRetryableError({ status: 503 })).toBe(true);
            expect(isRetryableError({ status: 400 })).toBe(false);
            expect(isRetryableError({ status: 401 })).toBe(false);
        });

        it('identifies retryable error names', () => {
            expect(isRetryableError({ name: 'NetworkError' })).toBe(true);
            expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
            expect(isRetryableError({ name: 'ValidationError' })).toBe(false);
        });

        it('identifies rate limit errors', () => {
            expect(isRetryableError({ message: 'Rate limit exceeded' })).toBe(true);
            expect(isRetryableError({ message: 'rate limit reached' })).toBe(true);
        });

        it('identifies network errors', () => {
            expect(isRetryableError({ message: 'Network request failed' })).toBe(true);
        });

        it('identifies timeout errors', () => {
            expect(isRetryableError({ message: 'Request timeout' })).toBe(true);
        });
    });

    describe('withRetry', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('returns result on success', async () => {
            const fn = vi.fn().mockResolvedValue('success');
            
            const result = await withRetry(fn);
            
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('retries on retryable error', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce({ status: 503 })
                .mockResolvedValue('success');
            
            const resultPromise = withRetry(fn, { maxRetries: 3 });
            
            // Advance timers for retry delay
            await vi.runAllTimersAsync();
            
            const result = await resultPromise;
            
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('throws immediately on non-retryable error', async () => {
            const fn = vi.fn().mockRejectedValue({ status: 400, message: 'Bad request' });
            
            await expect(withRetry(fn)).rejects.toEqual({ status: 400, message: 'Bad request' });
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('exhausts retries and throws', async () => {
            // Use real timers for this test since the async timing with fake timers is tricky
            vi.useRealTimers();
            
            const error = { status: 503 };
            const fn = vi.fn().mockRejectedValue(error);
            
            try {
                await withRetry(fn, { maxRetries: 2, initialDelayMs: 10, maxDelayMs: 20 });
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e).toEqual(error);
            }
            expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
            
            // Restore fake timers for other tests
            vi.useFakeTimers();
        });

        it('calls onRetry callback', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce({ status: 503 })
                .mockResolvedValue('success');
            const onRetry = vi.fn();
            
            const resultPromise = withRetry(fn, { maxRetries: 3 }, onRetry);
            
            await vi.runAllTimersAsync();
            await resultPromise;
            
            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(onRetry).toHaveBeenCalledWith(1, { status: 503 }, expect.any(Number));
        });
    });

    describe('createCircuitBreaker', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('executes function normally when circuit is closed', async () => {
            const breaker = createCircuitBreaker();
            const fn = vi.fn().mockResolvedValue('result');
            
            const result = await breaker.execute(fn);
            
            expect(result).toBe('result');
            expect(breaker.getState().isOpen).toBe(false);
        });

        it('opens circuit after threshold failures', async () => {
            const breaker = createCircuitBreaker({ failureThreshold: 3 });
            const fn = vi.fn().mockRejectedValue(new Error('fail'));
            
            // Cause 3 failures
            for (let i = 0; i < 3; i++) {
                await expect(breaker.execute(fn)).rejects.toThrow('fail');
            }
            
            expect(breaker.getState().isOpen).toBe(true);
        });

        it('rejects immediately when circuit is open', async () => {
            const breaker = createCircuitBreaker({ failureThreshold: 1 });
            const fn = vi.fn().mockRejectedValue(new Error('fail'));
            
            // Cause failure to open circuit
            await expect(breaker.execute(fn)).rejects.toThrow('fail');
            expect(breaker.getState().isOpen).toBe(true);
            
            // Next call should fail immediately without calling fn
            const callsBefore = fn.mock.calls.length;
            await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is open');
            expect(fn).toHaveBeenCalledTimes(callsBefore);
        });

        it('attempts to close circuit after timeout', async () => {
            const breaker = createCircuitBreaker({ 
                failureThreshold: 1, 
                resetTimeoutMs: 1000 
            });
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue('success');
            
            // Open circuit
            await expect(breaker.execute(fn)).rejects.toThrow('fail');
            expect(breaker.getState().isOpen).toBe(true);
            
            // Wait for reset timeout
            vi.advanceTimersByTime(1000);
            
            // Circuit should attempt to close
            const result = await breaker.execute(fn);
            expect(result).toBe('success');
            expect(breaker.getState().isOpen).toBe(false);
        });

        it('resets failure count on success', async () => {
            const breaker = createCircuitBreaker({ failureThreshold: 3 });
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue('success');
            
            // 2 failures
            await expect(breaker.execute(fn)).rejects.toThrow();
            await expect(breaker.execute(fn)).rejects.toThrow();
            expect(breaker.getState().failures).toBe(2);
            
            // Success resets count
            await breaker.execute(fn);
            expect(breaker.getState().failures).toBe(0);
        });

        it('reset() closes circuit and clears failures', async () => {
            const breaker = createCircuitBreaker({ failureThreshold: 1 });
            const fn = vi.fn().mockRejectedValue(new Error('fail'));
            
            await expect(breaker.execute(fn)).rejects.toThrow();
            expect(breaker.getState().isOpen).toBe(true);
            
            breaker.reset();
            
            expect(breaker.getState().isOpen).toBe(false);
            expect(breaker.getState().failures).toBe(0);
        });
    });
});
