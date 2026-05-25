import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sendFileWithRange } from './range.js';

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

describe('sendFileWithRange', () => {
  it('serves byte ranges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xcache-range-'));
    const file = path.join(dir, 'video.mkv');
    fs.writeFileSync(file, '0123456789');
    const baseUrl = await startServer((req, res) => sendFileWithRange(req, res, file));

    const response = await fetch(baseUrl, { headers: { Range: 'bytes=2-5' } });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('2345');
  });

  it('serves HEAD metadata without a response body', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xcache-range-'));
    const file = path.join(dir, 'video.mp4');
    fs.writeFileSync(file, '0123456789');
    const baseUrl = await startServer((req, res) => sendFileWithRange(req, res, file));

    const response = await fetch(baseUrl, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('10');
    expect(await response.text()).toBe('');
  });
});

async function startServer(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}
