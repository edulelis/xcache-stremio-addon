import type { FilterOptions, StreamCandidate } from './types.js';

export function rejectionReason(candidate: StreamCandidate, options: FilterOptions): string | undefined {
  const resolution = candidate.resolution?.toLowerCase();
  if (resolution && !options.allowedResolutions.map((item) => item.toLowerCase()).includes(resolution)) {
    return `resolution:${resolution}`;
  }

  const provider = candidate.provider?.toLowerCase();
  const blockedProvider = options.blockedProviders.find((item) => item.toLowerCase() === provider);
  if (blockedProvider) {
    if (provider === 'cinecalidad' && options.allowSpanishNative && options.nativeLanguage === 'es') {
      return undefined;
    }
    return `provider:${blockedProvider}`;
  }

  if (!candidate.isDownloadable && !candidate.isCachedLocal && !candidate.isCachedRd) {
    return 'not_downloadable';
  }

  return undefined;
}

export function filterCandidates(candidates: StreamCandidate[], options: FilterOptions): StreamCandidate[] {
  return candidates.filter((candidate) => !rejectionReason(candidate, options));
}
