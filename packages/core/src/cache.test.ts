import { describe, expect, it } from 'vitest';
import { selectEvictionCandidates } from './cache.js';
import type { CacheEntry } from './types.js';

describe('selectEvictionCandidates', () => {
  it('removes least recently used ready entries only', () => {
    const entries: CacheEntry[] = [
      entry('old', 40, 1),
      entry('active', 40, 2, { active: true }),
      entry('pinned', 40, 3, { pinned: true }),
      entry('new', 40, 4)
    ];

    expect(selectEvictionCandidates(entries, 80, 0, 100).deleteIds).toEqual(['old', 'new']);
  });

  it('does nothing when under cache and free-space limits', () => {
    expect(selectEvictionCandidates([entry('one', 10, 1)], 100, 20, 30)).toEqual({
      deleteIds: [],
      bytesToDelete: 0
    });
  });
});

function entry(id: string, size: number, lastAccessedAt: number, overrides: Partial<CacheEntry> = {}): CacheEntry {
  return {
    id,
    mediaId: 'tmdb:1',
    mediaType: 'movie',
    path: `/cache/${id}.mkv`,
    sizeBytes: size,
    status: 'ready',
    createdAt: 1,
    lastAccessedAt,
    ...overrides
  };
}
