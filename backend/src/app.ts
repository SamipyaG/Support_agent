/**
 * app.ts — Express application setup
 */

import express from 'express';
import cors from 'cors';
import incidentRoutes from './routes/incidents';
import approvalRoutes from './routes/approvals';
import alarmRoutes from './routes/alarms';
import redisRoutes from './routes/redis';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/incidents', incidentRoutes);
app.use('/api/approve', approvalRoutes);
app.use('/api/alarms', alarmRoutes);
app.use('/api/redis', redisRoutes);

export default app;
