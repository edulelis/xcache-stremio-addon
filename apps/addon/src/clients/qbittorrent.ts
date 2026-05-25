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
    await this.request('/api/v2/torrents/add', { method: 'POST', body: form });
  }

  async listFiles(hash: string): Promise<QbittorrentFile[]> {
    const response = await this.request(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`);
    return await response.json() as QbittorrentFile[];
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

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
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
    if (!response.ok) throw new Error(`qBittorrent request failed: HTTP ${response.status}`);
    return response;
  }
}
