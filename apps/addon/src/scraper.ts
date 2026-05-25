import { normalizeStremioStream, rankCandidates, type FilterOptions, type MediaType, type RankedCandidate } from '@xcache/core';

export class StremioSourceScraper {
  constructor(
    private readonly templates: string[],
    private readonly filterOptions: FilterOptions,
    private readonly timeoutMs = 5000
  ) {}

  async search(type: MediaType, id: string): Promise<RankedCandidate[]> {
    const all = await Promise.allSettled(
      this.templates.map(async (template) => {
        const url = template
          .replaceAll('{type}', encodeURIComponent(type))
          .replaceAll('{id}', encodeURIComponent(id));
        const response = await fetchWithTimeout(url, this.timeoutMs);
        if (!response.ok) throw new Error(`scraper HTTP ${response.status}: ${url}`);
        const payload = await response.json() as { streams?: Record<string, unknown>[] };
        return (payload.streams || []).map((stream) => normalizeStremioStream(stream, sourceName(url), this.filterOptions.preferredProviders));
      })
    );

    const candidates = all.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    return rankCandidates(candidates, this.filterOptions);
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function sourceName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'source';
  }
}
