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
