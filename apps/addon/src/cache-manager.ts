import fs from 'node:fs';
import path from 'node:path';
import { selectEvictionCandidates } from '@xcache/core';
import type { AppConfig } from './env.js';
import type { XCacheStore } from './storage.js';

export class CacheManager {
  constructor(
    private readonly config: AppConfig,
    private readonly store: XCacheStore
  ) {}

  safePath(relativeOrAbsolute: string): string {
    const resolved = path.resolve(this.config.cacheDir, relativeOrAbsolute);
    const root = path.resolve(this.config.cacheDir);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('refusing path outside CACHE_DIR');
    }
    return resolved;
  }

  async evictIfNeeded(): Promise<void> {
    const entries = this.store.listCacheEntries();
    const stat = fs.statfsSync(this.config.cacheDir);
    const free = Number(stat.bavail) * Number(stat.bsize);
    const plan = selectEvictionCandidates(entries, this.config.cacheMaxBytes, this.config.cacheMinFreeBytes, free);
    for (const id of plan.deleteIds) {
      const entry = this.store.findById(id);
      if (!entry?.path) continue;
      const filePath = this.safePath(entry.path);
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      this.store.remove(id);
    }
  }
}
