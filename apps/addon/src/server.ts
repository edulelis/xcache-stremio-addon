import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMediaId, torrentReference, videoExtensionFromPath, type MediaType, type RankedCandidate } from '@xcache/core';
import { QbittorrentClient } from './clients/qbittorrent.js';
import { RealDebridClient } from './clients/real-debrid.js';
import { loadConfig, type AppConfig } from './env.js';
import { sendFileWithRange } from './http/range.js';
import { CacheManager } from './cache-manager.js';
import { StremioSourceScraper } from './scraper.js';
import { decodeSignedPayload, encodeSignedPayload } from './signed-payload.js';
import { createInstallToken, isValidInstallToken } from './token.js';
import { XCacheStore, type StoredJob } from './storage.js';
import { candidateStreamTitle, localStreamName, streamName } from './stream-format.js';
import { buildLivePlaylist, buildStatusSnapshot, isFfmpegAvailable, renderStatusSegment } from './status-video.js';

interface Runtime {
  config: AppConfig;
  store: XCacheStore;
  cache: CacheManager;
  qbit: QbittorrentClient;
  rd?: RealDebridClient;
  rdAvailabilityCache: Map<string, CachedAvailability>;
  rdAvailabilityInflight: Set<string>;
  scraper: StremioSourceScraper;
}

interface CachedAvailability {
  value: boolean;
  expiresAt: number;
}

interface PlayPayload {
  type: MediaType;
  id: string;
  candidate: RankedCandidate;
}

const downloadingPlaceholderPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/downloading.mp4');

const config = loadConfig();
fs.mkdirSync(config.cacheDir, { recursive: true });
const store = await XCacheStore.open(config.cacheDbPath);
const runtime: Runtime = {
  config,
  store,
  cache: new CacheManager(config, store),
  qbit: new QbittorrentClient(config.qbittorrentUrl, config.qbittorrentUser, config.qbittorrentPass),
  rd: config.realDebridApiToken ? new RealDebridClient(config.realDebridApiToken) : undefined,
  rdAvailabilityCache: new Map(),
  rdAvailabilityInflight: new Set(),
  scraper: new StremioSourceScraper(config.scraperStreamUrls, config.filterOptions)
};

if (config.startupEviction) {
  runtime.cache.evictIfNeeded().catch((error) => console.warn('[xcache] startup eviction failed', error));
}

http.createServer((req, res) => {
  void handleRequest(runtime, req, res).catch((error) => {
    console.error('[xcache] request failed', error);
    sendJson(res, 500, { error: 'internal_error', message: error.message });
  });
}).listen(config.port, () => {
  console.log(`[xcache] listening on ${config.port}`);
  console.log(`[xcache] install token: run "npm run print-token" instead of exposing secrets in logs`);
});

async function handleRequest(runtime: Runtime, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = stripBasePath(url.pathname, runtime.config.basePath);
  if (pathname === null) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  if (pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const parts = pathname.split('/').filter(Boolean);
  const token = parts[0] || '';
  if (!isValidInstallToken(token, runtime.config.installTokenSecret)) {
    sendJson(res, 403, { error: 'invalid_install_token' });
    return;
  }

  if (parts[1] === 'manifest.json') {
    sendJson(res, 200, manifest(runtime.config, token));
    return;
  }

  if (parts[1] === 'stream' && parts.length >= 4) {
    await handleStream(runtime, token, parts[2] as MediaType, stripJsonSuffix(decodeURIComponent(parts.slice(3).join('/'))), res);
    return;
  }

  if (parts[1] === 'play' && parts[2] === 'local' && parts[3]) {
    await handleLocal(runtime, req, res, parts[3]);
    return;
  }

  if (parts[1] === 'play' && parts[2] === 'candidate' && parts[3]) {
    await handleCandidate(runtime, req, res, token, parts[3]);
    return;
  }

  if (parts[1] === 'play' && parts[2] === 'status' && parts[3] && parts[4] === 'live.m3u8') {
    await handleStatusPlaylist(runtime, token, req, res, parts[3]);
    return;
  }

  if (parts[1] === 'play' && parts[2] === 'status' && parts[3] && parts[4] === 'segment' && parts[5]) {
    await handleStatusSegment(runtime, req, res, parts[3], stripTsSuffix(parts[5]));
    return;
  }

  if (parts[1] === 'play' && parts[2] === 'status' && parts[3] && parts[4] === 'fallback.mp4') {
    sendDownloadingPlaceholder(req, res);
    return;
  }

  if (parts[1] === 'api' && parts[2] === 'status') {
    sendJson(res, 200, { ok: true, token: createInstallToken(runtime.config.installTokenSecret) });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function handleStream(runtime: Runtime, token: string, type: MediaType, id: string, res: http.ServerResponse): Promise<void> {
  const parsed = parseMediaId(type, id);
  const streams = [];
  const local = runtime.store.findReady(type, parsed.id, parsed.season, parsed.episode);
  if (local) {
    const fileName = path.basename(local.path);
    streams.push({
      name: localStreamName(fileName, local.torrentName),
      title: fileName,
      url: `${runtime.config.publicBaseUrl}/${token}/play/local/${encodeURIComponent(local.id)}`
    });
  }

  const candidates = runtime.config.scraperStreamUrls.length
    ? await runtime.scraper.search(type, id)
    : [];

  const visibleCandidates = candidates.slice(0, runtime.config.streamLimit);
  const rdCachedByHash = await rdCachedMap(runtime, visibleCandidates);
  for (const candidate of visibleCandidates) {
    const rdCached = candidate.infoHash ? rdCachedByHash.get(candidate.infoHash.toLowerCase()) === true : false;
    const payload = encodeSignedPayload({ type, id, candidate: { ...candidate, isCachedRd: rdCached } }, runtime.config.installTokenSecret);
    streams.push({
      name: streamName(candidate.resolution, rdCached),
      title: candidateStreamTitle(candidate),
      url: `${runtime.config.publicBaseUrl}/${token}/play/candidate/${payload}`
    });
  }

  sendJson(res, 200, { streams });
}

async function handleLocal(runtime: Runtime, req: http.IncomingMessage, res: http.ServerResponse, jobId: string): Promise<void> {
  const job = runtime.store.findById(jobId);
  if (!job?.path || job.status !== 'ready') {
    sendJson(res, 404, { error: 'local_stream_not_found' });
    return;
  }
  const filePath = await findDownloadedVideoPath(runtime, job.infoHash, job.path);
  if (!filePath) {
    runtime.store.upsert({ ...job, status: 'downloading', lastAccessedAt: Date.now() });
    sendDownloadingPlaceholder(req, res);
    return;
  }
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'local_file_missing' });
    return;
  }
  runtime.store.touch(job.id);
  sendFileWithRange(req, res, filePath);
}

async function handleCandidate(
  runtime: Runtime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  installToken: string,
  signedPayload: string
): Promise<void> {
  const payload = decodeSignedPayload<PlayPayload>(signedPayload, runtime.config.installTokenSecret);
  const candidate = payload.candidate;
  const magnetOrUrl = torrentReference(candidate);
  if (!magnetOrUrl) {
    sendJson(res, 422, { error: 'candidate_has_no_torrent_reference' });
    return;
  }

  if (runtime.rd && runtime.config.rdMode !== 'off' && candidate.isCachedRd && runtime.config.rdMode !== 'local_first') {
    if (runtime.config.rdMode === 'rd_plus_local') {
      startLocalDownload(runtime, payload).catch((error) => console.warn('[xcache] background local download failed', error));
    }
    try {
      const rdUrl = await resolveRd(runtime.rd, magnetOrUrl);
      redirect(res, rdUrl);
      return;
    } catch (error) {
      console.warn('[xcache] RD failed, falling back to local', error);
    }
  }

  const job = await startLocalDownload(runtime, payload);
  const filePath = await waitForPlayableFile(runtime, candidate.infoHash, job.path);
  if (!filePath) {
    await sendStatusPlayback(runtime, req, res, installToken, job);
    return;
  }

  const readyJob: StoredJob = {
    ...job,
    status: 'ready',
    path: path.relative(runtime.config.cacheDir, filePath),
    sizeBytes: fs.statSync(filePath).size,
    lastAccessedAt: Date.now()
  };
  runtime.store.upsert(readyJob);
  sendFileWithRange(req, res, filePath);
}

async function startLocalDownload(runtime: Runtime, payload: PlayPayload): Promise<StoredJob> {
  const candidate = payload.candidate;
  const parsed = parseMediaId(payload.type, payload.id);
  const magnetOrUrl = torrentReference(candidate);
  if (!magnetOrUrl) throw new Error('candidate has no torrent reference');

  await runtime.qbit.addTorrent({
    magnetOrUrl,
    savePath: runtime.config.cacheDir,
    category: 'xcache'
  });

  const now = Date.now();
  const job: StoredJob = {
    id: stableJobId(payload.type, parsed.id, candidate.infoHash || magnetOrUrl),
    mediaType: payload.type,
    mediaId: parsed.id,
    season: parsed.season,
    episode: parsed.episode,
    infoHash: candidate.infoHash,
    torrentName: candidate.name,
    source: candidate.provider || candidate.source,
    path: '',
    sizeBytes: candidate.sizeBytes || 0,
    status: 'downloading',
    createdAt: now,
    lastAccessedAt: now,
    active: true
  };
  runtime.store.upsert(job);
  return job;
}

async function waitForPlayableFile(runtime: Runtime, infoHash: string | undefined, fallbackPath: string): Promise<string | undefined> {
  const deadline = Date.now() + runtime.config.playableWaitMs;
  while (Date.now() < deadline) {
    const filePath = await findDownloadedVideoPath(runtime, infoHash, fallbackPath);
    if (filePath) return filePath;
    await sleep(1500);
  }
  return undefined;
}

async function findDownloadedVideoPath(
  runtime: Runtime,
  infoHash: string | undefined,
  fallbackPath: string
): Promise<string | undefined> {
  if (infoHash) {
    const files = await runtime.qbit.listFiles(infoHash).catch(() => undefined);
    const selected = files
      ?.filter((file) => videoExtensionFromPath(file.name))
      .sort((left, right) => right.size - left.size)[0];

    if (selected) {
      if (selected.progress < runtime.config.localReadyMinProgress) return undefined;
      const filePath = runtime.cache.safePath(selected.name);
      if (fs.existsSync(filePath)) return filePath;
      return undefined;
    }
  }

  if (!fallbackPath) return undefined;
  const filePath = runtime.cache.safePath(fallbackPath);
  return fs.existsSync(filePath) ? filePath : undefined;
}

async function sendStatusPlayback(
  runtime: Runtime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  installToken: string,
  job: StoredJob
): Promise<void> {
  if (runtime.config.statusVideoMode !== 'live_hls' || !job.infoHash) {
    sendDownloadingPlaceholder(req, res);
    return;
  }

  redirect(res, `${runtime.config.publicBaseUrl}/${installToken}/play/status/${encodeURIComponent(job.id)}/live.m3u8`);
}

async function handleStatusPlaylist(
  runtime: Runtime,
  token: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  jobId: string
): Promise<void> {
  const job = runtime.store.findById(jobId);
  if (runtime.config.statusVideoMode !== 'live_hls' || !job?.infoHash) {
    sendDownloadingPlaceholder(req, res);
    return;
  }

  const [torrentStatus, ffmpegAvailable] = await Promise.all([
    runtime.qbit.getTorrentStatus(job.infoHash).catch(() => undefined),
    isFfmpegAvailable(runtime.config.statusFfmpegPath)
  ]);
  if (!torrentStatus || !ffmpegAvailable) {
    sendDownloadingPlaceholder(req, res);
    return;
  }

  const playlist = buildLivePlaylist({
    baseUrl: `${runtime.config.publicBaseUrl}/${token}`,
    jobId: job.id,
    nowMs: Date.now(),
    segmentSeconds: runtime.config.statusSegmentSeconds,
    playlistWindow: runtime.config.statusPlaylistWindow
  });
  sendText(res, 200, 'application/vnd.apple.mpegurl; charset=utf-8', playlist, 'no-store');
}

async function handleStatusSegment(
  runtime: Runtime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  jobId: string,
  segmentId: string
): Promise<void> {
  const parsedSegmentId = Number(segmentId);
  const job = runtime.store.findById(jobId);
  if (
    runtime.config.statusVideoMode !== 'live_hls' ||
    !job ||
    !Number.isInteger(parsedSegmentId) ||
    parsedSegmentId < 0
  ) {
    sendDownloadingPlaceholder(req, res);
    return;
  }

  try {
    const [torrentStatus, readyFilePath] = await Promise.all([
      job.infoHash ? runtime.qbit.getTorrentStatus(job.infoHash) : Promise.resolve(undefined),
      findDownloadedVideoPath(runtime, job.infoHash, job.path)
    ]);
    if (!torrentStatus && !readyFilePath) {
      sendDownloadingPlaceholder(req, res);
      return;
    }
    const effectiveJob = readyFilePath ? markJobReady(runtime, job, readyFilePath) : job;
    const snapshot = buildStatusSnapshot(effectiveJob, torrentStatus, {
      readyThreshold: runtime.config.localReadyMinProgress,
      ready: Boolean(readyFilePath)
    });
    const segmentPath = await renderStatusSegment(snapshot, {
      segmentId: parsedSegmentId,
      segmentSeconds: runtime.config.statusSegmentSeconds,
      cacheDir: runtime.config.statusSegmentCacheDir,
      cacheTtlMs: runtime.config.statusSegmentCacheTtlMs,
      ffmpegPath: runtime.config.statusFfmpegPath,
      fontFile: runtime.config.statusFontFile
    });
    res.setHeader('Cache-Control', 'no-store');
    sendFileWithRange(req, res, segmentPath);
  } catch (error) {
    console.warn('[xcache] status segment failed, falling back to mp4', error);
    sendDownloadingPlaceholder(req, res);
  }
}

function markJobReady(runtime: Runtime, job: StoredJob, filePath: string): StoredJob {
  const readyJob: StoredJob = {
    ...job,
    status: 'ready',
    path: path.relative(runtime.config.cacheDir, filePath),
    sizeBytes: fs.statSync(filePath).size,
    lastAccessedAt: Date.now()
  };
  runtime.store.upsert(readyJob);
  return readyJob;
}

async function rdCachedMap(runtime: Runtime, candidates: RankedCandidate[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (!runtime.rd || runtime.config.rdMode === 'off' || runtime.config.rdMode === 'local_first') return result;

  const now = Date.now();
  const hashes = [...new Set(candidates
    .map((candidate) => candidate.infoHash?.toLowerCase())
    .filter(isString))];
  const missing: string[] = [];

  for (const hash of hashes) {
    const cached = runtime.rdAvailabilityCache.get(hash);
    if (cached && cached.expiresAt > now) {
      result.set(hash, cached.value);
    } else {
      runtime.rdAvailabilityCache.delete(hash);
      missing.push(hash);
    }
  }

  if (missing.length) {
    if (runtime.config.rdAvailabilityBlocking) {
      await refreshRdAvailability(runtime, missing);
      for (const hash of missing) result.set(hash, runtime.rdAvailabilityCache.get(hash)?.value === true);
    } else {
      for (const hash of missing) result.set(hash, false);
      void refreshRdAvailability(runtime, missing);
    }
  }

  return result;
}

async function refreshRdAvailability(runtime: Runtime, hashes: string[]): Promise<void> {
  if (!runtime.rd) return;
  const missing = hashes.filter((hash) => !runtime.rdAvailabilityInflight.has(hash));
  if (!missing.length) return;
  for (const hash of missing) runtime.rdAvailabilityInflight.add(hash);

  try {
    const available = await runtime.rd.instantAvailability(missing);
    const expiresAt = Date.now() + runtime.config.rdAvailabilityCacheTtlMs;
    for (const hash of missing) {
      if (runtime.config.rdAvailabilityCacheTtlMs > 0) {
        runtime.rdAvailabilityCache.set(hash, { value: available.has(hash), expiresAt });
      }
    }
  } catch (error) {
    console.warn('[xcache] RD availability check failed', error);
    const expiresAt = Date.now() + Math.min(runtime.config.rdAvailabilityCacheTtlMs, 60_000);
    for (const hash of missing) {
      if (runtime.config.rdAvailabilityCacheTtlMs > 0) {
        runtime.rdAvailabilityCache.set(hash, { value: false, expiresAt });
      }
    }
  } finally {
    for (const hash of missing) runtime.rdAvailabilityInflight.delete(hash);
  }
}

async function resolveRd(rd: RealDebridClient, magnetOrUrl: string): Promise<string> {
  const torrentId = await rd.addMagnet(magnetOrUrl);
  await rd.selectFiles(torrentId, 'all');
  const info = await rd.torrentInfo(torrentId);
  if (!info.links[0]) throw new Error('Real-Debrid returned no torrent links');
  return await rd.unrestrict(info.links[0]);
}

function manifest(config: AppConfig, token: string): Record<string, unknown> {
  return {
    id: 'community.xcache.selfhost',
    version: '0.1.0',
    name: 'XCACHE',
    description: 'Self-hosted Stremio cache addon with local qBittorrent and optional Real-Debrid acceleration.',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    },
    config: [{ key: 'manifestUrl', type: 'text', default: `${config.publicBaseUrl}/${token}/manifest.json` }]
  };
}

function stableJobId(type: MediaType, mediaId: string, key: string): string {
  return crypto.createHash('sha256').update(`${type}:${mediaId}:${key}`).digest('hex').slice(0, 32);
}

function redirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendDownloadingPlaceholder(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!fs.existsSync(downloadingPlaceholderPath)) {
    sendJson(res, 425, {
      error: 'buffering',
      message: 'Torrent was added to qBittorrent, but no playable file is ready yet. Try this stream again shortly.'
    });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  sendFileWithRange(req, res, downloadingPlaceholderPath);
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(
  res: http.ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
  cacheControl?: string
): void {
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
}

function setCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

function stripJsonSuffix(value: string): string {
  return value.endsWith('.json') ? value.slice(0, -5) : value;
}

function stripTsSuffix(value: string): string {
  return value.endsWith('.ts') ? value.slice(0, -3) : value;
}

function stripBasePath(pathname: string, basePath: string): string | null {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (!pathname.startsWith(`${basePath}/`)) return null;
  return pathname.slice(basePath.length) || '/';
}
