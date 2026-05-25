import { parseResolution, type RankedCandidate } from '@xcache/core';

const ADDON_LABEL = 'XCACHE';

export function streamName(resolution: string | undefined, cached: boolean): string {
  return [cached ? '[⚡]' : '[⬇️]', ADDON_LABEL, resolution].filter(Boolean).join('\n');
}

export function localStreamName(fileName: string, torrentName?: string): string {
  return streamName(parseResolution(`${fileName}\n${torrentName || ''}`), true);
}

export function candidateStreamTitle(candidate: RankedCandidate): string {
  const title = appendLanguageFlags(cleanStreamTitle(candidate.title || candidate.name), candidate.languages);
  if (title) return title;

  const details = [
    candidate.provider,
    candidate.resolution,
    candidate.languages.join('/'),
    candidate.seeders ? `${candidate.seeders} seeders` : undefined
  ].filter(Boolean).join(' • ');

  return appendLanguageFlags([candidate.name, details].filter(Boolean).join('\n'), candidate.languages);
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

function appendLanguageFlags(title: string, languages: string[]): string {
  const missingFlags = [...new Set(languages.map(languageFlag).filter(isString))]
    .filter((flag) => !title.includes(flag));
  if (!missingFlags.length) return title;

  const lines = title.split('\n');
  const globeLineIndex = lines.findIndex((line) => line.trim().startsWith('🌐'));
  if (globeLineIndex >= 0) {
    lines[globeLineIndex] = `${lines[globeLineIndex]} ${missingFlags.join(' ')}`.trim();
    return lines.join('\n');
  }

  return [title, `🌐 ${missingFlags.join(' ')}`].filter(Boolean).join('\n');
}

function languageFlag(language: string): string | undefined {
  const normalized = language.toLowerCase().replace('_', '-');
  if (normalized === 'pt-br' || normalized === 'pt' || normalized === 'por') return '🇧🇷';
  if (normalized === 'pt-pt') return '🇵🇹';
  if (normalized === 'en' || normalized === 'eng' || normalized === 'english') return '🇬🇧';
  if (normalized === 'es' || normalized === 'spa' || normalized === 'spanish') return '🇪🇸';
  if (normalized === 'de' || normalized === 'ger' || normalized === 'german') return '🇩🇪';
  return undefined;
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}
