import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

describe('RealDebridClient contract', () => {
  it('documents the mocked API shape used by the adapter', async () => {
    const baseUrl = await startServer((req, res) => {
      expect(req.headers.authorization).toBe('Bearer token');
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/rest/1.0/torrents/instantAvailability/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
        res.end(JSON.stringify({ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: { rd: [{ filename: 'movie.mkv' }] } }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'missing' }));
    });

    const { RealDebridClient } = await import('./real-debrid.js');
    const client = new RealDebridClient('token', `${baseUrl}/rest/1.0`);
    await expect(client.isInstantAvailable('a'.repeat(40))).resolves.toBe(true);
  });

  it('checks instant availability in batches', async () => {
    const first = 'a'.repeat(40);
    const second = 'b'.repeat(40);
    const baseUrl = await startServer((req, res) => {
      expect(req.headers.authorization).toBe('Bearer token');
      res.setHeader('Content-Type', 'application/json');
      if (req.url === `/rest/1.0/torrents/instantAvailability/${first}/${second}`) {
        res.end(JSON.stringify({
          [first]: { rd: [{ filename: 'cached.mkv' }] },
          [second]: {}
        }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'missing' }));
    });

    const { RealDebridClient } = await import('./real-debrid.js');
    const client = new RealDebridClient('token', `${baseUrl}/rest/1.0`);
    await expect(client.instantAvailability([first, second])).resolves.toEqual(new Set([first]));
  });
});

async function startServer(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}
