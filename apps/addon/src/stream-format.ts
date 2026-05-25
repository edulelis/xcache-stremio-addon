import { parseResolution, type RankedCandidate } from '@xcache/core';

const ADDON_LABEL = 'XCACHE';

export function streamName(resolution: string | undefined, cached: boolean): string {
  return [cached ? '[XCACHE⚡]' : '[XCACHE⬇️]', ADDON_LABEL, resolution].filter(Boolean).join('\n');
}

export function localStreamName(fileName: string, torrentName?: string): string {
  return streamName(parseResolution(`${fileName}\n${torrentName || ''}`), true);
}

export function candidateStreamTitle(candidate: RankedCandidate): string {
  const title = cleanStreamTitle(candidate.title || candidate.name);
  if (title) return title;

  const details = [
    candidate.provider,
    candidate.resolution,
    candidate.languages.join('/'),
    candidate.seeders ? `${candidate.seeders} seeders` : undefined
  ].filter(Boolean).join(' • ');

  return [candidate.name, details].filter(Boolean).join('\n');
}

export function cleanStreamTitle(title: string): string {
  return title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isXcacheGeneratedLine(line))
    .join('\n');
}

function isXcacheGeneratedLine(line: string): boolean {
  return [
    /^baixar$/i,
    /^local cache via qbittorrent/i,
    /^💾\s*local cache$/i,
    /^💾\s*rd\s*•\s*local fallback$/i,
    /^🧲\s*qbittorrent$/i,
    /^[\w .-]+\s*•\s*(2160p|1080p|720p|480p)\b/i
  ].some((pattern) => pattern.test(line));
}
