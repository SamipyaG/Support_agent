import api from './axios';

export interface TrafficRedirectResult {
  success: boolean;
  percentage?: number;
  message: string;
}

export interface GManaHealthResult {
  gmanaHealthy: boolean;
  alarmActive: boolean;
}

/** Redirect `percentage`% of traffic to the source stream (bypassing G-Mana). */
export async function redirectTrafficToSource(
  incidentId: string,
  percentage: number,
): Promise<TrafficRedirectResult> {
  const res = await api.post(`/incidents/${incidentId}/traffic/redirect`, { percentage });
  return res.data;
}

/** Revert traffic back to G-Mana once the stream has recovered. */
export async function revertTrafficToGMana(incidentId: string): Promise<TrafficRedirectResult> {
  const res = await api.post(`/incidents/${incidentId}/traffic/revert`);
  return res.data;
}

/** Check whether the G-Mana alarm for this incident is still active. */
export async function checkGManaHealth(incidentId: string): Promise<GManaHealthResult> {
  const res = await api.get(`/incidents/${incidentId}/traffic/health`);
  return res.data;
}
