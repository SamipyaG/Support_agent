/**
 * routes/channels.ts
 * GET /api/channels/vip — returns channel names belonging to Keshet and Reshet customers.
 * Fetches from G11 getAllChannelList API and filters by customerName.
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

const VIP_CUSTOMERS = ['keshet', 'reshet'];

router.get('/vip', async (_req: Request, res: Response) => {
  const baseUrl  = process.env.G11_BASE_URL;
  const path     = process.env.G11_CHANNEL_LIST_PATH || '/api_v1/channel/getAllChannelList';
  const token    = process.env.G11_AUTH_TOKEN;

  if (!baseUrl || !token) {
    return res.status(500).json({ error: 'G11 API not configured' });
  }

  try {
    const response = await axios.get<{ name: string; customerId: { customerName: string } }[]>(
      `${baseUrl}${path}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const channels = Array.isArray(response.data) ? response.data : [];

    // API shape: { name: string, customerId: { customerName: string } }
    const vipNames = channels
      .filter((ch) => VIP_CUSTOMERS.includes((ch.customerId?.customerName || '').toLowerCase()))
      .map((ch) => ch.name)
      .filter(Boolean);

    res.json({ channels: vipNames });
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch channel list: ${(err as Error).message}` });
  }
});

export default router;
