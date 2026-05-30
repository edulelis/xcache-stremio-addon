import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { QbittorrentClient } from './qbittorrent.js';

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

describe('QbittorrentClient', () => {
  it('logs in and adds torrents with sequential flags', async () => {
    const requests: { url: string; body: string }[] = [];
    const baseUrl = await startServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ url: req.url || '', body });

      if (req.url === '/api/v2/auth/login') {
        res.setHeader('Set-Cookie', 'SID=ok; HttpOnly');
        res.end('Ok.');
        return;
      }
      if (req.url === '/api/v2/torrents/add') {
        expect(req.headers.cookie).toBe('SID=ok');
        res.end('Ok.');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new QbittorrentClient(baseUrl, 'user', 'pass');
    await client.addTorrent({ magnetOrUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), savePath: '/cache' });

    const addRequest = requests.find((request) => request.url === '/api/v2/torrents/add');
    expect(addRequest?.body).toContain('sequentialDownload');
    expect(addRequest?.body).toContain('firstLastPiecePrio');
  });

  it('treats already-added torrent responses as success', async () => {
    const baseUrl = await startServer(async (req, res) => {
      if (req.url === '/api/v2/auth/login') {
        res.setHeader('Set-Cookie', 'SID=ok; HttpOnly');
        res.end('Ok.');
        return;
      }
      if (req.url === '/api/v2/torrents/add') {
        res.writeHead(409);
        res.end('Torrent already exists');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new QbittorrentClient(baseUrl, 'user', 'pass');
    await expect(client.addTorrent({ magnetOrUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), savePath: '/cache' }))
      .resolves.toBeUndefined();
  });

  it('adds trackers to an existing torrent hash', async () => {
    const requests: { url: string; body: string }[] = [];
    const hash = 'c'.repeat(40);
    const baseUrl = await startServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ url: req.url || '', body });

      if (req.url === '/api/v2/auth/login') {
        res.setHeader('Set-Cookie', 'SID=ok; HttpOnly');
        res.end('Ok.');
        return;
      }
      if (req.url === '/api/v2/torrents/addTrackers') {
        expect(req.headers.cookie).toBe('SID=ok');
        res.end('Ok.');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new QbittorrentClient(baseUrl, 'user', 'pass');
    await client.addTrackers(hash, [
      'udp://tracker.example.com:6969/announce',
      'https://tracker.example.org/announce'
    ]);

    const addTrackersRequest = requests.find((request) => request.url === '/api/v2/torrents/addTrackers');
    expect(addTrackersRequest?.body).toContain(`hash=${hash}`);
    expect(decodeURIComponent(addTrackersRequest?.body || '')).toContain('udp://tracker.example.com:6969/announce\nhttps://tracker.example.org/announce');
  });

  it('reads torrent status for live playback screens', async () => {
    const hash = 'b'.repeat(40);
    const baseUrl = await startServer(async (req, res) => {
      if (req.url === '/api/v2/auth/login') {
        res.setHeader('Set-Cookie', 'SID=ok; HttpOnly');
        res.end('Ok.');
        return;
      }
      if (req.url === `/api/v2/torrents/info?hashes=${hash}`) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([{
          hash,
          name: 'Movie.2025.1080p.DUAL',
          progress: 0.42,
          dlspeed: 3145728,
          num_seeds: 18,
          eta: 600,
          state: 'downloading',
          size: 10737418240
        }]));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new QbittorrentClient(baseUrl, 'user', 'pass');
    await expect(client.getTorrentStatus(hash)).resolves.toEqual({
      hash,
      name: 'Movie.2025.1080p.DUAL',
      progress: 0.42,
      dlspeed: 3145728,
      numSeeds: 18,
      eta: 600,
      state: 'downloading',
      size: 10737418240
    });
  });
});

async function startServer(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}
