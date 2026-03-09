/**
 * index.ts — Application Bootstrap
 *
 * Starts the polling loop for Hub Monitor alarms.
 * No WhatsApp or email — just Hub Monitor polling for now.
 *
 * Flow:
 *  1. Instantiate all tools and agents
 *  2. Register ManagerAgent on Express app (for routes to use)
 *  3. Start polling loop: every POLL_INTERVAL_MS → GET /sendalarms/status/alarms → processAlarms()
 *  4. Start HTTP server
 */

import 'dotenv/config';
import app from './app';
import { store } from './store/InMemoryStore';
import { HubMonitorTool } from './tools/HubMonitorTool';
import { ApprovalService } from './services/ApprovalService';
import { ManagerAgent } from './agents/ManagerAgent';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT || '3000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);

async function bootstrap() {
  // ── Validate required env vars ─────────────────────────────────────────────
  const required = ['HUB_MONITOR_BASE_URL', 'HUB_MONITOR_COOKIE', 'G11_BASE_URL', 'G11_AUTH_TOKEN'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error(`[Bootstrap] Missing required env vars: ${missing.join(', ')}`);
    logger.error('[Bootstrap] Please copy .env.example to .env and fill in the values');
    process.exit(1);
  }

  // ── Instantiate tools ──────────────────────────────────────────────────────
  const hubMonitor  = new HubMonitorTool();
  const approvalSvc = new ApprovalService();

  // ── Instantiate ManagerAgent ───────────────────────────────────────────────
  const managerAgent = new ManagerAgent(hubMonitor, approvalSvc);

  // Make agents/tools available to Express routes
  app.set('managerAgent', managerAgent);
  app.set('hubMonitor', hubMonitor);

  // ── Start Hub Monitor polling loop ─────────────────────────────────────────
  logger.info(`[Bootstrap] Starting Hub Monitor polling every ${POLL_INTERVAL_MS / 1000}s`);

  let isPolling = false; // Prevent overlapping poll cycles

  const poll = async () => {
    if (isPolling) {
      logger.debug('[Bootstrap] Previous poll still running, skipping');
      return;
    }
    isPolling = true;
    try {
      const alarms = await hubMonitor.getActiveAlarms();
      await managerAgent.processAlarms(alarms);
    } catch (err) {
      logger.error('[Bootstrap] Poll cycle failed', { err: String(err) });
    } finally {
      isPolling = false;
    }
  };

  // Run once immediately on startup, then every POLL_INTERVAL_MS
  await poll();
  const pollInterval = setInterval(poll, POLL_INTERVAL_MS);

  // ── Start HTTP server ──────────────────────────────────────────────────────
  app.listen(PORT, () => {
    logger.info(`[Bootstrap] G-Mana Support AI running on http://localhost:${PORT}`);
    logger.info(`[Bootstrap] Poll interval: every ${POLL_INTERVAL_MS / 1000}s`);
    logger.info(`[Bootstrap] Store: ${JSON.stringify(store.getStats())}`);
    logger.info(`[Bootstrap] Persist: ${process.env.STORE_PERSIST_PATH || 'disabled (in-memory only)'}`);
    logger.info('');
    logger.info('[Bootstrap] API Endpoints:');
    logger.info(`  GET  http://localhost:${PORT}/health`);
    logger.info(`  GET  http://localhost:${PORT}/api/incidents`);
    logger.info(`  GET  http://localhost:${PORT}/api/incidents/:id`);
    logger.info(`  POST http://localhost:${PORT}/api/alarms/manual   { "dsUuid": "..." }`);
    logger.info(`  POST http://localhost:${PORT}/api/approve/:id     { "decision": "approved|rejected", "decidedBy": "..." }`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  process.on('SIGTERM', () => {
    logger.info('[Bootstrap] Shutting down...');
    clearInterval(pollInterval);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('[Bootstrap] Shutting down...');
    clearInterval(pollInterval);
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  logger.error('[Bootstrap] Fatal startup error', { err: String(err) });
  process.exit(1);
});
