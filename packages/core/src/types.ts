export type MediaType = 'movie' | 'series';

export type RdMode = 'off' | 'cached_only' | 'rd_plus_local' | 'local_first';

export interface ParsedMediaId {
  type: MediaType;
  raw: string;
  id: string;
  imdbId?: string;
  tmdbId?: string;
  season?: number;
  episode?: number;
}

export interface StreamCandidate {
  source: string;
  name: string;
  title: string;
  infoHash?: string;
  magnetUrl?: string;
  url?: string;
  fileIdx?: number;
  sizeBytes?: number;
  seeders?: number;
  resolution?: string;
  languages: string[];
  provider?: string;
  isCachedLocal?: boolean;
  isCachedRd?: boolean;
  isDownloadable?: boolean;
  nativeLanguage?: string;
  raw?: unknown;
}

export interface FilterOptions {
  allowedResolutions: string[];
  preferredLanguages: string[];
  blockedProviders: string[];
  blockedQualityTags: string[];
  preferredProviders: string[];
  allowSpanishNative: boolean;
  nativeLanguage?: string;
}

export interface RankedCandidate extends StreamCandidate {
  rank: number;
  rejectionReason?: string;
}

export interface CacheEntry {
  id: string;
  mediaId: string;
  mediaType: MediaType;
  season?: number;
  episode?: number;
  path: string;
  sizeBytes: number;
  status: 'ready' | 'downloading' | 'error';
  lastAccessedAt: number;
  createdAt: number;
  pinned?: boolean;
  active?: boolean;
}

export interface EvictionPlan {
  deleteIds: string[];
  bytesToDelete: number;
}
