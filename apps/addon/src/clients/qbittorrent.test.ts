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
});

async function startServer(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}
