import { describe, expect, it } from 'vitest';
import { candidateStreamTitle, cleanStreamTitle, localStreamName, streamName } from './stream-format.js';
import type { RankedCandidate } from '@xcache/core';

describe('stream formatting', () => {
  it('formats cached and uncached stream names like Comet', () => {
    expect(streamName('1080p', true)).toBe('[⚡]\nXCACHE\n1080p');
    expect(streamName('720p', false)).toBe('[⬇️]\nXCACHE\n720p');
  });

  it('uses the lightning marker only for local cache names', () => {
    expect(localStreamName('Jurassic.World.Rebirth.2025.1080p.mkv')).toBe('[⚡]\nXCACHE\n1080p');
  });

  it('removes old XCACHE explanatory lines from stream titles', () => {
    expect(cleanStreamTitle('Movie.2025.1080p\n🧲 qBittorrent\nTorrentio • 1080p • pt-BR • 30 seeders')).toBe(
      'Movie.2025.1080p'
    );
    expect(cleanStreamTitle('Movie.2025.1080p\n💾 Local cache\nBaixar')).toBe('Movie.2025.1080p');
  });

  it('keeps the upstream title as the visible stream details', () => {
    expect(candidateStreamTitle(candidate({ title: '📄 Movie.2025.1080p\n⭐ WEB-DL | 🏷️ SF' }))).toBe(
      '📄 Movie.2025.1080p\n⭐ WEB-DL | 🏷️ SF'
    );
  });
});

function candidate(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
  return {
    source: 'Torrentio',
    name: 'Movie.2025.1080p',
    title: 'Movie.2025.1080p',
    rank: 1,
    infoHash: 'a'.repeat(40),
    resolution: '1080p',
    languages: ['pt-BR'],
    isDownloadable: true,
    ...overrides
  };
}
