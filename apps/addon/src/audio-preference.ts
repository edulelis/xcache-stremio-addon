import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const appliedFiles = new Set<string>();
const inflight = new Map<string, Promise<AudioPreferenceResult>>();

export interface AudioPreferenceOptions {
  enabled: boolean;
  languagePriority: string[];
  ffprobePath: string;
  mkvpropeditPath: string;
}

export interface AudioPreferenceResult {
  changed: boolean;
  reason: string;
  selected?: AudioTrack;
}

export interface AudioTrack {
  streamIndex: number;
  audioPosition: number;
  language?: string;
  title?: string;
  default: boolean;
}

interface FfprobePayload {
  streams?: Array<{
    index?: number;
    codec_type?: string;
    disposition?: { default?: number };
    tags?: Record<string, string>;
  }>;
}

export async function ensurePreferredAudioDefault(
  filePath: string,
  options: AudioPreferenceOptions,
  complete = true
): Promise<AudioPreferenceResult> {
  if (!options.enabled) return { changed: false, reason: 'disabled' };
  if (!complete) return { changed: false, reason: 'not_complete' };
  if (!isMkv(filePath)) return { changed: false, reason: 'unsupported_container' };
  if (appliedFiles.has(filePath)) return { changed: false, reason: 'already_checked' };

  const existing = inflight.get(filePath);
  if (existing) return existing;

  const job = applyPreferredAudioDefault(filePath, options)
    .finally(() => inflight.delete(filePath));
  inflight.set(filePath, job);
  return job;
}

export function choosePreferredAudioTrack(tracks: AudioTrack[], languagePriority: string[]): AudioTrack | undefined {
  const priority = languagePriority.map(normalizeLanguage).filter(Boolean);
  if (!priority.length) return undefined;

  const scored = tracks
    .map((track) => ({ track, score: audioTrackScore(track, priority) }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => left.score - right.score || left.track.audioPosition - right.track.audioPosition);

  return scored[0]?.track;
}

export function buildMkvpropeditDefaultArgs(filePath: string, tracks: AudioTrack[], selected: AudioTrack): string[] {
  const args = [filePath];
  for (const track of tracks) {
    args.push('--edit', `track:a${track.audioPosition + 1}`, '--set', `flag-default=${track.audioPosition === selected.audioPosition ? '1' : '0'}`);
  }
  return args;
}

async function applyPreferredAudioDefault(filePath: string, options: AudioPreferenceOptions): Promise<AudioPreferenceResult> {
  const tracks = await probeAudioTracks(filePath, options.ffprobePath);
  if (tracks.length < 2) {
    appliedFiles.add(filePath);
    return { changed: false, reason: 'single_or_no_audio' };
  }

  const selected = choosePreferredAudioTrack(tracks, options.languagePriority);
  if (!selected) {
    appliedFiles.add(filePath);
    return { changed: false, reason: 'no_preferred_audio' };
  }

  const alreadyDefault = selected.default && tracks.every((track) => track === selected || !track.default);
  if (alreadyDefault) {
    appliedFiles.add(filePath);
    return { changed: false, reason: 'already_default', selected };
  }

  const args = buildMkvpropeditDefaultArgs(filePath, tracks, selected);
  await execFileAsync(options.mkvpropeditPath, args, { timeout: 30_000 });
  appliedFiles.add(filePath);
  return { changed: true, reason: 'updated', selected };
}

async function probeAudioTracks(filePath: string, ffprobePath: string): Promise<AudioTrack[]> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v',
    'error',
    '-show_streams',
    '-select_streams',
    'a',
    '-of',
    'json',
    filePath
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const payload = JSON.parse(stdout) as FfprobePayload;
  return (payload.streams || [])
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream, audioPosition) => {
      const tags = stream.tags || {};
      return {
        streamIndex: Number(stream.index ?? audioPosition),
        audioPosition,
        language: firstString(tags.language, tags.LANGUAGE, tags.Language),
        title: firstString(tags.title, tags.TITLE, tags.handler_name),
        default: stream.disposition?.default === 1
      };
    });
}

function audioTrackScore(track: AudioTrack, priority: string[]): number {
  const candidates = [
    normalizeLanguage(track.language),
    ...words(track.title).map(normalizeLanguage)
  ].filter(Boolean);

  const indexes = candidates
    .map((candidate) => priority.indexOf(candidate))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function normalizeLanguage(value: string | undefined): string {
  const normalized = (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '');

  if (['ptbr', 'pt', 'por', 'pob', 'br', 'bra', 'portuguese', 'portugues', 'brazilian', 'brasil', 'brazil'].includes(normalized)) return 'pt';
  if (['en', 'eng', 'english', 'ingles'].includes(normalized)) return 'en';
  if (['tr', 'tur', 'turkish', 'turco'].includes(normalized)) return 'tr';
  if (['de', 'ger', 'deu', 'german', 'alemao'].includes(normalized)) return 'de';
  if (['es', 'spa', 'spanish', 'espanhol'].includes(normalized)) return 'es';
  return normalized;
}

function words(value: string | undefined): string[] {
  return (value || '').split(/[^A-Za-zÀ-ÿ0-9]+/).filter(Boolean);
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim());
}

function isMkv(filePath: string): boolean {
  return ['.mkv', '.mka', '.mks'].includes(path.extname(filePath).toLowerCase());
}
