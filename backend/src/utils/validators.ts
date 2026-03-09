export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

export function isValidDsUUID(value: string): boolean {
  // ds_uuid format: xxxxxxxx-xxxx (short form used by G-Mana)
  const shortUUID = /^[0-9a-f]{8}-[0-9a-f]{4}$/i;
  return isValidUUID(value) || shortUUID.test(value);
}

export function sanitizeString(value: string): string {
  return value.replace(/[<>'"`;]/g, '').trim();
}

export function isValidCluster(cluster: string): boolean {
  const validClusters = ['hub1x', 'hub21', 'hub3x', 'hub4x'];
  return validClusters.includes(cluster.toLowerCase());
}

export function isValidRedisInstance(instance: string): boolean {
  return ['Am', 'Bm', 'Cm'].includes(instance);
}
