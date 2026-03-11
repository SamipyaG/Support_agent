/**
 * ============================================================
 * InMemoryStore.ts  —  Central In-Memory JSON Storage
 * ============================================================
 *
 * WHY THIS EXISTS:
 * Instead of requiring MongoDB/Redis to be running during development,
 * all data is stored in plain JavaScript Maps and arrays in memory.
 * Everything lives in this one file — one place to read, one place
 * to change, and one place to swap out later.
 *
 * WHAT IS STORED HERE:
 * ┌─────────────────┬──────────────────────────────────────────┐
 * │ Store           │ What it holds                            │
 * ├─────────────────┼──────────────────────────────────────────┤
 * │ incidents       │ Full incident lifecycle (state machine)  │
 * │ approvals       │ Pending/decided approval records         │
 * │ actionLogs      │ Every restart/redirect attempt           │
 * │ memoryPatterns  │ What actions worked for which channels   │
 * │ escalationLogs  │ Every Yoni notification sent             │
 * └─────────────────┴──────────────────────────────────────────┘
 *
 * HOW TO SWAP TO MONGODB LATER:
 * Every method in InMemoryStore returns the same shape as a
 * Mongoose document would. To migrate:
 * 1. Create Mongoose models with matching field names
 * 2. Replace each method body with the equivalent Mongoose call
 * 3. The rest of the codebase (agents, services) needs zero changes
 *
 * HOW TO SWAP TO REDIS LATER:
 * Same pattern — replace method bodies with ioredis calls,
 * use JSON.stringify/parse for values, keep method signatures identical.
 *
 * PERSISTENCE ACROSS RESTARTS (optional):
 * Set STORE_PERSIST_PATH in .env to a file path.
 * The store will save to JSON file on every write and reload on startup.
 * Good enough for development — not for production.
 *
 * ============================================================
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { logger } from '../utils/logger';

// ─── Type Definitions ─────────────────────────────────────────────────────────
// These match exactly what the agents expect.
// Keeping them here makes it easy to compare with future Mongoose schemas.

export type IncidentState =
  | 'NEW'
  | 'ANALYZING'
  | 'WAITING_APPROVAL'
  | 'EXECUTING_ACTION'
  | 'MONITORING'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'FAILED';

export interface ActionHistoryEntry {
  action: string;
  executedAt: Date;
  result: string;
  approvedBy: string;
}

// ─── Timeline ──────────────────────────────────────────────────────────────────
// Grouped timeline entries. Consecutive events with the same step+action+details
// are merged: lastSeenAt and count update instead of adding a new row.

export type TimelineStep =
  | 'Alarm'
  | 'Analysis'
  | 'Resource Check'
  | 'Recovery'
  | 'Monitoring'
  | 'Approval'
  | 'Escalation'
  | 'Notification';

export type TimelineTrigger = 'System' | 'Agent' | 'Manual';

export interface TimelineEntry {
  id: string;
  step: TimelineStep;
  trigger: TimelineTrigger;
  action: string;
  details: string;
  startedAt: Date;
  lastSeenAt: Date;
  count: number;          // how many times this identical event was observed
  incidentTimeMs: number; // ms from incident.createdAt to first occurrence
}

export interface Incident {
  _id: string;                    // Auto-generated UUID
  dsUuid: string;
  channelName: string;
  clusterId: string;
  redisInstance: string;
  streamType: 'HLS' | 'DASH';
  isVip: boolean;
  customerId: string;
  state: IncidentState;
  reportedBy: 'HubMonitor' | 'WhatsApp' | 'Email' | 'Support';
  confidenceScore: number;
  recommendedAction: string;
  explanation: string;
  errorCode: string;
  jiraTicketId: string;
  jiraTicketKey: string;
  gManaPlayerUrl: string;
  sourcePlayerUrl: string;
  streamAnalysis: Record<string, unknown>;
  resourceAnalysis: Record<string, unknown>;
  playerAnalysis: Record<string, unknown>;
  actionHistory: ActionHistoryEntry[];
  timeline: TimelineEntry[];       // grouped event timeline (auto-deduplicates repeats)
  restartAttempts: number;
  maxRestartAttempts: number;
  statusLabel?: string;
  resolvedAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface Approval {
  _id: string;
  incidentId: string;
  proposedAction: string;
  actionDetails: Record<string, unknown>;
  decision: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: Date;
  timeoutSeconds: number;
  autoExecuted: boolean;
  createdAt: Date;
}

export interface ActionLog {
  _id: string;
  incidentId: string;
  dsUuid: string;
  action: string;
  cluster: string;
  status: 'success' | 'failed' | 'skipped';
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  errorMessage?: string;
  durationMs: number;
  executedBy: 'auto' | 'manual';
  createdAt: Date;
}

export interface MemoryPattern {
  _id: string;
  patternKey: string;             // Unique key: dsUuid:patternType
  dsUuid: string;
  clusterId: string;
  customerId: string;
  patternType: 'recurring_alarm' | 'resource_spike' | 'stream_error' | 'restart_success' | 'escalation';
  description: string;
  occurrences: number;            // How many times this pattern was seen
  lastSeenAt: Date;
  successfulAction: string;       // What action resolved it last time
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface EscalationLog {
  _id: string;
  incidentId: string;
  dsUuid: string;
  reason: string;
  escalatedTo: string;
  channels: string[];
  messageContent: string;
  sentAt: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
}

// ─── The Store ────────────────────────────────────────────────────────────────

/**
 * InMemoryStore — single class that holds all runtime data.
 *
 * Uses Map<id, record> for O(1) lookups by ID.
 * All query methods filter the Map values array.
 *
 * Thread safety: Node.js is single-threaded, so no locking needed.
 */
class InMemoryStore {
  // The actual data — all stored as Maps keyed by _id
  private incidents   = new Map<string, Incident>();
  private approvals   = new Map<string, Approval>();
  private actionLogs  = new Map<string, ActionLog>();
  private memoryPatterns = new Map<string, MemoryPattern>();
  private escalationLogs = new Map<string, EscalationLog>();

  /** Optional: path to JSON file for persistence across restarts */
  private persistPath = process.env.STORE_PERSIST_PATH || '';

  constructor() {
    // Load from file if persist path is configured
    if (this.persistPath) {
      this.loadFromDisk();
    }
    logger.info('[Store] In-memory store initialized');
  }

  // ═══════════════════════════════════════════════════════════════
  // INCIDENTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a new incident and save to store.
   * Equivalent to: new Incident({...}).save()
   */
  createIncident(data: Omit<Incident, '_id' | 'createdAt' | 'updatedAt'>): Incident {
    const incident: Incident = {
      ...data,
      _id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.incidents.set(incident._id, incident);
    this.persist();
    logger.info(`[Store] Incident created: ${incident._id} for ${incident.dsUuid}`);
    return incident;
  }

  /**
   * Update an incident by ID.
   * Equivalent to: Incident.findByIdAndUpdate(id, {...})
   * Returns the updated incident or null if not found.
   */
  updateIncident(id: string, updates: Partial<Incident>): Incident | null {
    const incident = this.incidents.get(id);
    if (!incident) return null;

    const updated: Incident = {
      ...incident,
      ...updates,
      updatedAt: new Date(),
    };
    this.incidents.set(id, updated);
    this.persist();
    return updated;
  }

  /**
   * Push an event onto the incident's timeline.
   * Grouping rule: search the ENTIRE timeline for an entry with the same
   * step + action + details. If found, extend it (update lastSeenAt, increment
   * count) instead of adding a new row — even if it's not the last entry.
   * This collapses repeated events from re-investigation cycles and polling.
   */
  pushTimelineEvent(
    incidentId: string,
    event: { step: TimelineStep; trigger: TimelineTrigger; action: string; details: string; startedAt?: Date },
  ): void {
    const incident = this.incidents.get(incidentId);
    if (!incident) return;

    const now = event.startedAt ?? new Date();
    const incidentTimeMs = Math.max(0, now.getTime() - incident.createdAt.getTime());

    if (!Array.isArray(incident.timeline)) incident.timeline = [];
    const tl = incident.timeline;

    // Search entire timeline for a matching entry (not just the last one)
    const existing = tl.find(
      (e) => e.step === event.step && e.action === event.action && e.details === event.details,
    );

    if (existing) {
      existing.lastSeenAt = now;
      existing.count++;
    } else {
      tl.push({
        id: randomUUID(),
        step: event.step,
        trigger: event.trigger,
        action: event.action,
        details: event.details,
        startedAt: now,
        lastSeenAt: now,
        count: 1,
        incidentTimeMs,
      });
    }

    incident.updatedAt = new Date();
    this.incidents.set(incidentId, incident);
    this.persist();
  }

  /**
   * Get incident by ID.
   * Equivalent to: Incident.findById(id)
   */
  getIncident(id: string): Incident | null {
    return this.incidents.get(id) ?? null;
  }

  /**
   * Find incidents matching a filter function.
   * Equivalent to: Incident.find({ state: { $nin: [...] } })
   *
   * Example:
   *   store.findIncidents(i => i.dsUuid === 'abc' && i.state !== 'CLOSED')
   */
  findIncidents(filter: (i: Incident) => boolean): Incident[] {
    return Array.from(this.incidents.values()).filter(filter);
  }

  /**
   * Find the most recent incident matching the filter.
   * Equivalent to: Incident.findOne({...}).sort({ createdAt: -1 })
   */
  findOneIncident(filter: (i: Incident) => boolean): Incident | null {
    const matches = this.findIncidents(filter);
    if (matches.length === 0) return null;
    // Return the most recently created
    return matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  /**
   * Get all incidents sorted by creation date (newest first).
   * Optionally filter by state.
   * Equivalent to: Incident.find({ state }).sort({ createdAt: -1 }).limit(n)
   */
  getAllIncidents(options?: {
    state?: IncidentState | IncidentState[];
    limit?: number;
    page?: number;
  }): { incidents: Incident[]; total: number } {
    let all = Array.from(this.incidents.values());

    // Filter by state if provided
    if (options?.state) {
      const states = Array.isArray(options.state) ? options.state : [options.state];
      all = all.filter((i) => states.includes(i.state));
    }

    // Sort newest first
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = all.length;

    // Pagination
    if (options?.page !== undefined && options?.limit) {
      const start = (options.page - 1) * options.limit;
      all = all.slice(start, start + options.limit);
    } else if (options?.limit) {
      all = all.slice(0, options.limit);
    }

    return { incidents: all, total };
  }

  // ═══════════════════════════════════════════════════════════════
  // APPROVALS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Save a new pending approval record.
   * Equivalent to: new Approval({...}).save()
   */
  createApproval(data: Omit<Approval, '_id' | 'createdAt'>): Approval {
    const approval: Approval = {
      ...data,
      _id: randomUUID(),
      createdAt: new Date(),
    };
    this.approvals.set(approval._id, approval);
    this.persist();
    return approval;
  }

  /**
   * Update an approval's decision (approved/rejected/timeout).
   * Equivalent to: Approval.findOneAndUpdate({ incidentId, decision: 'pending' }, {...})
   */
  resolveApproval(
    incidentId: string,
    decision: ApprovalDecision,
    decidedBy?: string,
    autoExecuted = false,
  ): Approval | null {
    // Find the pending approval for this incident
    const approval = Array.from(this.approvals.values()).find(
      (a) => a.incidentId === incidentId && a.decision === 'pending',
    );
    if (!approval) return null;

    const updated: Approval = {
      ...approval,
      decision,
      decidedBy,
      decidedAt: new Date(),
      autoExecuted,
    };
    this.approvals.set(approval._id, updated);
    this.persist();
    return updated;
  }

  /**
   * Get the pending approval for an incident (if any).
   */
  getPendingApproval(incidentId: string): Approval | null {
    return Array.from(this.approvals.values()).find(
      (a) => a.incidentId === incidentId && a.decision === 'pending',
    ) ?? null;
  }

  /**
   * Get all approvals for an incident (full history).
   */
  getApprovalHistory(incidentId: string): Approval[] {
    return Array.from(this.approvals.values())
      .filter((a) => a.incidentId === incidentId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTION LOGS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Append an action log entry.
   * Equivalent to: ActionLog.create({...})
   */
  logAction(data: Omit<ActionLog, '_id' | 'createdAt'>): ActionLog {
    const log: ActionLog = {
      ...data,
      _id: randomUUID(),
      createdAt: new Date(),
    };
    this.actionLogs.set(log._id, log);
    this.persist();
    return log;
  }

  /**
   * Get all action logs for an incident, oldest first.
   */
  getActionLogs(incidentId: string): ActionLog[] {
    return Array.from(this.actionLogs.values())
      .filter((l) => l.incidentId === incidentId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // ═══════════════════════════════════════════════════════════════
  // MEMORY PATTERNS
  // Pattern key format: "{dsUuid}:{patternType}"
  // ═══════════════════════════════════════════════════════════════

  /**
   * Upsert a memory pattern — insert if new, increment occurrences if exists.
   * Equivalent to: MemoryPattern.findOneAndUpdate({ patternKey }, { $inc: { occurrences: 1 } }, { upsert: true })
   *
   * This is the core of the AI memory system — every resolved incident
   * creates/updates a pattern so the AI knows what worked before.
   */
  upsertMemoryPattern(data: Omit<MemoryPattern, '_id' | 'createdAt' | 'occurrences' | 'lastSeenAt'>): MemoryPattern {
    const patternKey = `${data.dsUuid}:${data.patternType}`;
    const existing = Array.from(this.memoryPatterns.values()).find(
      (p) => p.patternKey === patternKey,
    );

    if (existing) {
      // Pattern already exists — increment occurrences, update last seen
      const updated: MemoryPattern = {
        ...existing,
        occurrences: existing.occurrences + 1,
        lastSeenAt: new Date(),
        successfulAction: data.successfulAction || existing.successfulAction,
        description: data.description,
      };
      this.memoryPatterns.set(existing._id, updated);
      this.persist();
      return updated;
    }

    // New pattern — create it
    const pattern: MemoryPattern = {
      ...data,
      _id: randomUUID(),
      patternKey,
      occurrences: 1,
      lastSeenAt: new Date(),
      createdAt: new Date(),
    };
    this.memoryPatterns.set(pattern._id, pattern);
    this.persist();
    return pattern;
  }

  /**
   * Find all memory patterns for a channel or cluster.
   * Used by MemoryAgent to build historical context for GPT-4o.
   */
  findMemoryPatterns(filter: {
    dsUuid?: string;
    clusterId?: string;
    customerId?: string;
    patternType?: MemoryPattern['patternType'];
  }): MemoryPattern[] {
    return Array.from(this.memoryPatterns.values()).filter((p) => {
      if (filter.dsUuid && p.dsUuid !== filter.dsUuid) return false;
      if (filter.clusterId && p.clusterId !== filter.clusterId) return false;
      if (filter.customerId && p.customerId !== filter.customerId) return false;
      if (filter.patternType && p.patternType !== filter.patternType) return false;
      return true;
    }).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  // ═══════════════════════════════════════════════════════════════
  // ESCALATION LOGS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Record that Yoni was notified about an incident.
   */
  logEscalation(data: Omit<EscalationLog, '_id'>): EscalationLog {
    const log: EscalationLog = {
      ...data,
      _id: randomUUID(),
    };
    this.escalationLogs.set(log._id, log);
    this.persist();
    return log;
  }

  /**
   * Get all escalations for an incident.
   */
  getEscalations(incidentId: string): EscalationLog[] {
    return Array.from(this.escalationLogs.values())
      .filter((e) => e.incidentId === incidentId)
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  }

  // ═══════════════════════════════════════════════════════════════
  // FULL SNAPSHOT — used by API routes to return all data
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get a complete incident record with all related data joined.
   * Equivalent to: MongoDB aggregation with $lookup for all collections.
   * This is what GET /api/incidents/:id returns to the frontend.
   */
  getFullIncident(id: string): {
    incident: Incident | null;
    approvals: Approval[];
    actionLogs: ActionLog[];
    escalations: EscalationLog[];
    memoryPatterns: MemoryPattern[];
  } {
    const incident = this.getIncident(id);
    return {
      incident,
      approvals: incident ? this.getApprovalHistory(id) : [],
      actionLogs: incident ? this.getActionLogs(id) : [],
      escalations: incident ? this.getEscalations(id) : [],
      memoryPatterns: incident
        ? this.findMemoryPatterns({ dsUuid: incident.dsUuid })
        : [],
    };
  }

  /**
   * Get a summary of all current data — useful for debugging.
   */
  getStats(): Record<string, number> {
    return {
      incidents: this.incidents.size,
      approvals: this.approvals.size,
      actionLogs: this.actionLogs.size,
      memoryPatterns: this.memoryPatterns.size,
      escalationLogs: this.escalationLogs.size,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // OPTIONAL FILE PERSISTENCE
  // Set STORE_PERSIST_PATH=/tmp/gmana-store.json in .env
  // to survive process restarts during development.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Save entire store to a JSON file.
   * Called automatically on every write if STORE_PERSIST_PATH is set.
   */
  private persist(): void {
    if (!this.persistPath) return;
    try {
      const data = {
        incidents:      Array.from(this.incidents.entries()),
        approvals:      Array.from(this.approvals.entries()),
        actionLogs:     Array.from(this.actionLogs.entries()),
        memoryPatterns: Array.from(this.memoryPatterns.entries()),
        escalationLogs: Array.from(this.escalationLogs.entries()),
        savedAt:        new Date().toISOString(),
      };
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      // Non-fatal — don't crash the system just because file save failed
      logger.warn('[Store] Could not persist to disk', { err: String(err) });
    }
  }

  /**
   * Load store from JSON file on startup.
   * Called once in constructor if STORE_PERSIST_PATH is set.
   */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.persistPath)) {
        logger.info('[Store] No persist file found, starting fresh');
        return;
      }
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const data = JSON.parse(raw);

      // Restore Maps from serialized [key, value] entry arrays
      // Also restore Date objects (JSON serializes them as strings)
      this.incidents      = new Map(data.incidents?.map(([k, v]: [string, Incident]) =>
        [k, this.restoreDates(v as unknown as Record<string, unknown>, ['createdAt', 'updatedAt', 'resolvedAt', 'closedAt']) as unknown as Incident]));
      this.approvals      = new Map(data.approvals?.map(([k, v]: [string, Approval]) =>
        [k, this.restoreDates(v as unknown as Record<string, unknown>, ['createdAt', 'decidedAt']) as unknown as Approval]));
      this.actionLogs     = new Map(data.actionLogs?.map(([k, v]: [string, ActionLog]) =>
        [k, this.restoreDates(v as unknown as Record<string, unknown>, ['createdAt']) as unknown as ActionLog]));
      this.memoryPatterns = new Map(data.memoryPatterns?.map(([k, v]: [string, MemoryPattern]) =>
        [k, this.restoreDates(v as unknown as Record<string, unknown>, ['createdAt', 'lastSeenAt']) as unknown as MemoryPattern]));
      this.escalationLogs = new Map(data.escalationLogs?.map(([k, v]: [string, EscalationLog]) =>
        [k, this.restoreDates(v as unknown as Record<string, unknown>, ['sentAt', 'acknowledgedAt']) as unknown as EscalationLog]));

      logger.info(`[Store] Loaded from disk: ${JSON.stringify(this.getStats())}`);
    } catch (err) {
      logger.warn('[Store] Could not load from disk, starting fresh', { err: String(err) });
    }
  }

  /**
   * Restore Date objects from JSON strings.
   * JSON.parse returns date strings as strings, not Date objects.
   * This converts specified fields back to proper Date instances.
   */
  private restoreDates<T extends Record<string, unknown>>(obj: T, dateFields: string[]): T {
    const result = { ...obj };
    for (const field of dateFields) {
      if (result[field] && typeof result[field] === 'string') {
        (result as Record<string, unknown>)[field] = new Date(result[field] as string);
      }
    }
    // Restore dates inside actionHistory array
    if (Array.isArray((result as Record<string, unknown>).actionHistory)) {
      (result as Record<string, unknown>).actionHistory = (
        (result as Record<string, unknown>).actionHistory as ActionHistoryEntry[]
      ).map((entry) => ({
        ...entry,
        executedAt: new Date(entry.executedAt),
      }));
    }
    // Restore dates inside timeline array
    if (Array.isArray((result as Record<string, unknown>).timeline)) {
      (result as Record<string, unknown>).timeline = (
        (result as Record<string, unknown>).timeline as TimelineEntry[]
      ).map((entry) => ({
        ...entry,
        startedAt: new Date(entry.startedAt),
        lastSeenAt: new Date(entry.lastSeenAt),
      }));
    }
    return result;
  }

  /**
   * Clear all data — useful for testing or resetting state.
   * Also deletes the persist file if one exists.
   */
  clear(): void {
    this.incidents.clear();
    this.approvals.clear();
    this.actionLogs.clear();
    this.memoryPatterns.clear();
    this.escalationLogs.clear();
    if (this.persistPath && fs.existsSync(this.persistPath)) {
      fs.unlinkSync(this.persistPath);
    }
    logger.info('[Store] All data cleared');
  }
}

/**
 * Singleton instance — one store shared across the entire application.
 * Import this anywhere you need to read or write data:
 *
 *   import { store } from './InMemoryStore';
 *   const incident = store.createIncident({...});
 *   store.updateIncident(id, { state: 'ANALYZING' });
 */
export const store = new InMemoryStore();
