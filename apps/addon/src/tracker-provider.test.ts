import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTrackerList, TrackerProvider } from './tracker-provider.js';

let server: http.Server | undefined;
let requestCount = 0;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
  server = undefined;
  requestCount = 0;
});

describe('TrackerProvider', () => {
  it('parses, deduplicates, validates and limits tracker lists', () => {
    expect(parseTrackerList(`
      # comment
      udp://tracker.example.com:6969/announce
      https://tracker.example.org/announce
      udp://tracker.example.com:6969/announce
      magnet:?xt=urn:btih:bad
      wss://tracker.example.net
      http://tracker.example.net/announce
    `, 2)).toEqual([
      'udp://tracker.example.com:6969/announce',
      'https://tracker.example.org/announce'
    ]);
  });

  it('fetches remote trackers and caches them', async () => {
    const baseUrl = await serve((_req, res) => {
      requestCount += 1;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('udp://tracker.remote.example:6969/announce\nhttps://tracker.remote.example/announce\n');
    });
    const provider = new TrackerProvider({
      enabled: true,
      listUrl: `${baseUrl}/trackers.txt`,
      extraTrackers: ['udp://tracker.extra.example:6969/announce'],
      maxTrackers: 5,
      refreshMs: 60_000,
      timeoutMs: 1000
    });

    await expect(provider.getTrackers()).resolves.toEqual([
      'udp://tracker.remote.example:6969/announce',
      'https://tracker.remote.example/announce',
      'udp://tracker.extra.example:6969/announce'
    ]);
    await provider.getTrackers();
    expect(requestCount).toBe(1);
  });

  it('falls back to extra trackers when the remote list fails', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(500);
      res.end('failed');
    });
    const provider = new TrackerProvider({
      enabled: true,
      listUrl: `${baseUrl}/trackers.txt`,
      extraTrackers: ['udp://tracker.extra.example:6969/announce'],
      maxTrackers: 5,
      refreshMs: 60_000,
      timeoutMs: 1000
    });

    await expect(provider.getTrackers()).resolves.toEqual(['udp://tracker.extra.example:6969/announce']);
  });

  it('returns no trackers when disabled', async () => {
    const provider = new TrackerProvider({
      enabled: false,
      extraTrackers: ['udp://tracker.extra.example:6969/announce'],
      maxTrackers: 5,
      refreshMs: 60_000,
      timeoutMs: 1000
    });

    await expect(provider.getTrackers()).resolves.toEqual([]);
  });
});

async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
