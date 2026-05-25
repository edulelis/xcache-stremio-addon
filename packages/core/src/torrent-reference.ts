import type { StreamCandidate } from './types.js';

export function torrentReference(candidate: Pick<StreamCandidate, 'magnetUrl' | 'url' | 'infoHash'>): string | undefined {
  if (candidate.magnetUrl?.startsWith('magnet:')) return candidate.magnetUrl;
  if (isTorrentReferenceUrl(candidate.url)) return candidate.url;
  return magnetFromInfoHash(candidate.infoHash);
}

export function magnetFromInfoHash(infoHash: string | undefined): string | undefined {
  return infoHash ? `magnet:?xt=urn:btih:${infoHash}` : undefined;
}

export function isTorrentReferenceUrl(url: string | undefined): url is string {
  if (!url) return false;
  return url.startsWith('magnet:') || /^https?:\/\/.+\.torrent(?:[?#].*)?$/i.test(url);
}
