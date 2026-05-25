export class RealDebridClient {
  constructor(
    private readonly apiToken: string,
    private readonly baseUrl = 'https://api.real-debrid.com/rest/1.0'
  ) {}

  async isInstantAvailable(infoHash: string): Promise<boolean> {
    return await this.isSingleInstantAvailable(infoHash.toLowerCase());
  }

  async instantAvailability(infoHashes: string[]): Promise<Set<string>> {
    const uniqueHashes = [...new Set(infoHashes.map((hash) => hash.toLowerCase()).filter(Boolean))];
    if (!uniqueHashes.length) return new Set();
    if (uniqueHashes.length === 1) {
      return await this.isSingleInstantAvailable(uniqueHashes[0]) ? new Set([uniqueHashes[0]]) : new Set();
    }

    const path = uniqueHashes.map((hash) => encodeURIComponent(hash)).join('/');
    let data: unknown;
    try {
      data = await this.requestJson(`/torrents/instantAvailability/${path}`);
    } catch (error) {
      if (!String(error).includes('disabled_endpoint')) throw error;
      return await this.instantAvailabilityIndividually(uniqueHashes);
    }
    return parseInstantAvailability(data);
  }

  private async instantAvailabilityIndividually(infoHashes: string[]): Promise<Set<string>> {
    const available = new Set<string>();
    const concurrency = 4;

    for (let index = 0; index < infoHashes.length; index += concurrency) {
      const chunk = infoHashes.slice(index, index + concurrency);
      const results = await Promise.all(chunk.map(async (hash) => {
        try {
          return await this.isSingleInstantAvailable(hash) ? hash : undefined;
        } catch {
          return undefined;
        }
      }));
      for (const hash of results) {
        if (hash) available.add(hash);
      }
    }
    return available;
  }

  private async isSingleInstantAvailable(infoHash: string): Promise<boolean> {
    const data = await this.requestJson(`/torrents/instantAvailability/${encodeURIComponent(infoHash)}`);
    return parseInstantAvailability(data).has(infoHash.toLowerCase());
  }

  async addMagnet(magnetUrl: string): Promise<string> {
    const body = new URLSearchParams({ magnet: magnetUrl });
    const data = await this.requestJson('/torrents/addMagnet', { method: 'POST', body });
    if (!data || typeof data !== 'object' || !('id' in data)) {
      throw new Error('Real-Debrid addMagnet returned no torrent id');
    }
    return String((data as { id: unknown }).id);
  }

  async selectFiles(torrentId: string, fileIds: string): Promise<void> {
    const body = new URLSearchParams({ files: fileIds });
    await this.request(`/torrents/selectFiles/${encodeURIComponent(torrentId)}`, { method: 'POST', body });
  }

  async torrentInfo(torrentId: string): Promise<{ links: string[] }> {
    const data = await this.requestJson(`/torrents/info/${encodeURIComponent(torrentId)}`);
    const links = data && typeof data === 'object' && Array.isArray((data as { links?: unknown }).links)
      ? (data as { links: unknown[] }).links.map(String)
      : [];
    return { links };
  }

  async unrestrict(link: string): Promise<string> {
    const body = new URLSearchParams({ link });
    const data = await this.requestJson('/unrestrict/link', { method: 'POST', body });
    if (!data || typeof data !== 'object' || !('download' in data)) {
      throw new Error('Real-Debrid unrestrict returned no download link');
    }
    return String((data as { download: unknown }).download);
  }

  private async requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.request(path, init);
    return await response.json();
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${this.apiToken}`
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Real-Debrid request failed: HTTP ${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
    }
    return response;
  }
}

function parseInstantAvailability(data: unknown): Set<string> {
  const available = new Set<string>();
  if (!data || typeof data !== 'object') return available;

  for (const [hash, entry] of Object.entries(data as Record<string, unknown>)) {
    if (entry && typeof entry === 'object' && Object.keys(entry as Record<string, unknown>).length > 0) {
      available.add(hash.toLowerCase());
    }
  }
  return available;
}
