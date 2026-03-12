/**
 * JiraTool.ts
 * Creates and updates Jira tickets for incidents.
 * Config from .env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY
 */

import axios, { AxiosInstance } from 'axios';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

export interface JiraTicket {
  id: string;
  key: string;   // e.g. "GMANA-123"
  url: string;   // full browser URL
}

export class JiraTool {
  private client: AxiosInstance;
  private projectKey: string;

  constructor() {
    this.projectKey = process.env.JIRA_PROJECT_KEY || 'GMANA';
    this.client = axios.create({
      baseURL: `${process.env.JIRA_BASE_URL}/rest/api/3`,
      auth: {
        username: process.env.JIRA_EMAIL || '',
        password: process.env.JIRA_API_TOKEN || '',
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  }

  async createTicket(params: {
    channelName: string;
    dsUuid: string;
    errorType: string;
    reason: string;
    clusterName: string;
    sourceStatus: string;
    gmanaStatus: string;
    uhLogs: string;
    ciLogs: string;
    redisHealthSummary: string;
    recommendedAction: string;
    isVip: boolean;
  }): Promise<JiraTicket> {
    return withRetry(async () => {
      logger.info(`[Jira] Creating ticket for ${params.channelName}`);
      const res = await this.client.post('/issue', {
        fields: {
          project: { key: this.projectKey },
          summary: `[Auto] Stream issue: ${params.channelName} — ${params.errorType}`,
          issuetype: { name: 'Bug' },
          priority: { name: params.isVip ? 'High' : 'Medium' },
          description: {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{
                type: 'text',
                text: [
                  `Channel: ${params.channelName}`,
                  `DS UUID: ${params.dsUuid}`,
                  `Cluster: ${params.clusterName}`,
                  `Error: ${params.errorType}`,
                  `Reason: ${params.reason}`,
                  `Source: ${params.sourceStatus}`,
                  `G-Mana: ${params.gmanaStatus}`,
                  `Recommended: ${params.recommendedAction}`,
                  `Redis: ${params.redisHealthSummary}`,
                  `\n--- UH Logs ---\n${params.uhLogs.slice(-1500)}`,
                  `\n--- CI Logs ---\n${params.ciLogs.slice(-1500)}`,
                ].join('\n'),
              }],
            }],
          },
          labels: ['gmana-support-ai', 'auto-created'],
        },
      });
      const ticket: JiraTicket = {
        id: res.data.id,
        key: res.data.key,
        url: `${process.env.JIRA_BASE_URL}/browse/${res.data.key}`,
      };
      logger.info(`[Jira] Created: ${ticket.key}`);
      return ticket;
    }, `createTicket(${params.dsUuid})`);
  }

  async addComment(ticketKey: string, comment: string): Promise<void> {
    return withRetry(async () => {
      await this.client.post(`/issue/${ticketKey}/comment`, {
        body: {
          type: 'doc', version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }],
        },
      });
      logger.info(`[Jira] Comment added to ${ticketKey}`);
    }, `addComment(${ticketKey})`);
  }

  async closeTicket(ticketKey: string, resolution: string): Promise<void> {
    await this.addComment(ticketKey, `✅ Resolved: ${resolution}`);
    logger.info(`[Jira] Ticket ${ticketKey} closed`);
  }

  async testConnection(): Promise<{ ok: boolean; email: string; displayName: string }> {
    return withRetry(async () => {
      const res = await this.client.get('/myself');
      return {
        ok: true,
        email: res.data.emailAddress || '',
        displayName: res.data.displayName || '',
      };
    }, 'testConnection()');
  }

  async findExistingTicket(dsUuid: string): Promise<JiraTicket | null> {
    return withRetry(async () => {
      const jql = `project = "${this.projectKey}" AND text ~ "${dsUuid}" AND statusCategory != Done ORDER BY created DESC`;
      const res = await this.client.get('/search', {
        params: { jql, maxResults: 1, fields: 'summary,status' },
      });
      const issue = res.data.issues?.[0];
      if (!issue) return null;
      return {
        id: issue.id,
        key: issue.key,
        url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`,
      };
    }, `findExistingTicket(${dsUuid})`);
  }
}
