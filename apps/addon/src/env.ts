import type { FilterOptions, RdMode } from '@xcache/core';
import type { StatusVideoMode } from './status-video.js';

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
  rdMode: RdMode;
  rdAvailabilityCacheTtlMs: number;
  rdAvailabilityBlocking: boolean;
  scraperStreamUrls: string[];
  filterOptions: FilterOptions;
  streamLimit: number;
  startupEviction: boolean;
  localReadyMinProgress: number;
  playableWaitMs: number;
  statusVideoMode: StatusVideoMode;
  statusSegmentSeconds: number;
  statusPlaylistWindow: number;
  statusSegmentCacheTtlMs: number;
  statusSegmentCacheDir: string;
  statusFfmpegPath: string;
  statusFontFile?: string;
}

const GIB = 1024 ** 3;

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
    rdMode: rdMode(env.RD_MODE || 'rd_plus_local'),
    rdAvailabilityCacheTtlMs: integerEnv(env.XCACHE_RD_AVAILABILITY_CACHE_TTL_MS, 300_000, 0),
    rdAvailabilityBlocking: booleanEnv(env.XCACHE_RD_AVAILABILITY_BLOCKING, false),
    scraperStreamUrls: csv(env.SCRAPER_STREAM_URLS || ''),
    filterOptions: {
      allowedResolutions: csv(env.XCACHE_ALLOWED_RESOLUTIONS || '1080p,720p'),
      preferredLanguages: csv(env.XCACHE_PREFERRED_LANGUAGES || 'pt-BR,pt,en'),
      preferredProviders,
      blockedProviders: csv(env.XCACHE_BLOCKED_PROVIDERS || 'Cinecalidad'),
      allowSpanishNative: booleanEnv(env.XCACHE_ALLOW_SPANISH_NATIVE, false),
      nativeLanguage: env.XCACHE_NATIVE_LANGUAGE || undefined
    },
    streamLimit: numberEnv(env.XCACHE_STREAM_LIMIT, 8),
    startupEviction: booleanEnv(env.XCACHE_STARTUP_EVICTION, true),
    localReadyMinProgress: progressEnv(env.XCACHE_LOCAL_READY_MIN_PROGRESS, 0.98),
    playableWaitMs: numberEnv(env.XCACHE_PLAYABLE_WAIT_MS, 5000),
    statusVideoMode: statusVideoMode(env.XCACHE_STATUS_VIDEO_MODE || 'live_hls'),
    statusSegmentSeconds: integerEnv(env.XCACHE_STATUS_SEGMENT_SECONDS, 8, 2),
    statusPlaylistWindow: integerEnv(env.XCACHE_STATUS_PLAYLIST_WINDOW, 6, 2),
    statusSegmentCacheTtlMs: integerEnv(env.XCACHE_STATUS_SEGMENT_CACHE_TTL_MS, 60_000, 10_000),
    statusSegmentCacheDir: env.XCACHE_STATUS_SEGMENT_CACHE_DIR || '/tmp/xcache-status',
    statusFfmpegPath: env.XCACHE_FFMPEG_PATH || 'ffmpeg',
    statusFontFile: env.XCACHE_STATUS_FONT_FILE || undefined
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

function progressEnv(value: string | undefined, fallback: number): number {
  const parsed = numberEnv(value, fallback);
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function integerEnv(value: string | undefined, fallback: number, min: number): number {
  return Math.max(min, Math.floor(numberEnv(value, fallback)));
}
