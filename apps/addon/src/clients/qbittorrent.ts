export interface QbittorrentAddOptions {
  magnetOrUrl: string;
  savePath: string;
  category?: string;
}

export interface QbittorrentFile {
  name: string;
  size: number;
  progress: number;
  priority: number;
}

export interface QbittorrentTorrentStatus {
  hash: string;
  name: string;
  progress: number;
  dlspeed: number;
  numSeeds: number;
  eta: number;
  state: string;
  size: number;
}

interface RequestOptions {
  okStatuses?: number[];
}

export class QbittorrentClient {
  private cookie = '';

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string
  ) {}

  async login(): Promise<void> {
    const body = new URLSearchParams({ username: this.username, password: this.password });
    const response = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!response.ok) throw new Error(`qBittorrent login failed: HTTP ${response.status}`);
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
  }

  async addTorrent(options: QbittorrentAddOptions): Promise<void> {
    const form = new FormData();
    form.set('urls', options.magnetOrUrl);
    form.set('savepath', options.savePath);
    form.set('category', options.category || 'xcache');
    form.set('sequentialDownload', 'true');
    form.set('firstLastPiecePrio', 'true');
    await this.request('/api/v2/torrents/add', { method: 'POST', body: form }, { okStatuses: [409] });
  }

  async addTrackers(hash: string, trackers: string[]): Promise<void> {
    if (trackers.length === 0) return;
    const body = new URLSearchParams({
      hash,
      urls: trackers.join('\n')
    });
    await this.request('/api/v2/torrents/addTrackers', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }

  async deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
    if (hashes.length === 0) return;
    const body = new URLSearchParams({
      hashes: hashes.join('|'),
      deleteFiles: String(deleteFiles)
    });
    await this.request('/api/v2/torrents/delete', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }

  async listFiles(hash: string): Promise<QbittorrentFile[]> {
    const response = await this.request(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`);
    return await response.json() as QbittorrentFile[];
  }

  async getTorrentStatus(hash: string): Promise<QbittorrentTorrentStatus | undefined> {
    const response = await this.request(`/api/v2/torrents/info?hashes=${encodeURIComponent(hash)}`);
    const data = await response.json() as unknown;
    const row = Array.isArray(data) ? data[0] : undefined;
    if (!row || typeof row !== 'object') return undefined;
    const record = row as Record<string, unknown>;
    return {
      hash: stringValue(record.hash) || hash,
      name: stringValue(record.name),
      progress: progressValue(record.progress),
      dlspeed: numberValue(record.dlspeed),
      numSeeds: numberValue(record.num_seeds),
      eta: numberValue(record.eta),
      state: stringValue(record.state),
      size: numberValue(record.size)
    };
  }

  async setFilePriority(hash: string, ids: number[], priority: number): Promise<void> {
    const body = new URLSearchParams({
      hash,
      id: ids.join('|'),
      priority: String(priority)
    });
    await this.request('/api/v2/torrents/filePrio', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  }

  private async request(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<Response> {
    if (!this.cookie) await this.login();
    let response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Cookie: this.cookie }
    });
    if (response.status === 403 || response.status === 401) {
      this.cookie = '';
      await this.login();
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), Cookie: this.cookie }
      });
    }
    if (options.okStatuses?.includes(response.status)) return response;
    if (!response.ok) throw new Error(`qBittorrent request failed: HTTP ${response.status}`);
    return response;
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function progressValue(value: unknown): number {
  const parsed = numberValue(value);
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}
