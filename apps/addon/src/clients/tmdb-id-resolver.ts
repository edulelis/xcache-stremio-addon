import type { MediaType, ParsedMediaId } from '@xcache/core';

export interface TmdbIdResolverOptions {
  apiKey?: string;
  readAccessToken?: string;
  baseUrl?: string;
  timeoutMs: number;
  cacheTtlMs: number;
}

interface CachedId {
  imdbId: string;
  expiresAt: number;
}

export class TmdbIdResolver {
  private readonly cache = new Map<string, CachedId>();
  private readonly baseUrl: string;

  constructor(private readonly options: TmdbIdResolverOptions) {
    this.baseUrl = (options.baseUrl || 'https://api.themoviedb.org/3').replace(/\/$/, '');
  }

  async resolveStreamId(type: MediaType, parsed: ParsedMediaId): Promise<string | undefined> {
    if (parsed.imdbId || !parsed.tmdbId || (!this.options.apiKey && !this.options.readAccessToken)) {
      return undefined;
    }

    const imdbId = await this.resolveImdbId(type, parsed.tmdbId);
    if (!imdbId) return undefined;

    const suffix = parsed.season !== undefined && parsed.episode !== undefined
      ? `:${parsed.season}:${parsed.episode}`
      : '';
    return `${imdbId}${suffix}`;
  }

  private async resolveImdbId(type: MediaType, tmdbId: string): Promise<string | undefined> {
    const mediaPath = type === 'series' ? 'tv' : 'movie';
    const cacheKey = `${mediaPath}:${tmdbId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.imdbId;
    this.cache.delete(cacheKey);

    const url = new URL(`${this.baseUrl}/${mediaPath}/${encodeURIComponent(tmdbId)}/external_ids`);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.options.readAccessToken) {
      headers.Authorization = `Bearer ${this.options.readAccessToken}`;
    } else if (this.options.apiKey) {
      url.searchParams.set('api_key', this.options.apiKey);
    }

    const response = await fetchWithTimeout(url, headers, this.options.timeoutMs);
    if (!response.ok) return undefined;

    const payload = await response.json() as { imdb_id?: unknown };
    const imdbId = typeof payload.imdb_id === 'string' && /^tt\d{6,12}$/i.test(payload.imdb_id)
      ? payload.imdb_id.toLowerCase()
      : undefined;
    if (imdbId && this.options.cacheTtlMs > 0) {
      this.cache.set(cacheKey, {
        imdbId,
        expiresAt: Date.now() + this.options.cacheTtlMs
      });
    }
    return imdbId;
  }
}

async function fetchWithTimeout(url: URL, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
