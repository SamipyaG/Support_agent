/**
 * ============================================================
 * RedisEventBus.ts
 * ============================================================
 *
 * ROLE: Pub/Sub event bus built on Redis.
 * Decouples the components that generate events (Hub Monitor polling,
 * WhatsApp messages, email handlers) from the ManagerAgent that
 * processes them. Any part of the system can publish an event,
 * and any subscriber will react automatically.
 *
 * WHY REDIS PUB/SUB:
 * - Decoupled: the WhatsApp handler doesn't need to import ManagerAgent
 * - Scalable: multiple backend instances can subscribe to the same channel
 * - Persistent: events survive brief network hiccups
 * - Observable: you can monitor events in Redis CLI for debugging
 *
 * HOW TO USE:
 * Publishing (from anywhere in the codebase):
 *   await eventBus.publish('alarm:new', { dsUuid: 'abc-123', ... });
 *
 * Subscribing (from ManagerAgent, typically):
 *   eventBus.on('alarm:new', async (event) => {
 *     await manager.handleNewAlarm(event.payload);
 *   });
 *
 * EVENTS:
 * - alarm:new           → new DOWN alarm detected
 * - alarm:update        → existing alarm updated
 * - alarm:closed        → stream recovered
 * - approval:received   → support team approved/rejected action
 * - incident:resolved   → incident successfully resolved
 * - incident:escalated  → incident escalated to Yoni
 * - incident:failed     → incident hit unrecoverable error
 * ============================================================
 */

import Redis from 'ioredis';
import { logger } from '../utils/logger';

/** All event types published on the Redis channel */
export type RedisEventType =
  | 'alarm:new'
  | 'alarm:update'
  | 'alarm:closed'
  | 'approval:received'
  | 'incident:resolved'
  | 'incident:escalated'
  | 'incident:failed';

/** Wrapper for all published events — includes metadata */
export interface RedisEvent<T = Record<string, unknown>> {
  type: RedisEventType;
  payload: T;
  timestamp: string; // ISO string
}

type EventHandler<T = Record<string, unknown>> = (event: RedisEvent<T>) => Promise<void>;

export class RedisEventBus {
  /**
   * Two separate Redis connections are needed:
   * - publisher: sends messages (write-only)
   * - subscriber: receives messages (read-only, blocks the connection)
   * Redis requires separate connections for pub and sub.
   */
  private publisher: Redis;
  private subscriber: Redis;

  /** Map from event type → list of handler functions */
  private handlers: Map<RedisEventType, EventHandler[]> = new Map();

  /** The Redis channel name all events go through */
  private readonly CHANNEL = 'gmana:events';

  constructor() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      // Auto-reconnect: wait longer between each retry (200ms, 400ms, 600ms...)
      retryStrategy: (times: number) => Math.min(times * 200, 3000),
    };

    // Two Redis connections: one for publishing, one for subscribing
    this.publisher = new Redis(redisConfig);
    this.subscriber = new Redis(redisConfig);

    // Log Redis connection errors (non-fatal)
    this.publisher.on('error', (err) => logger.error('[Redis Publisher] Error', { err: err.message }));
    this.subscriber.on('error', (err) => logger.error('[Redis Subscriber] Error', { err: err.message }));

    // Subscribe to the events channel
    this.subscriber.subscribe(this.CHANNEL, (err) => {
      if (err) logger.error('[Redis] Failed to subscribe', { err: err.message });
      else logger.info(`[Redis] Subscribed to channel: ${this.CHANNEL}`);
    });

    // When a message arrives, route it to the right handlers
    this.subscriber.on('message', (_channel, message) => {
      this.handleMessage(message);
    });
  }

  /**
   * Publish an event to the Redis channel.
   * All subscribers (including this same instance) will receive it.
   *
   * @param type     The event type (e.g., 'alarm:new')
   * @param payload  The event data (e.g., AlarmData object)
   */
  async publish<T = Record<string, unknown>>(type: RedisEventType, payload: T): Promise<void> {
    const event: RedisEvent<T> = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    await this.publisher.publish(this.CHANNEL, JSON.stringify(event));
    logger.info(`[Redis] Published: ${type}`);
  }

  /**
   * Register a handler for a specific event type.
   * Multiple handlers can be registered for the same event type —
   * all will be called when that event fires.
   *
   * @param type     The event type to listen for
   * @param handler  Async function to call when event fires
   */
  on<T = Record<string, unknown>>(type: RedisEventType, handler: EventHandler<T>): void {
    const existing = this.handlers.get(type) || [];
    existing.push(handler as EventHandler);
    this.handlers.set(type, existing);
  }

  /**
   * Internal: called when Redis delivers a message.
   * Parses the JSON, finds registered handlers, calls them all.
   * Errors in handlers are caught and logged (don't kill the process).
   *
   * @param message  Raw JSON string from Redis
   */
  private async handleMessage(message: string): Promise<void> {
    try {
      const event = JSON.parse(message) as RedisEvent;
      const handlers = this.handlers.get(event.type) || [];

      // Call all registered handlers for this event type
      for (const handler of handlers) {
        await handler(event).catch((err: Error) =>
          logger.error(`[Redis] Handler error for ${event.type}`, { err: err.message }),
        );
      }
    } catch (err) {
      logger.error('[Redis] Failed to parse event message', { err: String(err) });
    }
  }

  /** Cleanly close both Redis connections on shutdown */
  async disconnect(): Promise<void> {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}

/** Singleton — one event bus shared across the whole application */
export const eventBus = new RedisEventBus();
