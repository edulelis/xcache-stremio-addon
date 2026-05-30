export interface TrackerProviderOptions {
  enabled: boolean;
  listUrl?: string;
  extraTrackers: string[];
  maxTrackers: number;
  refreshMs: number;
  timeoutMs: number;
}

interface CachedTrackers {
  trackers: string[];
  expiresAt: number;
}

const TRACKER_URL_PATTERN = /^(udp|https?):\/\/[^\s]+$/i;

export class TrackerProvider {
  private cached?: CachedTrackers;

  constructor(private readonly options: TrackerProviderOptions) {}

  async getTrackers(): Promise<string[]> {
    if (!this.options.enabled) return [];

    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.trackers;

    const extraTrackers = parseTrackerList(this.options.extraTrackers.join('\n'), this.options.maxTrackers);
    try {
      const remoteList = this.options.listUrl
        ? await fetchTrackerList(this.options.listUrl, this.options.timeoutMs)
        : '';
      const trackers = parseTrackerList(`${remoteList}\n${extraTrackers.join('\n')}`, this.options.maxTrackers);
      this.cached = {
        trackers,
        expiresAt: now + this.options.refreshMs
      };
      return trackers;
    } catch (error) {
      if (this.cached) return this.cached.trackers;
      return extraTrackers;
    }
  }
}

export function parseTrackerList(value: string, maxTrackers = 30): string[] {
  const seen = new Set<string>();
  const trackers: string[] = [];
  for (const rawLine of value.split(/\r?\n|,/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !TRACKER_URL_PATTERN.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    trackers.push(line);
    if (trackers.length >= maxTrackers) break;
  }
  return trackers;
}

async function fetchTrackerList(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'text/plain' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`tracker list HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}
