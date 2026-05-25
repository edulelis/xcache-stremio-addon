import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseResolution } from '@xcache/core';
import type { QbittorrentTorrentStatus } from './clients/qbittorrent.js';

const execFileAsync = promisify(execFile);
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const DEFAULT_FONT_CANDIDATES = [
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf'
];

export type StatusVideoMode = 'live_hls' | 'mp4_static';

export interface StatusJob {
  id: string;
  torrentName?: string;
  source?: string;
  infoHash?: string;
  sizeBytes: number;
  status: string;
}

export interface StatusSnapshot {
  jobId: string;
  title: string;
  source: string;
  resolution: string;
  progress: number;
  speedBytesPerSecond: number;
  seeds: number;
  etaSeconds: number;
  state: string;
  sizeBytes: number;
  ready: boolean;
}

export interface PlaylistOptions {
  baseUrl: string;
  jobId: string;
  nowMs: number;
  segmentSeconds: number;
  playlistWindow: number;
}

export interface SegmentRenderOptions {
  segmentId: number;
  segmentSeconds: number;
  cacheDir: string;
  cacheTtlMs: number;
  ffmpegPath: string;
  fontFile?: string;
}

export function buildLivePlaylist(options: PlaylistOptions): string {
  const segmentMs = options.segmentSeconds * 1000;
  const currentSequence = Math.max(0, Math.floor(options.nowMs / segmentMs));
  const window = Math.max(1, Math.floor(options.playlistWindow));
  const startSequence = Math.max(0, currentSequence - window + 1);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-ALLOW-CACHE:NO',
    `#EXT-X-TARGETDURATION:${Math.ceil(options.segmentSeconds)}`,
    `#EXT-X-MEDIA-SEQUENCE:${startSequence}`
  ];

  for (let sequence = startSequence; sequence <= currentSequence; sequence += 1) {
    lines.push(`#EXTINF:${options.segmentSeconds.toFixed(3)},`);
    lines.push(`${options.baseUrl}/play/status/${encodeURIComponent(options.jobId)}/segment/${sequence}.ts`);
  }

  return `${lines.join('\n')}\n`;
}

export function buildStatusSnapshot(
  job: StatusJob,
  torrent: QbittorrentTorrentStatus | undefined,
  options: { readyThreshold: number; ready?: boolean }
): StatusSnapshot {
  const title = safeText(torrent?.name || job.torrentName || 'Torrent XCACHE', 96);
  const progress = clamp(torrent?.progress ?? (job.status === 'ready' ? 1 : 0), 0, 1);
  return {
    jobId: job.id,
    title,
    source: safeText(job.source || 'qBittorrent', 40),
    resolution: parseResolution(title) || 'video',
    progress,
    speedBytesPerSecond: Math.max(0, torrent?.dlspeed ?? 0),
    seeds: Math.max(0, torrent?.numSeeds ?? 0),
    etaSeconds: Math.max(0, torrent?.eta ?? 0),
    state: safeText(torrent?.state || job.status || 'downloading', 32),
    sizeBytes: Math.max(0, torrent?.size || job.sizeBytes || 0),
    ready: options.ready ?? progress >= options.readyThreshold
  };
}

export function formatStatusLines(snapshot: StatusSnapshot): string[] {
  const percent = `${Math.round(snapshot.progress * 100)}%`;
  const titleLines = wrapText(snapshot.title, 48).slice(0, 2);
  const statusLine = snapshot.ready
    ? 'Download complete'
    : `Downloading ${percent}`;
  const detailLine = snapshot.ready
    ? 'Go back and play this stream again.'
    : `${formatBytesPerSecond(snapshot.speedBytesPerSecond)} | ${snapshot.seeds} seeds | ETA ${formatEta(snapshot.etaSeconds)}`;
  const sourceLine = `${snapshot.source} | ${snapshot.resolution} | ${snapshot.state}`;

  return [
    'XCACHE',
    statusLine,
    detailLine,
    sourceLine,
    ...titleLines,
    snapshot.ready ? 'The file is now in local cache.' : 'Download continues in the background.'
  ];
}

export async function renderStatusSegment(snapshot: StatusSnapshot, options: SegmentRenderOptions): Promise<string> {
  await fs.mkdir(options.cacheDir, { recursive: true });
  await cleanupOldSegments(options.cacheDir, options.cacheTtlMs);
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${options.segmentId}:${JSON.stringify(snapshot)}`)
    .digest('hex')
    .slice(0, 32);
  const outputPath = path.join(options.cacheDir, `${cacheKey}.ts`);

  if (await exists(outputPath)) return outputPath;

  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  const args = buildFfmpegArgs(snapshot, options, tempPath);
  try {
    await execFileAsync(options.ffmpegPath, args, { timeout: (options.segmentSeconds + 10) * 1000 });
    await fs.rename(tempPath, outputPath);
    return outputPath;
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function isFfmpegAvailable(ffmpegPath: string): Promise<boolean> {
  try {
    await execFileAsync(ffmpegPath, ['-version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function buildFfmpegArgs(snapshot: StatusSnapshot, options: SegmentRenderOptions, outputPath: string): string[] {
  const fontFile = resolveFontFile(options.fontFile);
  const lines = formatStatusLines(snapshot);
  const textFilters = [
    drawText(lines[0], fontFile, 68, 'white', 105, true),
    drawText(lines[1], fontFile, 46, snapshot.ready ? '0x7df2a0' : 'white', 205, true),
    drawText(lines[2], fontFile, 32, '0xc9c6d8', 275),
    drawText(lines[3], fontFile, 26, '0x9692aa', 330),
    drawText(lines[4] || '', fontFile, 30, 'white', 420),
    drawText(lines[5] || '', fontFile, 30, 'white', 465),
    drawText(lines[6] || '', fontFile, 26, '0x9692aa', 560)
  ].filter(Boolean);

  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x121124:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${options.segmentSeconds}`,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t',
    String(options.segmentSeconds),
    '-shortest',
    '-vf',
    textFilters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'main',
    '-level',
    '4.0',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-f',
    'mpegts',
    outputPath
  ];
}

function drawText(text: string, fontFile: string, fontSize: number, color: string, y: number, bold = false): string {
  const weight = bold ? ':borderw=1:bordercolor=0x000000@0.25' : '';
  return [
    `drawtext=fontfile=${escapeDrawtextOption(fontFile)}`,
    `text='${escapeDrawtextText(text)}'`,
    `fontcolor=${color}`,
    `fontsize=${fontSize}`,
    'x=(w-text_w)/2',
    `y=${y}`,
    'expansion=none',
    weight.replace(/^:/, '')
  ].filter(Boolean).join(':');
}

function resolveFontFile(preferred: string | undefined): string {
  if (preferred) return preferred;
  return DEFAULT_FONT_CANDIDATES.find((candidate) => fsSync.existsSync(candidate)) || DEFAULT_FONT_CANDIDATES[0];
}

function safeText(value: string, maxLength: number): string {
  return value
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s.,:;_+\-()[\]#%/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function wrapText(value: string, maxLineLength: number): string[] {
  const words = safeText(value, 140).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['Torrent XCACHE'];
}

function formatBytesPerSecond(value: number): string {
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB/s`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB/s`;
  return `${Math.round(value)} B/s`;
}

function formatEta(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 7 * 24 * 60 * 60) return '--';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function escapeDrawtextOption(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function escapeDrawtextText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupOldSegments(cacheDir: string, ttlMs: number): Promise<void> {
  const maxAgeMs = Math.max(ttlMs, 60_000) * 5;
  const now = Date.now();
  const entries = await fs.readdir(cacheDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map(async (entry) => {
      const filePath = path.join(cacheDir, entry.name);
      const stat = await fs.stat(filePath).catch(() => undefined);
      if (stat && now - stat.mtimeMs > maxAgeMs) await fs.rm(filePath, { force: true });
    }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
