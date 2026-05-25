import type { CacheEntry, EvictionPlan } from './types.js';

export function selectEvictionCandidates(
  entries: CacheEntry[],
  maxBytes: number,
  minFreeBytes: number,
  currentFreeBytes: number
): EvictionPlan {
  const totalBytes = entries.reduce((sum, entry) => sum + Math.max(0, entry.sizeBytes), 0);
  const neededForMax = Math.max(0, totalBytes - maxBytes);
  const neededForFreeSpace = Math.max(0, minFreeBytes - currentFreeBytes);
  const targetBytes = Math.max(neededForMax, neededForFreeSpace);

  if (targetBytes <= 0) {
    return { deleteIds: [], bytesToDelete: 0 };
  }

  const removable = entries
    .filter((entry) => entry.status === 'ready' && !entry.pinned && !entry.active)
    .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);

  const deleteIds: string[] = [];
  let bytesToDelete = 0;
  for (const entry of removable) {
    deleteIds.push(entry.id);
    bytesToDelete += Math.max(0, entry.sizeBytes);
    if (bytesToDelete >= targetBytes) break;
  }

  return { deleteIds, bytesToDelete };
}
