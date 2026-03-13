import api from './axios';

export interface LogsResult {
  dsUuid: string;
  podName: string;
  logs: string;
}

export interface RestartResult {
  success: boolean;
  message: string;
  deploymentName: string;
  timestamp: string;
}

export async function fetchUHLogs(incidentId: string): Promise<LogsResult> {
  const res = await api.get(`/incidents/${incidentId}/logs/uh`);
  return res.data;
}

export async function fetchCILogs(incidentId: string): Promise<LogsResult> {
  const res = await api.get(`/incidents/${incidentId}/logs/ci`);
  return res.data;
}

export async function restartUH(incidentId: string): Promise<RestartResult> {
  const res = await api.post(`/incidents/${incidentId}/restart/uh`);
  return res.data;
}

export async function restartCI(incidentId: string): Promise<RestartResult> {
  const res = await api.post(`/incidents/${incidentId}/restart/ci`);
  return res.data;
}

// ── Log Analysis ─────────────────────────────────────────────────────────────

export interface LogIssue {
  severity: 'CRITICAL' | 'ERROR' | 'WARN';
  message: string;
  lineNumber: number;
}

export interface LogAnalysis {
  service: string;
  podName: string;
  issues: LogIssue[];
  analyzedAt: string;
}

const CRITICAL_RE = /\b(FATAL|CRITICAL|OutOfMemoryError|StackOverflowError|OOMKilled|killed)\b/i;
const ERROR_RE    = /\b(ERROR|Exception:|Error:|EXCEPTION|NullPointerException|ConnectionRefused|Connection refused|timed.?out|refused)\b/i;
const WARN_RE     = /\b(WARN(?:ING)?|deprecated|Retrying|retrying)\b/i;
const SKIP_RE     = /^\s*(at\s+[\w$./\\<>]+\(|---+|\*{3,})/;

export function analyzeLog(result: LogsResult, service: string): LogAnalysis {
  const lines = result.logs.split('\n');
  const issues: LogIssue[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || SKIP_RE.test(line)) continue;

    let severity: LogIssue['severity'] | null = null;
    if (CRITICAL_RE.test(line))   severity = 'CRITICAL';
    else if (ERROR_RE.test(line)) severity = 'ERROR';
    else if (WARN_RE.test(line))  severity = 'WARN';

    if (!severity) continue;

    // Deduplicate near-identical messages
    const key = `${severity}:${line.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    issues.push({
      severity,
      message: line.length > 260 ? line.slice(0, 260) + '…' : line,
      lineNumber: i + 1,
    });

    if (issues.length >= 100) break;
  }

  const ORDER: Record<string, number> = { CRITICAL: 0, ERROR: 1, WARN: 2 };
  issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  return { service, podName: result.podName, issues, analyzedAt: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Triggers an automatic file download in the browser using a Blob. */
export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
