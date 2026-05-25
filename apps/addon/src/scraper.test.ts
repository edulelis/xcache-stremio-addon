import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { FilterOptions } from '@xcache/core';
import { StremioSourceScraper } from './scraper.js';

const options: FilterOptions = {
  allowedResolutions: ['1080p', '720p'],
  preferredLanguages: ['pt-BR', 'pt', 'en'],
  preferredProviders: ['Comando'],
  blockedProviders: ['Cinecalidad'],
  allowSpanishNative: false
};

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => error ? reject(error) : resolve());
  });
  server = undefined;
});

describe('StremioSourceScraper', () => {
  it('normalizes streams from a Stremio source', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        streams: [{
          name: '[TORRENT] Comando 1080p',
          title: 'Movie.2025.1080p.WEB-DL.DUAL-SF\n👤 12 💾 3.1 GB 🔎 Torrentio|Comando\n🇧🇷',
          infoHash: 'a'.repeat(40),
          behaviorHints: { filename: 'Movie.2025.1080p.WEB-DL.DUAL-SF.mkv', videoSize: 1024 }
        }]
      }));
    });

    const scraper = new StremioSourceScraper([`${baseUrl}/stream/{type}/{id}.json`], options, 1000);

    const results = await scraper.search('movie', 'tmdb:1');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      provider: 'Comando',
      resolution: '1080p',
      languages: ['pt-BR']
    });
  });

  it('drops a slow source instead of blocking forever', async () => {
    const baseUrl = await serve(async (_req, res) => {
      await sleep(100);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ streams: [] }));
    });

    const scraper = new StremioSourceScraper([`${baseUrl}/stream/{type}/{id}.json`], options, 20);

    await expect(scraper.search('movie', 'tmdb:1')).resolves.toEqual([]);
  });
});

async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
