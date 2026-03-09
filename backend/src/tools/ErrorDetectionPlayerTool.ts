/**
 * ErrorDetectionPlayerTool.ts
 *
 * Checks a stream URL for errors.
 * Currently a PLACEHOLDER — the real error_detection_player is in development.
 *
 * When the real player is ready:
 *  1. Replace the body of checkUrl() with the actual API call
 *  2. Map the real response fields to PlayerCheckResult
 *  3. Everything else in the system stays the same
 *
 * The placeholder simulates a real check by doing a basic HTTP HEAD
 * request to the URL and returning a result based on the status code.
 * This gives us something to test with until the real player is ready.
 */

import axios from 'axios';
import { logger } from '../utils/logger';

export interface PlayerCheckResult {
  url: string;
  hasError: boolean;       // true = stream has a problem
  isReachable: boolean;    // false = URL returned non-200 or timed out
  statusCode: number | null;
  errorType: string | null; // e.g. "HTTP_404", "TIMEOUT", "NO_AD_MARKERS", null if ok
  errorDetail: string | null;
  checkedAt: string;        // ISO timestamp
}

export class ErrorDetectionPlayerTool {
  /**
   * Check a stream URL for errors.
   *
   * Called by ManagerAgent for BOTH sourcePlayerUrl and gManaPlayerUrl.
   * Results determine whether the issue is upstream (source) or in G-Mana.
   *
   * PLACEHOLDER BEHAVIOR:
   *  - HTTP 200 → no error
   *  - HTTP 4xx/5xx → hasError = true
   *  - Timeout / unreachable → hasError = true, isReachable = false
   *
   * REAL PLAYER will return richer data:
   *  - Segment continuity errors
   *  - Missing SCTE-35 ad markers
   *  - Manifest parse errors
   *  - Bitrate issues
   *  etc.
   */
  async checkUrl(url: string): Promise<PlayerCheckResult> {
    const checkedAt = new Date().toISOString();

    // ── PLACEHOLDER: basic HTTP check ────────────────────────
    // TODO: Replace this block with the real error_detection_player API call
    // when it is ready. Keep the return type (PlayerCheckResult) the same.
    // ─────────────────────────────────────────────────────────

    if (!url) {
      return {
        url,
        hasError: true,
        isReachable: false,
        statusCode: null,
        errorType: 'EMPTY_URL',
        errorDetail: 'No URL provided',
        checkedAt,
      };
    }

    try {
      logger.info(`[ErrorDetectionPlayer] Checking URL: ${url}`);

      // Basic reachability check using HEAD request
      // Real player will do deep manifest analysis instead
      const res = await axios.head(url, {
        timeout: 10000,
        validateStatus: () => true, // Don't throw on any status
      });

      const statusCode = res.status;
      const isReachable = statusCode >= 200 && statusCode < 400;
      const hasError = !isReachable;

      let errorType: string | null = null;
      let errorDetail: string | null = null;

      if (!isReachable) {
        if (statusCode === 404) {
          errorType = 'HTTP_404';
          errorDetail = `Manifest not found (404) at ${url}`;
        } else if (statusCode === 502 || statusCode === 503) {
          errorType = `HTTP_${statusCode}`;
          errorDetail = `Upstream error (${statusCode}) — pod may be down`;
        } else {
          errorType = `HTTP_${statusCode}`;
          errorDetail = `Unexpected HTTP status ${statusCode}`;
        }
      }

      logger.info(
        `[ErrorDetectionPlayer] ${url} → ${statusCode} | hasError: ${hasError}`,
      );

      return {
        url,
        hasError,
        isReachable,
        statusCode,
        errorType,
        errorDetail,
        checkedAt,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes('timeout') || message.includes('ECONNABORTED');

      logger.warn(`[ErrorDetectionPlayer] Failed to reach ${url}: ${message}`);

      return {
        url,
        hasError: true,
        isReachable: false,
        statusCode: null,
        errorType: isTimeout ? 'TIMEOUT' : 'UNREACHABLE',
        errorDetail: message,
        checkedAt,
      };
    }
  }

  /**
   * Check both source and G-Mana URLs in parallel.
   * Returns both results together — used by ManagerAgent for the split decision.
   */
  async checkBoth(
    sourceUrl: string,
    gmanaUrl: string,
  ): Promise<{ source: PlayerCheckResult; gmana: PlayerCheckResult }> {
    logger.info('[ErrorDetectionPlayer] Checking both URLs in parallel...');

    const [source, gmana] = await Promise.all([
      this.checkUrl(sourceUrl),
      this.checkUrl(gmanaUrl),
    ]);

    logger.info(
      `[ErrorDetectionPlayer] Source: ${source.hasError ? '❌ ERROR' : '✅ OK'} | ` +
      `G-Mana: ${gmana.hasError ? '❌ ERROR' : '✅ OK'}`,
    );

    return { source, gmana };
  }
}
