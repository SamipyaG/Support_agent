/**
 * ============================================================
 * retry.ts  —  Exponential Backoff Retry Utility
 * ============================================================
 *
 * External API calls WILL fail occasionally:
 *   • Hub Monitor API might be temporarily overloaded
 *   • Jira's rate limiter might kick in
 *   • OpenAI might return a 503 during high traffic
 *   • Redis might be in the middle of a leader election
 *
 * This utility wraps any async function with automatic retry logic.
 * Instead of failing immediately on a transient error, it retries
 * with exponential backoff (progressively longer waits).
 *
 * EXPONENTIAL BACKOFF PATTERN:
 *
 *   Attempt 1 fails → wait  500ms
 *   Attempt 2 fails → wait 1000ms (500 × 2^1)
 *   Attempt 3 fails → throw final error
 *
 *   Max delay is capped at 8000ms to prevent infinite waits.
 *
 * USAGE EXAMPLE:
 *
 *   const result = await withRetry(
 *     () => hubMonitorClient.get('/alarms'),
 *     'HubMonitor.getAlarms',
 *     { maxAttempts: 3 }
 *   );
 *
 * ============================================================
 */

import axios from 'axios';
import { logger } from './logger';

/** Configuration options for the retry wrapper */
export interface RetryOptions {
  maxAttempts?: number;   // How many total tries before giving up (default: 3)
  baseDelayMs?: number;   // Initial delay in ms (default: 500ms)
  maxDelayMs?: number;    // Maximum delay cap in ms (default: 8000ms)
  factor?: number;        // Backoff multiplier (default: 2 = doubles each time)
}

/**
 * Wraps an async function with exponential backoff retry logic.
 *
 * @param fn      - The async function to retry (must be a () => Promise<T>)
 * @param context - A descriptive string for logging (e.g., "HubMonitor.getAlarms")
 * @param options - Optional configuration overrides
 * @returns       - The resolved value of fn() on success
 * @throws        - The last error from fn() after all attempts are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, maxDelayMs = 8000, factor = 2 } = options;
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Try the function
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // If this was the last attempt, don't wait — just break and throw
      if (attempt === maxAttempts) break;

      // Don't retry non-transient HTTP errors (4xx, 500, etc.)
      // Only 502/503 are transient (gateway/service temporarily unavailable)
      if (axios.isAxiosError(lastError) && lastError.response) {
        const status = lastError.response.status;
        if (status !== 502 && status !== 503) {
          logger.warn(`[Retry] ${context} HTTP ${status} — not retrying (non-transient)`);
          break;
        }
      }

      // Calculate delay: base × factor^(attempt-1), capped at maxDelay
      // attempt 1: 500 × 2^0 = 500ms
      // attempt 2: 500 × 2^1 = 1000ms
      // attempt 3: 500 × 2^2 = 2000ms (if maxAttempts were 4)
      const delay = Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs);

      logger.warn(`[Retry] ${context} failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms`, {
        error: lastError.message,
      });
      await sleep(delay);
    }
  }

  // All attempts exhausted
  logger.error(`[Retry] ${context} exhausted all ${maxAttempts} attempts`, { error: lastError.message });
  throw lastError;
}

/**
 * Simple promise-based sleep.
 * Used by withRetry() for delays and by ManagerAgent for post-action waits.
 *
 * @example
 *   await sleep(30000);  // Wait 30 seconds after restart before checking health
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
