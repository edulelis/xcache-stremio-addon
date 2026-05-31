import { normalizeStremioStream, rankCandidates, type FilterOptions, type MediaType, type RankedCandidate, type StreamCandidate } from '@xcache/core';

export class StremioSourceScraper {
  constructor(
    private readonly templates: string[],
    private readonly filterOptions: FilterOptions,
    private readonly timeoutMs = 5000,
    private readonly settleMs = 750
  ) {}

  async search(type: MediaType, id: string): Promise<RankedCandidate[]> {
    if (this.templates.length === 0) return [];

    const all = await collectSourceResults(
      this.templates.map((template) => () => this.searchTemplate(template, type, id)),
      this.settleMs
    );

    const fulfilled = all.filter((result) => result.status === 'fulfilled');
    if (fulfilled.length === 0) {
      const failures = all
        .map((result, index) => result.status === 'rejected'
          ? `${sourceName(this.templates[index] || 'source')}: ${failureMessage(result.reason)}`
          : undefined)
        .filter(Boolean)
        .join('; ');
      throw new Error(`all scraper sources failed${failures ? ` (${failures})` : ''}`);
    }

    const candidates = fulfilled.flatMap((result) => result.value);
    return rankCandidates(candidates, this.filterOptions);
  }

  private async searchTemplate(template: string, type: MediaType, id: string): Promise<StreamCandidate[]> {
    const url = template
      .replaceAll('{type}', encodeURIComponent(type))
      .replaceAll('{id}', encodeURIComponent(id));
    const response = await fetchWithTimeout(url, this.timeoutMs);
    if (!response.ok) throw new Error(`scraper HTTP ${response.status}: ${url}`);
    const payload = await response.json() as { streams?: Record<string, unknown>[] };
    return (payload.streams || []).map((stream) => normalizeStremioStream(stream, sourceName(url), this.filterOptions.preferredProviders));
  }
}

async function collectSourceResults(
  tasks: Array<() => Promise<StreamCandidate[]>>,
  settleMs: number
): Promise<PromiseSettledResult<StreamCandidate[]>[]> {
  const results: PromiseSettledResult<StreamCandidate[]>[] = new Array(tasks.length);
  let settled = 0;
  let resolveDone: (value: PromiseSettledResult<StreamCandidate[]>[]) => void = () => undefined;
  const done = new Promise<PromiseSettledResult<StreamCandidate[]>[]>((resolve) => {
    resolveDone = resolve;
  });

  let settleTimer: NodeJS.Timeout | undefined;
  const finish = () => {
    if (settleTimer) clearTimeout(settleTimer);
    resolveDone(results.filter(Boolean));
  };

  tasks.forEach((task, index) => {
    task()
      .then((value) => {
        results[index] = { status: 'fulfilled', value };
        if (settleMs >= 0 && value.length > 0 && !settleTimer) {
          settleTimer = setTimeout(finish, settleMs);
        }
      })
      .catch((reason: unknown) => {
        results[index] = { status: 'rejected', reason };
      })
      .finally(() => {
        settled += 1;
        if (settled === tasks.length) finish();
      });
  });

  return done;
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

function failureMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}
