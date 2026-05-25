import { rejectionReason } from './filtering.js';
import type { FilterOptions, RankedCandidate, StreamCandidate } from './types.js';

export function rankCandidate(candidate: StreamCandidate, options: FilterOptions): number {
  let rank = 0;
  const languages = candidate.languages.map((language) => language.toLowerCase());

  if (candidate.isCachedLocal) rank += 100_000;
  if (candidate.isCachedRd) rank += 60_000;

  for (let index = 0; index < options.preferredLanguages.length; index += 1) {
    const preferred = options.preferredLanguages[index].toLowerCase();
    if (languages.includes(preferred)) rank += 20_000 - index * 1500;
  }

  if (candidate.nativeLanguage && languages.includes(candidate.nativeLanguage.toLowerCase())) {
    rank += 8_000;
  }

  const providerIndex = candidate.provider
    ? options.preferredProviders.findIndex((provider) => provider.toLowerCase() === candidate.provider?.toLowerCase())
    : -1;
  if (providerIndex >= 0) rank += 6_000 - providerIndex * 500;

  if (candidate.resolution === '1080p') rank += 2_000;
  if (candidate.resolution === '720p') rank += 1_000;
  if (candidate.seeders) rank += Math.min(candidate.seeders, 500);
  if (candidate.sizeBytes) rank -= Math.min(Math.floor(candidate.sizeBytes / (1024 ** 3)), 80);

  return rank;
}

export function rankCandidates(candidates: StreamCandidate[], options: FilterOptions): RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      rank: rankCandidate(candidate, options),
      rejectionReason: rejectionReason(candidate, options)
    }))
    .filter((candidate) => !candidate.rejectionReason)
    .sort((left, right) => right.rank - left.rank);
}
