/**
 * routes/redis.ts
 * GET /api/redis  — returns Redis health for all clusters (hub1x + hub21)
 */

import { Router, Request, Response } from 'express';
import { HubMonitorTool } from '../tools/HubMonitorTool';

const router = Router();

const CLUSTERS = ['hub1x', 'hub21'];

router.get('/', async (req: Request, res: Response) => {
  const hubMonitor: HubMonitorTool = req.app.get('hubMonitor');
  if (!hubMonitor) {
    return res.status(500).json({ error: 'HubMonitorTool not initialized' });
  }

  const results = await Promise.allSettled(
    CLUSTERS.map((c) => hubMonitor.getRedisResources(c)),
  );

  const clusters = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { clusterName: CLUSTERS[i], error: String((r as PromiseRejectedResult).reason) };
  });

  res.json({ clusters });
});

export default router;
