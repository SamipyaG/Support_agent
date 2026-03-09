/**
 * ============================================================
 * Incident.ts  —  The Central MongoDB Document
 * ============================================================
 *
 * The Incident is the single source of truth for everything
 * that happens during a stream outage.
 *
 * LIFECYCLE:
 *   Created when an alarm arrives → updated at every state transition
 *   → saved with analysis results → saved with action history
 *   → marked resolved → auto-deleted after 90 days (TTL index)
 *
 * KEY FIELDS EXPLAINED:
 *
 *   dsUuid        The unique identifier for the channel deployment.
 *                 This is the primary "address" of a channel in G-Mana.
 *                 Used in all API calls: restart, logs, pod status.
 *
 *   clusterId     Which Kubernetes cluster this channel runs on.
 *                 hub1x or hub21. Used in API paths like:
 *                 POST /sendalarms/clusters/{clusterId}/deployments/...
 *
 *   redisInstance Which Redis instance this channel uses (Am/Bm/Cm).
 *                 Keshet → Bm, Reshet → Am.
 *
 *   state         Current state in the state machine.
 *                 The frontend uses this for the status badge color.
 *
 *   confidenceScore  0-100% score from merged agent analysis.
 *                    Below 80% → always escalate, never auto-act.
 *
 *   recommendedAction  What the agents think we should do.
 *                      e.g., "RESTART_UH", "NOTIFY_CUSTOMER_SOURCE_DOWN"
 *
 *   errorCode     The specific error type detected.
 *                 e.g., "SEGMENT_MISMATCH_ERROR", "HTTP_502_UPSTREAM_ERROR"
 *
 *   restartAttempts  How many times we've tried to restart.
 *                    Must be < maxRestartAttempts (2) or we escalate.
 *
 *   actionHistory  Array of every action taken, when, result, and who approved.
 *                  This drives the timeline in the UI.
 *
 *   streamAnalysis   Raw data from StreamAnalyzerAgent (manifest URLs, HTTP status, etc.)
 *   resourceAnalysis Raw data from ResourceAnalyzerAgent (pod status, CPU, Redis health)
 *   playerAnalysis   Raw data from PlayerAnalyzerAgent (sequence numbers, ad markers, etc.)
 *
 * TTL INDEX:
 *   { createdAt: 1 } with expireAfterSeconds: 7,776,000 (90 days)
 *   MongoDB automatically deletes incidents older than 90 days.
 *   This keeps the database size manageable without manual cleanup.
 *
 * ============================================================
 */

import mongoose, { Schema, Document } from 'mongoose';
import { IncidentState } from '../stateMachine/IncidentStateMachine';

export interface IIncident extends Document {
  dsUuid: string;
  channelName: string;
  clusterId: string;
  redisInstance: string;
  streamType: 'HLS' | 'DASH';
  isVip: boolean;
  customerId: string;
  state: IncidentState;
  confidenceScore: number;
  recommendedAction: string;
  explanation: string;
  errorCode: string;
  jiraTicketId: string;
  jiraTicketKey: string;
  reportedBy: 'HubMonitor' | 'WhatsApp' | 'Email' | 'Support';
  restartAttempts: number;
  maxRestartAttempts: number;
  gManaPlayerUrl: string;
  sourcePlayerUrl: string;
  streamAnalysis: Record<string, unknown>;
  resourceAnalysis: Record<string, unknown>;
  playerAnalysis: Record<string, unknown>;
  actionHistory: Array<{
    action: string;
    executedAt: Date;
    result: string;
    approvedBy?: string;
  }>;
  resolvedAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IncidentSchema = new Schema<IIncident>(
  {
    dsUuid:          { type: String, required: true, index: true },
    channelName:     { type: String, required: true },
    clusterId:       { type: String, required: true },
    redisInstance:   { type: String, required: true },
    streamType:      { type: String, enum: ['HLS', 'DASH'], default: 'HLS' },
    isVip:           { type: Boolean, default: false },
    customerId:      { type: String, required: true },

    // Current state — controlled exclusively by IncidentStateMachine
    state: {
      type: String,
      enum: ['NEW', 'ANALYZING', 'WAITING_APPROVAL', 'EXECUTING_ACTION',
             'MONITORING', 'ESCALATED', 'RESOLVED', 'CLOSED', 'FAILED'],
      default: 'NEW',
    },

    // Analysis outputs — populated after agent analysis phase
    confidenceScore:   { type: Number, default: 0, min: 0, max: 100 },
    recommendedAction: { type: String, default: '' },
    explanation:       { type: String, default: '' },
    errorCode:         { type: String, default: '' },

    // Jira integration — populated after ticket is created
    jiraTicketId:  { type: String, default: '' },
    jiraTicketKey: { type: String, default: '' },  // e.g., "GMANA-123"

    // How the incident was created
    reportedBy: {
      type: String,
      enum: ['HubMonitor', 'WhatsApp', 'Email', 'Support'],
      default: 'HubMonitor',
    },

    // Restart tracking — enforces the 2-restart-max business rule
    restartAttempts:    { type: Number, default: 0 },
    maxRestartAttempts: { type: Number, default: 2 },

    // Stream URLs — populated from Hub Monitor getStreamDetails()
    gManaPlayerUrl: { type: String, default: '' },
    sourcePlayerUrl: { type: String, default: '' },

    // Raw analysis data — stored as flexible JSON (Mixed type)
    streamAnalysis:   { type: Schema.Types.Mixed, default: {} },
    resourceAnalysis: { type: Schema.Types.Mixed, default: {} },
    playerAnalysis:   { type: Schema.Types.Mixed, default: {} },

    // Audit trail of every action taken
    actionHistory: [
      {
        action:     String,
        executedAt: Date,
        result:     String,
        approvedBy: String,  // Who approved (or "auto" for timeout-approved)
      },
    ],

    resolvedAt: { type: Date },
    closedAt:   { type: Date },
  },
  {
    timestamps: true,  // Automatically adds createdAt and updatedAt fields
  },
);

// TTL index: MongoDB auto-deletes documents after 90 days.
// 60 * 60 * 24 * 90 = 7,776,000 seconds
IncidentSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

// Compound index for the common query: "active incidents for channel X"
IncidentSchema.index({ dsUuid: 1, state: 1 });

// Index for the dashboard list query (sorted by newest)
IncidentSchema.index({ createdAt: -1 });

export const Incident = mongoose.model<IIncident>('Incident', IncidentSchema);
