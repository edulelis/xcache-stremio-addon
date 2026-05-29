import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMediaId } from '@xcache/core';
import { TmdbIdResolver } from './tmdb-id-resolver.js';

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

describe('TmdbIdResolver', () => {
  it('resolves movie tmdb ids to imdb ids', async () => {
    const baseUrl = await serve((_req, res) => {
      requestCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ imdb_id: 'tt0375611' }));
    });
    const resolver = new TmdbIdResolver({ apiKey: 'test-key', baseUrl, timeoutMs: 1000, cacheTtlMs: 60_000 });

    await expect(resolver.resolveStreamId('movie', parseMediaId('movie', 'tmdb:31977'))).resolves.toBe('tt0375611');
    await expect(resolver.resolveStreamId('movie', parseMediaId('movie', 'tmdb:31977'))).resolves.toBe('tt0375611');
    expect(requestCount).toBe(1);
  });

  it('preserves series episode suffixes', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ imdb_id: 'tt1234567' }));
    });
    const resolver = new TmdbIdResolver({ apiKey: 'test-key', baseUrl, timeoutMs: 1000, cacheTtlMs: 0 });

    await expect(resolver.resolveStreamId('series', parseMediaId('series', 'tmdb:123:4:5'))).resolves.toBe('tt1234567:4:5');
  });

  it('does not resolve when no TMDB credential is configured', async () => {
    const resolver = new TmdbIdResolver({ timeoutMs: 1000, cacheTtlMs: 0 });

    await expect(resolver.resolveStreamId('movie', parseMediaId('movie', 'tmdb:31977'))).resolves.toBeUndefined();
  });
});

async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
