import crypto from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { choosePreferredAudioTrack, type AudioTrack } from './audio-preference.js';

const execFileAsync = promisify(execFile);
const UNSUPPORTED_VIDEO_CODECS = new Set(['hevc', 'h265']);
const UNSUPPORTED_AUDIO_CODECS = new Set(['ac3', 'eac3', 'dts', 'truehd']);

export type TranscodeMode = 'off' | 'auto' | 'always';

export interface TranscodeConfig {
  mode: TranscodeMode;
  cacheDir: string;
  segmentSeconds: number;
  preset: string;
  crf: number;
  audioBitrate: string;
  audioLanguagePriority: string[];
  ffmpegPath: string;
  ffprobePath: string;
}

export interface MediaInfo {
  video?: VideoTrack;
  audio: AudioTrackWithCodec[];
}

export interface VideoTrack {
  streamIndex: number;
  codec?: string;
}

export interface AudioTrackWithCodec extends AudioTrack {
  codec?: string;
}

export interface HlsSession {
  directory: string;
  playlistPath: string;
}

interface FfprobePayload {
  streams?: Array<{
    index?: number;
    codec_name?: string;
    codec_type?: string;
    disposition?: { default?: number };
    tags?: Record<string, string>;
  }>;
}

interface RunningSession extends HlsSession {
  process?: ChildProcess;
  complete: boolean;
  stderr: string;
}

export class HlsTranscodeManager {
  private readonly sessions = new Map<string, RunningSession>();

  async ensureSession(jobId: string, inputPath: string, media: MediaInfo, config: TranscodeConfig): Promise<HlsSession> {
    const selectedAudio = chooseTranscodeAudioTrack(media.audio, config.audioLanguagePriority);
    const sessionKey = transcodeSessionKey(jobId, inputPath, selectedAudio, config);
    const directory = path.join(config.cacheDir, sessionKey);
    const playlistPath = path.join(directory, 'index.m3u8');
    const existing = this.sessions.get(sessionKey);

    if (existing && (existing.process || existing.complete || (fs.existsSync(playlistPath) && playlistFinished(playlistPath)))) return existing;
    if (fs.existsSync(playlistPath) && playlistFinished(playlistPath)) {
      const session = { directory, playlistPath, complete: true, stderr: '' };
      this.sessions.set(sessionKey, session);
      return session;
    }

    fs.mkdirSync(directory, { recursive: true });
    const args = buildHlsTranscodeArgs({
      inputPath,
      outputDirectory: directory,
      selectedAudio,
      segmentSeconds: config.segmentSeconds,
      preset: config.preset,
      crf: config.crf,
      audioBitrate: config.audioBitrate
    });
    const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const session: RunningSession = { directory, playlistPath, process: child, complete: false, stderr: '' };
    this.sessions.set(sessionKey, session);

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      session.stderr = `${session.stderr}${chunk}`.slice(-4000);
    });
    child.on('exit', (code, signal) => {
      session.process = undefined;
      session.complete = code === 0 && playlistFinished(playlistPath);
      if (!session.complete) {
        console.warn(`[xcache] HLS transcode exited for ${path.basename(inputPath)}: code=${code ?? 'n/a'} signal=${signal ?? 'n/a'} ${session.stderr}`);
      }
    });

    return session;
  }
}

export async function probeMedia(filePath: string, ffprobePath: string): Promise<MediaInfo> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v',
    'error',
    '-show_streams',
    '-of',
    'json',
    filePath
  ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  return parseMediaInfo(JSON.parse(stdout) as FfprobePayload);
}

export function parseMediaInfo(payload: FfprobePayload): MediaInfo {
  const audio: AudioTrackWithCodec[] = [];
  let video: VideoTrack | undefined;
  for (const stream of payload.streams || []) {
    const streamIndex = Number(stream.index ?? 0);
    if (stream.codec_type === 'video' && !video) {
      video = { streamIndex, codec: normalizeCodec(stream.codec_name) };
    }
    if (stream.codec_type === 'audio') {
      const tags = stream.tags || {};
      audio.push({
        streamIndex,
        audioPosition: audio.length,
        codec: normalizeCodec(stream.codec_name),
        language: firstString(tags.language, tags.LANGUAGE, tags.Language),
        title: firstString(tags.title, tags.TITLE, tags.handler_name),
        default: stream.disposition?.default === 1
      });
    }
  }
  return { video, audio };
}

export function shouldUseBrowserTranscode(userAgent: string | undefined, media: MediaInfo, config: TranscodeConfig): boolean {
  if (config.mode === 'off') return false;
  if (config.mode === 'auto' && !isBrowserUserAgent(userAgent)) return false;
  return requiresH264AacTranscode(media, config.audioLanguagePriority);
}

export function isBrowserUserAgent(userAgent: string | undefined): boolean {
  const value = (userAgent || '').toLowerCase();
  if (!value) return false;
  if (/\b(exoplayer|vlc|mpv|iina|libvlc|ffmpeg|lavf|okhttp)\b/.test(value)) return false;
  return /\b(mozilla|chrome|chromium|firefox|safari|edg|opr|brave)\b/.test(value);
}

export function requiresH264AacTranscode(media: MediaInfo, audioLanguagePriority: string[]): boolean {
  const videoCodec = normalizeCodec(media.video?.codec);
  if (videoCodec && UNSUPPORTED_VIDEO_CODECS.has(videoCodec)) return true;

  const selectedAudio = chooseTranscodeAudioTrack(media.audio, audioLanguagePriority);
  const audioCodec = normalizeCodec(selectedAudio?.codec);
  return Boolean(audioCodec && UNSUPPORTED_AUDIO_CODECS.has(audioCodec));
}

export function chooseTranscodeAudioTrack(tracks: AudioTrackWithCodec[], languagePriority: string[]): AudioTrackWithCodec | undefined {
  return (choosePreferredAudioTrack(tracks, languagePriority) as AudioTrackWithCodec | undefined)
    || tracks.find((track) => track.default)
    || tracks[0];
}

export function buildHlsTranscodeArgs(options: {
  inputPath: string;
  outputDirectory: string;
  selectedAudio?: AudioTrackWithCodec;
  segmentSeconds: number;
  preset: string;
  crf: number;
  audioBitrate: string;
}): string[] {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    options.inputPath,
    '-map',
    '0:v:0'
  ];

  if (options.selectedAudio) {
    args.push('-map', `0:${options.selectedAudio.streamIndex}`);
  } else {
    args.push('-an');
  }

  args.push(
    '-sn',
    '-dn',
    '-c:v',
    'libx264',
    '-preset',
    options.preset,
    '-crf',
    String(options.crf),
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high'
  );

  if (options.selectedAudio) {
    args.push(
      '-c:a',
      'aac',
      '-b:a',
      options.audioBitrate,
      '-ac',
      '2'
    );
  }

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(options.segmentSeconds),
    '-hls_list_size',
    '0',
    '-hls_playlist_type',
    'event',
    '-hls_segment_type',
    'mpegts',
    '-hls_segment_filename',
    path.join(options.outputDirectory, 'segment-%05d.ts'),
    path.join(options.outputDirectory, 'index.m3u8')
  );
  return args;
}

export async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return fs.existsSync(filePath);
}

function transcodeSessionKey(jobId: string, inputPath: string, selectedAudio: AudioTrackWithCodec | undefined, config: TranscodeConfig): string {
  const stat = fs.statSync(inputPath);
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      jobId,
      inputPath,
      size: stat.size,
      mtimeMs: Math.floor(stat.mtimeMs),
      audio: selectedAudio?.streamIndex ?? -1,
      segmentSeconds: config.segmentSeconds,
      preset: config.preset,
      crf: config.crf,
      audioBitrate: config.audioBitrate
    }))
    .digest('hex')
    .slice(0, 32);
}

function playlistFinished(playlistPath: string): boolean {
  try {
    return fs.readFileSync(playlistPath, 'utf8').includes('#EXT-X-ENDLIST');
  } catch {
    return false;
  }
}

function normalizeCodec(value: string | undefined): string | undefined {
  const normalized = (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!normalized) return undefined;
  if (['h265', 'x265', 'hev1', 'hvc1'].includes(normalized)) return 'hevc';
  if (['dca'].includes(normalized)) return 'dts';
  if (['a52'].includes(normalized)) return 'ac3';
  return normalized;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim());
}
