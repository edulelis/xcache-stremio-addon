import { describe, expect, it } from 'vitest';
import { buildLivePlaylist, buildStatusSnapshot, formatStatusLines } from './status-video.js';

describe('status video', () => {
  it('builds a sliding live HLS playlist', () => {
    const playlist = buildLivePlaylist({
      baseUrl: 'https://xcache.example.com/token',
      jobId: 'abc123',
      nowMs: 80_000,
      segmentSeconds: 8,
      playlistWindow: 4
    });

    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-TARGETDURATION:8');
    expect(playlist).toContain('#EXT-X-MEDIA-SEQUENCE:7');
    expect(playlist.match(/#EXTINF:8\.000,/g)).toHaveLength(4);
    expect(playlist).toContain('https://xcache.example.com/token/play/status/abc123/segment/10.ts');
  });

  it('formats live download status without requiring every qBittorrent field', () => {
    const snapshot = buildStatusSnapshot(
      {
        id: 'job',
        torrentName: 'Jurassic.World.2025.1080p.DUAL',
        source: 'Comando',
        sizeBytes: 0,
        status: 'downloading'
      },
      {
        hash: 'a'.repeat(40),
        name: 'Jurassic.World.2025.1080p.DUAL',
        progress: 0.423,
        dlspeed: 3 * 1024 * 1024,
        numSeeds: 18,
        eta: 620,
        state: 'downloading',
        size: 10 * 1024 ** 3
      },
      { readyThreshold: 0.98 }
    );

    expect(snapshot.ready).toBe(false);
    expect(formatStatusLines(snapshot)).toEqual([
      'XCACHE',
      'Downloading 42%',
      '3.0 MB/s | 18 seeds | ETA 10m',
      'Comando | 1080p | downloading',
      'Jurassic.World.2025.1080p.DUAL',
      'Download continues in the background.'
    ]);
  });

  it('formats completed status when the local file is ready', () => {
    const snapshot = buildStatusSnapshot(
      {
        id: 'job',
        torrentName: 'Movie.2025.720p',
        source: 'Torrentio',
        sizeBytes: 0,
        status: 'downloading'
      },
      undefined,
      { readyThreshold: 0.98, ready: true }
    );

    expect(formatStatusLines(snapshot)).toContain('Download complete');
    expect(formatStatusLines(snapshot)).toContain('Go back and play this stream again.');
  });

  it('adds activity dots to live downloading segments', () => {
    const snapshot = buildStatusSnapshot(
      {
        id: 'job',
        torrentName: 'Movie.2025.1080p',
        source: 'Torrentio',
        sizeBytes: 0,
        status: 'downloading'
      },
      {
        hash: 'a'.repeat(40),
        name: 'Movie.2025.1080p',
        progress: 0.12,
        dlspeed: 1024,
        numSeeds: 3,
        eta: 120,
        state: 'downloading',
        size: 1024 ** 3
      },
      { readyThreshold: 0.98 }
    );

    expect(formatStatusLines(snapshot, 0)[1]).toBe('Downloading 12% .');
    expect(formatStatusLines(snapshot, 1)[1]).toBe('Downloading 12% ..');
    expect(formatStatusLines(snapshot, 2)[1]).toBe('Downloading 12% ...');
    expect(formatStatusLines(snapshot, 3)[1]).toBe('Downloading 12% .');
  });
});
