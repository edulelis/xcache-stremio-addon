import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMediaId, torrentReference, videoExtensionFromPath, type MediaType, type ParsedMediaId, type RankedCandidate } from '@xcache/core';
import { QbittorrentClient } from './clients/qbittorrent.js';
import { RealDebridClient } from './clients/real-debrid.js';
import { TmdbIdResolver } from './clients/tmdb-id-resolver.js';
import { loadConfig, type AppConfig } from './env.js';
import { sendFileWithRange } from './http/range.js';
import { ensurePreferredAudioDefault } from './audio-preference.js';
import { CacheManager } from './cache-manager.js';
import { StremioSourceScraper } from './scraper.js';
import { decodeSignedPayload } from './signed-payload.js';
import { createInstallToken, isValidInstallToken } from './token.js';
import { XCacheStore, type StoredJob } from './storage.js';
import { candidateStreamTitle, localStreamName, streamName } from './stream-format.js';
import { buildLivePlaylist, buildStatusSnapshot, isFfmpegAvailable, renderStatusSegment } from './status-video.js';
import { TrackerProvider } from './tracker-provider.js';
import { HlsTranscodeManager, probeMedia, shouldUseBrowserTranscode, waitForFile, type HlsSession } from './transcode.js';

interface Runtime {
  config: AppConfig;
  store: XCacheStore;
  cache: CacheManager;
  qbit: QbittorrentClient;
  rd?: RealDebridClient;
  rdAvailabilityCache: Map<string, CachedAvailability>;
  rdAvailabilityInflight: Set<string>;
  streamCandidateCache: Map<string, CachedCandidates>;
  streamCandidateInflight: Map<string, Promise<RankedCandidate[]>>;
  scraper: StremioSourceScraper;
  idResolver: TmdbIdResolver;
  trackers: TrackerProvider;
  transcodes: HlsTranscodeManager;
}

interface CachedAvailability {
  value: boolean;
  expiresAt: number;
}

interface CachedCandidates {
  candidates: RankedCandidate[];
  expiresAt: number;
}

interface PlayPayload {
  type: MediaType;
  id: string;
  candidate: RankedCandidate;
}

interface DownloadedVideo {
  path: string;
  progress?: number;
}

type ReadyLocalVideo =
  | { status: 'ready'; job: StoredJob; video: DownloadedVideo }
  | { status: 'not_found' }
  | { status: 'not_ready' }
  | { status: 'missing_file' };

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
  streamCandidateCache: new Map(),
  streamCandidateInflight: new Map(),
  scraper: new StremioSourceScraper(config.scraperStreamUrls, config.filterOptions, config.scraperTimeoutMs, config.scraperSettleMs),
  idResolver: new TmdbIdResolver({
    apiKey: config.tmdbApiKey,
    readAccessToken: config.tmdbReadAccessToken,
    baseUrl: config.tmdbApiBaseUrl,
    timeoutMs: config.tmdbResolverTimeoutMs,
    cacheTtlMs: config.tmdbIdCacheTtlMs
  }),
  trackers: new TrackerProvider({
    enabled: config.trackerInjectionEnabled,
    listUrl: config.trackerListUrl,
    extraTrackers: config.trackerExtraTrackers,
    maxTrackers: config.trackerMax,
    refreshMs: config.trackerRefreshMs,
    timeoutMs: config.trackerFetchTimeoutMs
  }),
  transcodes: new HlsTranscodeManager()
};

if (config.startupEviction) {
  runtime.cache.evictIfNeeded().catch((error) => console.warn('[xcache] startup eviction failed', error));
}
if (config.staleDownloadCleanupEnabled) {
  startStaleDownloadCleanup(runtime);
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

  if (parts[1] === 'play' && parts[2] === 'local' && parts[3] && parts[4] === 'transcode' && parts[5] === 'index.m3u8') {
    await handleLocalTranscodePlaylist(runtime, req, res, parts[3]);
    return;
  }

  if (parts[1] === 'play' && parts[2] === 'local' && parts[3] && parts[4] === 'transcode' && parts[5]) {
    await handleLocalTranscodeSegment(runtime, req, res, parts[3], parts[5]);
    return;
  }

  if (parts[1] === 'play' && parts[2] === 'local' && parts[3]) {
    await handleLocal(runtime, req, res, token, parts[3]);
    return;
  }

  if (parts[1] === 'play' && parts[2] === 'candidate' && parts[3]) {
    if (parts[4] === 'status.m3u8') {
      await handleCandidateStatusPlaylist(runtime, req, res, token, parts[3]);
    } else if (parts[4] === 'fallback.mp4') {
      await handleCandidateFallback(runtime, req, res, parts[3]);
    } else {
      await handleCandidate(runtime, req, res, token, parts[3]);
    }
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
  let scrapeId = parsed.id;
  let lookupIds = [parsed.id];
  const streams = [];
  await promoteCompletedJobsForAnyId(runtime, type, lookupIds, parsed.season, parsed.episode);
  let local = findReadyForAnyId(runtime, type, lookupIds, parsed.season, parsed.episode);
  if (!local) {
    scrapeId = await resolveScrapeId(runtime, type, parsed);
    lookupIds = uniqueStrings([parsed.id, scrapeId]);
    if (scrapeId !== parsed.id) {
      await promoteCompletedJobsForAnyId(runtime, type, lookupIds, parsed.season, parsed.episode);
      local = findReadyForAnyId(runtime, type, lookupIds, parsed.season, parsed.episode);
    }
  }
  let candidates = getCachedCandidatesForAnyId(runtime, type, lookupIds);
  if (local) {
    const fileName = path.basename(local.path);
    const localCandidate = local.infoHash
      ? candidates?.find((candidate) => candidate.infoHash?.toLowerCase() === local.infoHash?.toLowerCase())
      : undefined;
    const streamTitle = local.streamTitle || (localCandidate ? candidateStreamTitle(localCandidate) : fileName);
    streams.push({
      name: localStreamName(fileName, local.torrentName),
      title: streamTitle,
      url: `${runtime.config.publicBaseUrl}/${token}/play/local/${encodeURIComponent(local.id)}/${encodeURIComponent(fileName)}`,
      behaviorHints: streamBehaviorHints({
        filename: fileName,
        sizeBytes: local.sizeBytes,
        bingeGroup: `xcache|local|${local.infoHash || local.id}`
      })
    });

    if (!candidates) {
      candidates = await cachedCandidateSearchWithin(runtime, type, scrapeId, runtime.config.localStreamSearchWaitMs);
      if (candidates && scrapeId !== parsed.id) cacheCandidates(runtime, type, parsed.id, candidates);
      if (!candidates) {
        sendJson(res, 200, { streams }, 'no-store');
        return;
      }
    }
  }

  candidates = candidates || await cachedCandidateSearch(runtime, type, scrapeId);
  if (scrapeId !== parsed.id && candidates.length > 0) cacheCandidates(runtime, type, parsed.id, candidates);
  if (local) updateLocalStreamTitle(runtime, local, candidates);
  const visibleCandidates = candidates.slice(0, runtime.config.streamLimit);
  const rdCachedByHash = await rdCachedMap(runtime, visibleCandidates);
  for (const candidate of visibleCandidates) {
    const rdCached = candidate.infoHash ? rdCachedByHash.get(candidate.infoHash.toLowerCase()) === true : false;
    const candidateForPlayback = { ...candidate, isCachedRd: rdCached };
    const payload = { type, id: scrapeId, candidate: candidateForPlayback };
    const intentId = storePlayIntent(runtime, payload);
    streams.push({
      name: streamName(candidate.resolution, rdCached),
      title: candidateStreamTitle(candidate),
      url: candidatePlaybackUrl(runtime, token, intentId, rdCached),
      behaviorHints: streamBehaviorHints({
        filename: candidateFilename(candidate),
        sizeBytes: candidate.sizeBytes,
        bingeGroup: candidate.infoHash ? `xcache|torrent|${candidate.infoHash}` : `xcache|source|${intentId}`
      })
    });
  }

  sendJson(res, 200, { streams }, 'no-store');
}

async function cachedCandidateSearch(runtime: Runtime, type: MediaType, id: string): Promise<RankedCandidate[]> {
  if (!runtime.config.scraperStreamUrls.length) return [];

  const key = candidateCacheKey(type, id);
  const cached = getCachedCandidates(runtime, type, id);
  if (cached) return cached;

  const inflight = runtime.streamCandidateInflight.get(key);
  if (inflight) return inflight;

  const search = runtime.scraper.search(type, id)
    .then((candidates) => {
      if (candidates.length > 0) cacheCandidates(runtime, type, id, candidates);
      return candidates;
    })
    .catch((error) => {
      console.warn('[xcache] candidate search failed', error);
      return [];
    })
    .finally(() => runtime.streamCandidateInflight.delete(key));

  runtime.streamCandidateInflight.set(key, search);
  return search;
}

async function cachedCandidateSearchWithin(
  runtime: Runtime,
  type: MediaType,
  id: string,
  waitMs: number
): Promise<RankedCandidate[] | undefined> {
  const search = cachedCandidateSearch(runtime, type, id)
    .catch(() => undefined);

  if (waitMs <= 0) {
    void search;
    return undefined;
  }

  return await Promise.race([
    search,
    sleep(waitMs).then(() => undefined)
  ]);
}

function getCachedCandidates(runtime: Runtime, type: MediaType, id: string): RankedCandidate[] | undefined {
  const key = candidateCacheKey(type, id);
  const cached = runtime.streamCandidateCache.get(key);
  if (!cached) {
    const stored = runtime.store.findStreamCandidates(key);
    if (!stored) return undefined;
    runtime.streamCandidateCache.set(key, stored);
    return stored.candidates;
  }
  if (cached.expiresAt > Date.now()) return cached.candidates;
  runtime.streamCandidateCache.delete(key);

  const stored = runtime.store.findStreamCandidates(key);
  if (!stored) return undefined;
  runtime.streamCandidateCache.set(key, stored);
  return stored.candidates;
}

async function resolveScrapeId(runtime: Runtime, type: MediaType, parsed: ParsedMediaId): Promise<string> {
  try {
    const resolved = await runtime.idResolver.resolveStreamId(type, parsed);
    if (resolved) return resolved;
  } catch (error) {
    console.warn(`[xcache] TMDB id resolver failed for ${type}:${parsed.tmdbId || parsed.id}`, error instanceof Error ? error.message : error);
  }
  return parsed.id;
}

function getCachedCandidatesForAnyId(runtime: Runtime, type: MediaType, ids: string[]): RankedCandidate[] | undefined {
  for (const id of ids) {
    const cached = getCachedCandidates(runtime, type, id);
    if (cached) return cached;
  }
  return undefined;
}

async function promoteCompletedJobsForAnyId(
  runtime: Runtime,
  type: MediaType,
  ids: string[],
  season?: number,
  episode?: number
): Promise<void> {
  const seen = new Set<string>();
  const jobs = ids.flatMap((id) => runtime.store.findActiveDownloads(type, id, season, episode));
  await Promise.all(jobs.map(async (job) => {
    if (seen.has(job.id)) return;
    seen.add(job.id);
    const video = await findDownloadedVideo(runtime, job.infoHash, job.path).catch(() => undefined);
    if (!video) return;
    markJobReady(runtime, job, video.path, ids);
    void applyAudioPreference(runtime, video);
  }));
}

function findReadyForAnyId(
  runtime: Runtime,
  type: MediaType,
  ids: string[],
  season?: number,
  episode?: number
): StoredJob | undefined {
  for (const id of ids) {
    const local = runtime.store.findReady(type, id, season, episode);
    if (local) return local;
  }
  return undefined;
}

function cacheCandidates(runtime: Runtime, type: MediaType, id: string, candidates: RankedCandidate[]): void {
  if (runtime.config.streamCacheTtlMs <= 0 || candidates.length === 0) return;
  const key = candidateCacheKey(type, id);
  const expiresAt = Date.now() + runtime.config.streamCacheTtlMs;
  runtime.streamCandidateCache.set(key, {
    candidates,
    expiresAt
  });
  runtime.store.upsertStreamCandidates(key, candidates, expiresAt);
}

function invalidateStreamCaches(runtime: Runtime, type: MediaType, ids: string[]): void {
  for (const id of ids) {
    const key = candidateCacheKey(type, id);
    runtime.streamCandidateCache.delete(key);
    runtime.store.deleteStreamCandidates(key);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function updateLocalStreamTitle(runtime: Runtime, local: StoredJob, candidates: RankedCandidate[]): void {
  if (!local.infoHash) return;
  const localCandidate = candidates.find((candidate) => candidate.infoHash?.toLowerCase() === local.infoHash?.toLowerCase());
  if (!localCandidate) return;
  const streamTitle = candidateStreamTitle(localCandidate);
  if (streamTitle && streamTitle !== local.streamTitle) {
    runtime.store.upsert({ ...local, streamTitle });
  }
}

function candidateCacheKey(type: MediaType, id: string): string {
  return `${type}:${id}`;
}

async function handleLocal(runtime: Runtime, req: http.IncomingMessage, res: http.ServerResponse, token: string, jobId: string): Promise<void> {
  const local = await resolveReadyLocalVideo(runtime, jobId);
  if (local.status === 'not_found') {
    sendJson(res, 404, { error: 'local_stream_not_found' });
    return;
  }
  if (local.status === 'not_ready') {
    sendDownloadingPlaceholder(req, res);
    return;
  }
  if (local.status === 'missing_file') {
    sendJson(res, 404, { error: 'local_file_missing' });
    return;
  }
  await sendReadyLocalPlayback(runtime, req, res, token, local.job, local.video);
}

async function handleLocalTranscodePlaylist(runtime: Runtime, req: http.IncomingMessage, res: http.ServerResponse, jobId: string): Promise<void> {
  const local = await resolveReadyLocalVideo(runtime, jobId);
  if (local.status !== 'ready') {
    sendJson(res, 404, { error: 'local_stream_not_found' });
    return;
  }

  try {
    const session = await ensureTranscodeSession(runtime, local.job, local.video);
    if (!await waitForFile(session.playlistPath, runtime.config.transcodePlaylistWaitMs)) {
      sendJson(res, 503, { error: 'transcode_playlist_not_ready' }, 'no-store');
      return;
    }

    sendText(
      res,
      200,
      'application/vnd.apple.mpegurl; charset=utf-8',
      fs.readFileSync(session.playlistPath, 'utf8'),
      'no-store'
    );
  } catch (error) {
    console.warn('[xcache] local HLS transcode playlist failed', error);
    sendJson(res, 500, { error: 'transcode_failed' }, 'no-store');
  }
}

async function handleLocalTranscodeSegment(runtime: Runtime, req: http.IncomingMessage, res: http.ServerResponse, jobId: string, segmentName: string): Promise<void> {
  if (!/^segment-\d+\.ts$/.test(segmentName)) {
    sendJson(res, 404, { error: 'segment_not_found' });
    return;
  }

  const local = await resolveReadyLocalVideo(runtime, jobId);
  if (local.status !== 'ready') {
    sendJson(res, 404, { error: 'local_stream_not_found' });
    return;
  }

  try {
    const session = await ensureTranscodeSession(runtime, local.job, local.video);
    const segmentPath = path.join(session.directory, segmentName);
    if (!await waitForFile(segmentPath, runtime.config.transcodeSegmentWaitMs)) {
      sendJson(res, 404, { error: 'segment_not_ready' }, 'no-store');
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    sendFileWithRange(req, res, segmentPath);
  } catch (error) {
    console.warn('[xcache] local HLS transcode segment failed', error);
    sendJson(res, 500, { error: 'transcode_failed' }, 'no-store');
  }
}

async function resolveReadyLocalVideo(runtime: Runtime, jobId: string): Promise<ReadyLocalVideo> {
  const job = runtime.store.findById(jobId);
  if (!job?.path || job.status !== 'ready') return { status: 'not_found' };

  const video = await findDownloadedVideo(runtime, job.infoHash, job.path);
  if (!video) {
    runtime.store.upsert({ ...job, status: 'downloading', lastAccessedAt: Date.now() });
    return { status: 'not_ready' };
  }
  if (!fs.existsSync(video.path)) return { status: 'missing_file' };
  return { status: 'ready', job, video };
}

async function sendReadyLocalPlayback(
  runtime: Runtime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  job: StoredJob,
  video: DownloadedVideo
): Promise<void> {
  runtime.store.touch(job.id);

  if (await shouldTranscodeForRequest(runtime, req, video)) {
    redirect(res, `${runtime.config.publicBaseUrl}/${token}/play/local/${encodeURIComponent(job.id)}/transcode/index.m3u8`);
    return;
  }

  await applyAudioPreference(runtime, video);
  sendFileWithRange(req, res, video.path);
}

async function shouldTranscodeForRequest(runtime: Runtime, req: http.IncomingMessage, video: DownloadedVideo): Promise<boolean> {
  try {
    const media = await probeMedia(video.path, runtime.config.ffprobePath);
    return shouldUseBrowserTranscode(req.headers['user-agent'], media, transcodeConfig(runtime));
  } catch (error) {
    console.warn('[xcache] media probe failed, using direct playback', error);
    return false;
  }
}

async function ensureTranscodeSession(runtime: Runtime, job: StoredJob, video: DownloadedVideo): Promise<HlsSession> {
  const media = await probeMedia(video.path, runtime.config.ffprobePath);
  return await runtime.transcodes.ensureSession(job.id, video.path, media, transcodeConfig(runtime));
}

function transcodeConfig(runtime: Runtime) {
  return {
    mode: runtime.config.transcodeMode,
    cacheDir: runtime.config.transcodeCacheDir,
    segmentSeconds: runtime.config.transcodeSegmentSeconds,
    preset: runtime.config.transcodePreset,
    crf: runtime.config.transcodeCrf,
    audioBitrate: runtime.config.transcodeAudioBitrate,
    audioLanguagePriority: runtime.config.transcodeAudioLanguagePriority,
    ffmpegPath: runtime.config.statusFfmpegPath,
    ffprobePath: runtime.config.ffprobePath
  };
}

async function handleCandidate(
  runtime: Runtime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  installToken: string,
  signedPayload: string
): Promise<void> {
  const payload = resolvePlayPayload(runtime, signedPayload);
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
  const video = await waitForPlayableFile(runtime, candidate.infoHash, job.path);
  if (!video) {
    await sendStatusPlayback(runtime, req, res, installToken, job);
    return;
  }

  const readyJob: StoredJob = {
    ...job,
    status: 'ready',
    path: path.relative(runtime.config.cacheDir, video.path),
    sizeBytes: fs.statSync(video.path).size,
    lastAccessedAt: Date.now()
  };
  runtime.store.upsert(readyJob);
  invalidateStreamCaches(runtime, readyJob.mediaType, [readyJob.mediaId]);
  await sendReadyLocalPlayback(runtime, req, res, installToken, readyJob, video);
}

async function handleCandidateStatusPlaylist(
  runtime: Runtime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  installToken: string,
  intentId: string
): Promise<void> {
  const payload = resolvePlayPayload(runtime, intentId);
  const job = await startLocalDownload(runtime, payload);
  if (runtime.config.statusVideoMode !== 'live_hls' || !job.infoHash) {
    sendDownloadingPlaceholder(req, res);
    return;
  }

  const ffmpegAvailable = await isFfmpegAvailable(runtime.config.statusFfmpegPath);
  if (!ffmpegAvailable) {
    sendDownloadingPlaceholder(req, res);
    return;
  }

  const playlist = buildLivePlaylist({
    baseUrl: `${runtime.config.publicBaseUrl}/${installToken}`,
    jobId: job.id,
    nowMs: Date.now(),
    segmentSeconds: runtime.config.statusSegmentSeconds,
    playlistWindow: runtime.config.statusPlaylistWindow
  });
  sendText(res, 200, 'application/vnd.apple.mpegurl; charset=utf-8', playlist, 'no-store');
}

async function handleCandidateFallback(
  runtime: Runtime,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  intentId: string
): Promise<void> {
  const payload = resolvePlayPayload(runtime, intentId);
  await startLocalDownload(runtime, payload);
  sendDownloadingPlaceholder(req, res);
}

async function startLocalDownload(runtime: Runtime, payload: PlayPayload): Promise<StoredJob> {
  const candidate = payload.candidate;
  const parsed = parseMediaId(payload.type, payload.id);
  const magnetOrUrl = torrentReference(candidate);
  if (!magnetOrUrl) throw new Error('candidate has no torrent reference');

  const jobId = stableJobId(payload.type, parsed.id, candidate.infoHash || magnetOrUrl);
  const existing = runtime.store.findById(jobId);
  if (existing?.active) {
    const lastAccessedAt = Date.now();
    runtime.store.touch(existing.id);
    return { ...existing, lastAccessedAt };
  }

  await runtime.qbit.addTorrent({
    magnetOrUrl,
    savePath: runtime.config.cacheDir,
    category: 'xcache'
  });
  if (candidate.infoHash) {
    scheduleTrackerInjection(runtime, candidate.infoHash);
  }

  const now = Date.now();
  const job: StoredJob = {
    id: jobId,
    mediaType: payload.type,
    mediaId: parsed.id,
    season: parsed.season,
    episode: parsed.episode,
    infoHash: candidate.infoHash,
    torrentName: candidate.name,
    streamTitle: candidateStreamTitle(candidate),
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

function scheduleTrackerInjection(runtime: Runtime, infoHash: string): void {
  if (!runtime.config.trackerInjectionEnabled) return;
  void injectTrackers(runtime, infoHash)
    .catch((error) => console.warn('[xcache] tracker injection failed', error instanceof Error ? error.message : error));
}

async function injectTrackers(runtime: Runtime, infoHash: string): Promise<void> {
  const trackers = await runtime.trackers.getTrackers();
  if (trackers.length === 0) return;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await runtime.qbit.addTrackers(infoHash, trackers);
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function waitForPlayableFile(runtime: Runtime, infoHash: string | undefined, fallbackPath: string): Promise<DownloadedVideo | undefined> {
  const deadline = Date.now() + runtime.config.playableWaitMs;
  while (Date.now() < deadline) {
    const video = await findDownloadedVideo(runtime, infoHash, fallbackPath);
    if (video) return video;
    await sleep(1500);
  }
  return undefined;
}

async function findDownloadedVideo(
  runtime: Runtime,
  infoHash: string | undefined,
  fallbackPath: string
): Promise<DownloadedVideo | undefined> {
  if (infoHash) {
    const files = await runtime.qbit.listFiles(infoHash).catch(() => undefined);
    const selected = files
      ?.filter((file) => videoExtensionFromPath(file.name))
      .sort((left, right) => right.size - left.size)[0];

    if (selected) {
      if (selected.progress < runtime.config.localReadyMinProgress) return undefined;
      const filePath = runtime.cache.safePath(selected.name);
      if (fs.existsSync(filePath)) return { path: filePath, progress: selected.progress };
      return undefined;
    }
  }

  if (!fallbackPath) return undefined;
  const filePath = runtime.cache.safePath(fallbackPath);
  return fs.existsSync(filePath) ? { path: filePath } : undefined;
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

  const ffmpegAvailable = await isFfmpegAvailable(runtime.config.statusFfmpegPath);
  if (!ffmpegAvailable) {
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
      findDownloadedVideo(runtime, job.infoHash, job.path)
    ]);
    const effectiveJob = readyFilePath ? markJobReady(runtime, job, readyFilePath.path) : job;
    if (readyFilePath) void applyAudioPreference(runtime, readyFilePath);
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

function startStaleDownloadCleanup(runtime: Runtime): void {
  setTimeout(() => {
    void cleanupStaleDownloads(runtime).catch((error) => console.warn('[xcache] stale download cleanup failed', error));
  }, 30_000).unref();

  setInterval(() => {
    void cleanupStaleDownloads(runtime).catch((error) => console.warn('[xcache] stale download cleanup failed', error));
  }, runtime.config.staleDownloadCleanupIntervalMs).unref();
}

async function cleanupStaleDownloads(runtime: Runtime): Promise<void> {
  const cutoff = Date.now() - runtime.config.staleDownloadMaxAgeMs;
  const jobs = runtime.store.listStaleDownloads(cutoff);
  for (const job of jobs) {
    if (job.infoHash) {
      const torrent = await runtime.qbit.getTorrentStatus(job.infoHash).catch(() => undefined);
      if (torrent && torrent.progress >= runtime.config.localReadyMinProgress) {
        const video = await findDownloadedVideo(runtime, job.infoHash, job.path).catch(() => undefined);
        if (video) {
          markJobReady(runtime, job, video.path);
          void applyAudioPreference(runtime, video);
          continue;
        }
        console.warn(`[xcache] stale download appears complete but no local file was found: ${job.infoHash}`);
        continue;
      }

      await runtime.qbit.deleteTorrents([job.infoHash], runtime.config.staleDownloadDeleteFiles)
        .catch((error) => console.warn(`[xcache] qBittorrent stale delete failed for ${job.infoHash}`, error));
    }

    runtime.store.remove(job.id);
    invalidateStreamCaches(runtime, job.mediaType, [job.mediaId]);
    console.log(`[xcache] removed stale incomplete download ${job.id} (${job.infoHash || 'no hash'})`);
  }
}

function markJobReady(runtime: Runtime, job: StoredJob, filePath: string, extraMediaIds: string[] = []): StoredJob {
  const readyJob: StoredJob = {
    ...job,
    status: 'ready',
    path: path.relative(runtime.config.cacheDir, filePath),
    sizeBytes: fs.statSync(filePath).size,
    lastAccessedAt: Date.now()
  };
  runtime.store.upsert(readyJob);
  invalidateStreamCaches(runtime, readyJob.mediaType, uniqueStrings([readyJob.mediaId, ...extraMediaIds]));
  return readyJob;
}

async function applyAudioPreference(runtime: Runtime, video: DownloadedVideo): Promise<void> {
  const complete = video.progress === undefined || video.progress >= 1;
  try {
    const result = await ensurePreferredAudioDefault(video.path, {
      enabled: runtime.config.audioDefaultEnabled,
      languagePriority: runtime.config.audioLanguagePriority,
      ffprobePath: runtime.config.ffprobePath,
      mkvpropeditPath: runtime.config.mkvpropeditPath
    }, complete);
    if (result.changed) {
      console.log(`[xcache] preferred audio default updated for ${path.basename(video.path)}: ${result.selected?.language || result.selected?.title || 'preferred'}`);
    }
  } catch (error) {
    console.warn('[xcache] preferred audio update failed', error);
  }
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
    resources: [{
      name: 'stream',
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tmdb:']
    }],
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

function storePlayIntent(runtime: Runtime, payload: PlayPayload): string {
  const id = crypto
    .createHmac('sha256', runtime.config.installTokenSecret)
    .update(JSON.stringify(payload))
    .digest('base64url')
    .slice(0, 32);
  runtime.store.upsertPlayIntent(id, payload, Date.now() + runtime.config.playIntentTtlMs);
  return id;
}

function resolvePlayPayload(runtime: Runtime, value: string): PlayPayload {
  const stored = runtime.store.findPlayIntent<PlayPayload>(value);
  if (stored) return stored.payload;
  return decodeSignedPayload<PlayPayload>(value, runtime.config.installTokenSecret);
}

function candidatePlaybackUrl(runtime: Runtime, token: string, intentId: string, rdCached: boolean): string {
  if (rdCached && runtime.rd && runtime.config.rdMode !== 'off' && runtime.config.rdMode !== 'local_first') {
    return `${runtime.config.publicBaseUrl}/${token}/play/candidate/${intentId}`;
  }
  if (runtime.config.statusVideoMode === 'live_hls') {
    return `${runtime.config.publicBaseUrl}/${token}/play/candidate/${intentId}/status.m3u8`;
  }
  return `${runtime.config.publicBaseUrl}/${token}/play/candidate/${intentId}/fallback.mp4`;
}

function streamBehaviorHints(options: { filename?: string; sizeBytes?: number; bingeGroup?: string }): Record<string, unknown> {
  return {
    ...(options.filename ? { filename: options.filename } : {}),
    ...(options.sizeBytes ? { videoSize: options.sizeBytes } : {}),
    ...(options.bingeGroup ? { bingeGroup: options.bingeGroup } : {})
  };
}

function candidateFilename(candidate: RankedCandidate): string | undefined {
  const raw = candidate.raw as { behaviorHints?: { filename?: unknown } } | undefined;
  if (typeof raw?.behaviorHints?.filename === 'string') return raw.behaviorHints.filename;
  const firstLine = candidate.title?.split(/\r?\n/).find((line) => videoExtensionFromPath(line));
  return firstLine?.replace(/^[^\p{L}\p{N}]+/u, '').trim() || candidate.name;
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

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown, cacheControl?: string): void {
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
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
