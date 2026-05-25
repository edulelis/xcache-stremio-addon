import type { MediaType, ParsedMediaId, StreamCandidate } from './types.js';
import { isTorrentReferenceUrl } from './torrent-reference.js';

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv', '.webm'];

export function parseMediaId(type: MediaType, raw: string): ParsedMediaId {
  const decoded = decodeURIComponent(raw);
  const tmdb = decoded.match(/tmdb:(\d+)/i);
  const imdb = decoded.match(/\btt\d{6,12}\b/i);
  const episode = decoded.match(/:(\d{1,3}):(\d{1,4})$/);

  return {
    type,
    raw,
    id: decoded,
    tmdbId: tmdb?.[1],
    imdbId: imdb?.[0].toLowerCase(),
    season: episode ? Number(episode[1]) : undefined,
    episode: episode ? Number(episode[2]) : undefined
  };
}

export function normalizeInfoHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const magnetHash = value.match(/btih:([a-f0-9]{40}|[a-z2-7]{32})/i);
  const rawHash = value.match(/\b([a-f0-9]{40}|[a-z2-7]{32})\b/i);
  return (magnetHash?.[1] || rawHash?.[1])?.toLowerCase();
}

export function parseResolution(text: string): string | undefined {
  const match = text.match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  if (!match) return undefined;
  return match[1].toLowerCase() === '4k' ? '2160p' : match[1].toLowerCase();
}

export function parseSeeders(text: string): number | undefined {
  const match = text.match(/(?:👤|seeders?|seeds?)\s*[: ]?\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

export function parseSizeBytes(text: string): number | undefined {
  const match = text.match(/\b(\d+(?:[.,]\d+)?)\s*(GB|GiB|MB|MiB)\b/i);
  if (!match) return undefined;
  const amount = Number(match[1].replace(',', '.'));
  const unit = match[2].toLowerCase();
  return Math.round(amount * (unit.startsWith('g') ? 1024 ** 3 : 1024 ** 2));
}

export function detectLanguages(text: string): string[] {
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const languages = new Set<string>();

  if (/\b(pt[-_ ]?br|portugues|brasil|dublado|dublad[ao]|dual audio|dual)\b/i.test(normalized)) {
    languages.add('pt-BR');
  }
  if (/\b(english|ingles|eng|en)\b/i.test(normalized)) {
    languages.add('en');
  }
  if (/\b(spanish|espanol|español|latino|castellano|cinecalidad)\b/i.test(text.toLowerCase())) {
    languages.add('es');
  }
  if (/\b(german|alemao|aleman|deutsch)\b/i.test(normalized)) {
    languages.add('de');
  }
  return [...languages];
}

export function inferProvider(text: string, preferredProviders: string[] = []): string | undefined {
  for (const provider of preferredProviders) {
    if (new RegExp(escapeRegExp(provider), 'i').test(text)) return provider;
  }
  const known = ['Comando', 'MicoLeaoDublado', 'BluDV', 'Cinecalidad', 'Torrentio', 'Comet'];
  return known.find((provider) => new RegExp(escapeRegExp(provider), 'i').test(text));
}

export function videoExtensionFromPath(filePath: string): string | undefined {
  const lower = filePath.toLowerCase();
  return VIDEO_EXTENSIONS.find((extension) => lower.endsWith(extension));
}

export function normalizeStremioStream(raw: Record<string, unknown>, source: string, preferredProviders: string[] = []): StreamCandidate {
  const title = String(raw.title || raw.description || '');
  const name = String(raw.name || source);
  const combined = `${name}\n${title}`;
  const infoHash = normalizeInfoHash(String(raw.infoHash || raw.url || ''));
  const url = typeof raw.url === 'string' ? raw.url : undefined;

  return {
    source,
    name,
    title,
    infoHash,
    magnetUrl: url?.startsWith('magnet:') ? url : undefined,
    url,
    fileIdx: typeof raw.fileIdx === 'number' ? raw.fileIdx : undefined,
    sizeBytes: parseSizeBytes(combined),
    seeders: parseSeeders(combined),
    resolution: parseResolution(combined),
    languages: detectLanguages(combined),
    provider: inferProvider(combined, preferredProviders),
    isDownloadable: Boolean(infoHash || isTorrentReferenceUrl(url)),
    raw
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
