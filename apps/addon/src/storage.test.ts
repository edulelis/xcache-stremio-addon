import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { RankedCandidate } from '@xcache/core';
import { XCacheStore } from './storage.js';

const dbPaths: string[] = [];

afterEach(() => {
  for (const dbPath of dbPaths.splice(0)) {
    fs.rmSync(dbPath, { force: true });
  }
});

describe('XCacheStore stream candidate cache', () => {
  it('persists non-expired stream candidates', async () => {
    const dbPath = tempDbPath();
    const store = await XCacheStore.open(dbPath);
    const candidates = [candidate('Movie.2025.1080p.DUAL')];
    const expiresAt = Date.now() + 60_000;

    store.upsertStreamCandidates('movie:tmdb:1', candidates, expiresAt);

    expect(store.findStreamCandidates('movie:tmdb:1')).toEqual({ candidates, expiresAt });
  });

  it('drops expired stream candidates', async () => {
    const dbPath = tempDbPath();
    const store = await XCacheStore.open(dbPath);

    store.upsertStreamCandidates('movie:tmdb:1', [candidate('old')], Date.now() - 1);

    expect(store.findStreamCandidates('movie:tmdb:1')).toBeUndefined();
  });

  it('persists short playback intents', async () => {
    const dbPath = tempDbPath();
    const store = await XCacheStore.open(dbPath);
    const payload = { type: 'movie', id: 'tmdb:1', candidate: candidate('Movie.2025.1080p.DUAL') };
    const expiresAt = Date.now() + 60_000;

    store.upsertPlayIntent('intent1', payload, expiresAt);

    expect(store.findPlayIntent('intent1')).toEqual({ payload, expiresAt });
  });

  it('finds active downloads and deletes stream candidates', async () => {
    const dbPath = tempDbPath();
    const store = await XCacheStore.open(dbPath);
    const now = Date.now();
    store.upsert({
      id: 'job1',
      mediaType: 'movie',
      mediaId: 'tt1234567',
      path: '',
      sizeBytes: 0,
      status: 'downloading',
      lastAccessedAt: now,
      createdAt: now,
      active: true
    });
    store.upsertStreamCandidates('movie:tt1234567', [candidate('cached')], now + 60_000);

    expect(store.findActiveDownloads('movie', 'tt1234567')).toHaveLength(1);
    store.deleteStreamCandidates('movie:tt1234567');
    expect(store.findStreamCandidates('movie:tt1234567')).toBeUndefined();
  });
});

function tempDbPath(): string {
  const dbPath = path.join(os.tmpdir(), `xcache-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  return dbPath;
}

function candidate(name: string): RankedCandidate {
  return {
    source: 'test',
    name,
    title: name,
    infoHash: 'a'.repeat(40),
    resolution: '1080p',
    languages: ['pt-BR'],
    isDownloadable: true,
    rank: 1
  };
}
