import type { FilterOptions, RdMode } from '@xcache/core';
import type { StatusVideoMode } from './status-video.js';
import type { TranscodeMode } from './transcode.js';

export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  basePath: string;
  installTokenSecret: string;
  cacheDir: string;
  cacheDbPath: string;
  cacheMaxBytes: number;
  cacheMinFreeBytes: number;
  qbittorrentUrl: string;
  qbittorrentUser: string;
  qbittorrentPass: string;
  realDebridApiToken?: string;
  tmdbApiKey?: string;
  tmdbReadAccessToken?: string;
  tmdbApiBaseUrl?: string;
  tmdbResolverTimeoutMs: number;
  tmdbIdCacheTtlMs: number;
  rdMode: RdMode;
  rdAvailabilityCacheTtlMs: number;
  rdAvailabilityBlocking: boolean;
  scraperStreamUrls: string[];
  streamCacheTtlMs: number;
  playIntentTtlMs: number;
  scraperTimeoutMs: number;
  scraperSettleMs: number;
  localStreamSearchWaitMs: number;
  trackerInjectionEnabled: boolean;
  trackerListUrl?: string;
  trackerExtraTrackers: string[];
  trackerMax: number;
  trackerRefreshMs: number;
  trackerFetchTimeoutMs: number;
  filterOptions: FilterOptions;
  streamLimit: number;
  startupEviction: boolean;
  staleDownloadCleanupEnabled: boolean;
  staleDownloadMaxAgeMs: number;
  staleDownloadCleanupIntervalMs: number;
  staleDownloadDeleteFiles: boolean;
  localReadyMinProgress: number;
  playableWaitMs: number;
  statusVideoMode: StatusVideoMode;
  statusSegmentSeconds: number;
  statusPlaylistWindow: number;
  statusSegmentCacheTtlMs: number;
  statusSegmentCacheDir: string;
  statusFfmpegPath: string;
  ffprobePath: string;
  mkvpropeditPath: string;
  statusFontFile?: string;
  audioDefaultEnabled: boolean;
  audioLanguagePriority: string[];
  transcodeMode: TranscodeMode;
  transcodeCacheDir: string;
  transcodeSegmentSeconds: number;
  transcodePlaylistWaitMs: number;
  transcodeSegmentWaitMs: number;
  transcodePreset: string;
  transcodeCrf: number;
  transcodeAudioBitrate: string;
  transcodeAudioLanguagePriority: string[];
}

const GIB = 1024 ** 3;
const DEFAULT_BLOCKED_QUALITY_TAGS = [
  'CAM',
  'HDCAM',
  'HDTS',
  'TS',
  'TELESYNC',
  'TELECINE',
  'HDTC',
  'TC',
  'CAMRIP',
  'SCREENER',
  'DVDSCR',
  'DVDSCREENER',
  'WORKPRINT',
  'WP',
  'PDVD'
];

export function loadConfig(env = process.env): AppConfig {
  const cacheDir = env.CACHE_DIR || '/cache';
  const preferredProviders = csv(env.XCACHE_PREFERRED_PROVIDERS || 'Comando,MicoLeaoDublado,BluDV');
  return {
    port: numberEnv(env.PORT, 7331),
    publicBaseUrl: requiredUrl(env.PUBLIC_BASE_URL || 'http://localhost:7331'),
    basePath: normalizeBasePath(env.BASE_PATH || ''),
    installTokenSecret: required(env.INSTALL_TOKEN_SECRET, 'INSTALL_TOKEN_SECRET'),
    cacheDir,
    cacheDbPath: env.CACHE_DB_PATH || `${cacheDir}/xcache.sqlite`,
    cacheMaxBytes: bytesEnv(env.CACHE_MAX_BYTES, 100 * GIB),
    cacheMinFreeBytes: bytesEnv(env.CACHE_MIN_FREE_BYTES, 50 * GIB),
    qbittorrentUrl: requiredUrl(env.QBITTORRENT_URL || 'http://qbittorrent:8080'),
    qbittorrentUser: required(env.QBITTORRENT_USER, 'QBITTORRENT_USER'),
    qbittorrentPass: required(env.QBITTORRENT_PASS, 'QBITTORRENT_PASS'),
    realDebridApiToken: env.REAL_DEBRID_API_TOKEN || undefined,
    tmdbApiKey: env.TMDB_API_KEY || env.XCACHE_TMDB_API_KEY || undefined,
    tmdbReadAccessToken: env.TMDB_READ_ACCESS_TOKEN || env.XCACHE_TMDB_READ_ACCESS_TOKEN || undefined,
    tmdbApiBaseUrl: env.XCACHE_TMDB_API_BASE_URL || undefined,
    tmdbResolverTimeoutMs: integerEnv(env.XCACHE_TMDB_RESOLVER_TIMEOUT_MS, 3000, 500),
    tmdbIdCacheTtlMs: integerEnv(env.XCACHE_TMDB_ID_CACHE_TTL_MS, 86_400_000, 0),
    rdMode: rdMode(env.RD_MODE || 'rd_plus_local'),
    rdAvailabilityCacheTtlMs: integerEnv(env.XCACHE_RD_AVAILABILITY_CACHE_TTL_MS, 300_000, 0),
    rdAvailabilityBlocking: booleanEnv(env.XCACHE_RD_AVAILABILITY_BLOCKING, false),
    scraperStreamUrls: csv(env.SCRAPER_STREAM_URLS || ''),
    streamCacheTtlMs: integerEnv(env.XCACHE_STREAM_CACHE_TTL_MS, 600_000, 0),
    playIntentTtlMs: integerEnv(env.XCACHE_PLAY_INTENT_TTL_MS, 86_400_000, 60_000),
    scraperTimeoutMs: integerEnv(env.XCACHE_SCRAPER_TIMEOUT_MS, 10_000, 500),
    scraperSettleMs: integerEnv(env.XCACHE_SCRAPER_SETTLE_MS, 750, 0),
    localStreamSearchWaitMs: integerEnv(env.XCACHE_LOCAL_STREAM_SEARCH_WAIT_MS, 2500, 0),
    trackerInjectionEnabled: booleanEnv(env.XCACHE_TRACKER_INJECTION_ENABLED, false),
    trackerListUrl: env.XCACHE_TRACKER_LIST_URL || undefined,
    trackerExtraTrackers: listEnv(env.XCACHE_TRACKER_EXTRA_URLS || ''),
    trackerMax: integerEnv(env.XCACHE_TRACKER_MAX, 30, 0),
    trackerRefreshMs: integerEnv(env.XCACHE_TRACKER_REFRESH_MS, 86_400_000, 60_000),
    trackerFetchTimeoutMs: integerEnv(env.XCACHE_TRACKER_FETCH_TIMEOUT_MS, 5000, 500),
    filterOptions: {
      allowedResolutions: csv(env.XCACHE_ALLOWED_RESOLUTIONS || '1080p,720p'),
      preferredLanguages: csv(env.XCACHE_PREFERRED_LANGUAGES || 'pt-BR,pt,en'),
      preferredProviders,
      blockedProviders: csv(env.XCACHE_BLOCKED_PROVIDERS || 'Cinecalidad'),
      blockedQualityTags: csv(env.XCACHE_BLOCKED_QUALITY_TAGS || DEFAULT_BLOCKED_QUALITY_TAGS.join(',')),
      allowSpanishNative: booleanEnv(env.XCACHE_ALLOW_SPANISH_NATIVE, false),
      nativeLanguage: env.XCACHE_NATIVE_LANGUAGE || undefined
    },
    streamLimit: numberEnv(env.XCACHE_STREAM_LIMIT, 8),
    startupEviction: booleanEnv(env.XCACHE_STARTUP_EVICTION, true),
    staleDownloadCleanupEnabled: booleanEnv(env.XCACHE_STALE_DOWNLOAD_CLEANUP_ENABLED, true),
    staleDownloadMaxAgeMs: integerEnv(env.XCACHE_STALE_DOWNLOAD_MAX_AGE_MS, 907_200_000, 60_000),
    staleDownloadCleanupIntervalMs: integerEnv(env.XCACHE_STALE_DOWNLOAD_CLEANUP_INTERVAL_MS, 21_600_000, 60_000),
    staleDownloadDeleteFiles: booleanEnv(env.XCACHE_STALE_DOWNLOAD_DELETE_FILES, true),
    localReadyMinProgress: progressEnv(env.XCACHE_LOCAL_READY_MIN_PROGRESS, 0.98),
    playableWaitMs: numberEnv(env.XCACHE_PLAYABLE_WAIT_MS, 5000),
    statusVideoMode: statusVideoMode(env.XCACHE_STATUS_VIDEO_MODE || 'live_hls'),
    statusSegmentSeconds: integerEnv(env.XCACHE_STATUS_SEGMENT_SECONDS, 8, 2),
    statusPlaylistWindow: integerEnv(env.XCACHE_STATUS_PLAYLIST_WINDOW, 6, 2),
    statusSegmentCacheTtlMs: integerEnv(env.XCACHE_STATUS_SEGMENT_CACHE_TTL_MS, 60_000, 10_000),
    statusSegmentCacheDir: env.XCACHE_STATUS_SEGMENT_CACHE_DIR || '/tmp/xcache-status',
    statusFfmpegPath: env.XCACHE_FFMPEG_PATH || 'ffmpeg',
    ffprobePath: env.XCACHE_FFPROBE_PATH || 'ffprobe',
    mkvpropeditPath: env.XCACHE_MKVPROPEDIT_PATH || 'mkvpropedit',
    statusFontFile: env.XCACHE_STATUS_FONT_FILE || undefined,
    audioDefaultEnabled: booleanEnv(env.XCACHE_AUDIO_DEFAULT_ENABLED, false),
    audioLanguagePriority: csv(env.XCACHE_AUDIO_LANGUAGE_PRIORITY || ''),
    transcodeMode: transcodeMode(env.XCACHE_TRANSCODE_MODE || 'auto'),
    transcodeCacheDir: env.XCACHE_TRANSCODE_CACHE_DIR || '/tmp/xcache-transcode',
    transcodeSegmentSeconds: integerEnv(env.XCACHE_TRANSCODE_SEGMENT_SECONDS, 6, 2),
    transcodePlaylistWaitMs: integerEnv(env.XCACHE_TRANSCODE_PLAYLIST_WAIT_MS, 12_000, 0),
    transcodeSegmentWaitMs: integerEnv(env.XCACHE_TRANSCODE_SEGMENT_WAIT_MS, 12_000, 0),
    transcodePreset: env.XCACHE_TRANSCODE_PRESET || 'veryfast',
    transcodeCrf: integerEnv(env.XCACHE_TRANSCODE_CRF, 23, 0),
    transcodeAudioBitrate: env.XCACHE_TRANSCODE_AUDIO_BITRATE || '192k',
    transcodeAudioLanguagePriority: csv(env.XCACHE_TRANSCODE_AUDIO_LANGUAGE_PRIORITY || env.XCACHE_AUDIO_LANGUAGE_PRIORITY || 'pt-BR,pt,por,pob,br,en,eng')
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredUrl(value: string): string {
  return value.replace(/\/$/, '');
}

function normalizeBasePath(value: string): string {
  const normalized = `/${value.trim().replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '' : normalized;
}

function csv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function listEnv(value: string): string[] {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function bytesEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|kib|mib|gib)?$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = (match[2] || 'b').toLowerCase();
  const multiplier = unit.startsWith('g') ? GIB : unit.startsWith('m') ? 1024 ** 2 : unit.startsWith('k') ? 1024 : 1;
  return Math.round(amount * multiplier);
}

function rdMode(value: string): RdMode {
  if (['off', 'cached_only', 'rd_plus_local', 'local_first'].includes(value)) return value as RdMode;
  return 'rd_plus_local';
}

function statusVideoMode(value: string): StatusVideoMode {
  if (['live_hls', 'mp4_static'].includes(value)) return value as StatusVideoMode;
  return 'live_hls';
}

function transcodeMode(value: string): TranscodeMode {
  if (['off', 'auto', 'always'].includes(value)) return value as TranscodeMode;
  return 'auto';
}

function progressEnv(value: string | undefined, fallback: number): number {
  const parsed = numberEnv(value, fallback);
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function integerEnv(value: string | undefined, fallback: number, min: number): number {
  return Math.max(min, Math.floor(numberEnv(value, fallback)));
}
