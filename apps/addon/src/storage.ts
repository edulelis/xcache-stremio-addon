import fs from 'node:fs';
import path from 'node:path';
import sqlite3Wasm from 'node-sqlite3-wasm';
import type { CacheEntry, MediaType, RankedCandidate } from '@xcache/core';

const { Database: WasmDatabase } = sqlite3Wasm;
type WasmDatabaseInstance = InstanceType<typeof WasmDatabase>;

export interface StoredJob extends CacheEntry {
  infoHash?: string;
  torrentName?: string;
  streamTitle?: string;
  source?: string;
  rdStatus?: string;
  error?: string;
}

export interface StoredStreamCandidates {
  candidates: RankedCandidate[];
  expiresAt: number;
}

export interface StoredPlayIntent<TPayload> {
  payload: TPayload;
  expiresAt: number;
}

type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
};

type StatementSync = {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): unknown;
};

export class XCacheStore {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(dbPath: string): Promise<XCacheStore> {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new SqliteDatabaseAdapter(new WasmDatabase(dbPath));
    const store = new XCacheStore(db);
    store.migrate();
    return store;
  }

  findReady(mediaType: MediaType, mediaId: string, season?: number, episode?: number): StoredJob | undefined {
    const row = this.db.prepare(`
      SELECT * FROM jobs
      WHERE media_type = ? AND media_id = ? AND status = 'ready'
        AND COALESCE(season, -1) = COALESCE(?, -1)
        AND COALESCE(episode, -1) = COALESCE(?, -1)
      ORDER BY last_accessed_at DESC
      LIMIT 1
    `).get(mediaType, mediaId, season ?? null, episode ?? null);
    return row ? fromRow(row) : undefined;
  }

  findActiveDownloads(mediaType: MediaType, mediaId: string, season?: number, episode?: number): StoredJob[] {
    return this.db.prepare(`
      SELECT * FROM jobs
      WHERE media_type = ? AND media_id = ? AND status = 'downloading' AND active = 1
        AND COALESCE(season, -1) = COALESCE(?, -1)
        AND COALESCE(episode, -1) = COALESCE(?, -1)
      ORDER BY last_accessed_at DESC
      LIMIT 10
    `).all(mediaType, mediaId, season ?? null, episode ?? null).map(fromRow);
  }

  listStaleDownloads(createdBefore: number, limit = 50): StoredJob[] {
    return this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'downloading' AND created_at < ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(createdBefore, limit).map(fromRow);
  }

  findById(id: string): StoredJob | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? fromRow(row) : undefined;
  }

  upsert(job: StoredJob): void {
    this.db.prepare(`
      INSERT INTO jobs (
        id, media_type, media_id, season, episode, info_hash, torrent_name, stream_title, source, file_path,
        size_bytes, status, rd_status, error, last_accessed_at, created_at, pinned, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        stream_title = COALESCE(excluded.stream_title, jobs.stream_title),
        file_path = excluded.file_path,
        size_bytes = excluded.size_bytes,
        status = excluded.status,
        rd_status = excluded.rd_status,
        error = excluded.error,
        last_accessed_at = excluded.last_accessed_at,
        pinned = excluded.pinned,
        active = excluded.active
    `).run(
      job.id,
      job.mediaType,
      job.mediaId,
      job.season ?? null,
      job.episode ?? null,
      job.infoHash ?? null,
      job.torrentName ?? null,
      job.streamTitle ?? null,
      job.source ?? null,
      job.path,
      job.sizeBytes,
      job.status,
      job.rdStatus ?? null,
      job.error ?? null,
      job.lastAccessedAt,
      job.createdAt,
      job.pinned ? 1 : 0,
      job.active ? 1 : 0
    );
  }

  touch(id: string): void {
    this.db.prepare('UPDATE jobs SET last_accessed_at = ? WHERE id = ?').run(Date.now(), id);
  }

  listCacheEntries(): CacheEntry[] {
    return this.db.prepare("SELECT * FROM jobs WHERE file_path != ''").all().map(fromRow);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  findStreamCandidates(key: string): StoredStreamCandidates | undefined {
    const row = this.db.prepare('SELECT payload, expires_at FROM stream_cache WHERE key = ?').get(key);
    if (!row) return undefined;

    const expiresAt = Number(row.expires_at);
    if (expiresAt <= Date.now()) {
      this.db.prepare('DELETE FROM stream_cache WHERE key = ?').run(key);
      return undefined;
    }

    try {
      const candidates = JSON.parse(String(row.payload)) as RankedCandidate[];
      return { candidates, expiresAt };
    } catch {
      this.db.prepare('DELETE FROM stream_cache WHERE key = ?').run(key);
      return undefined;
    }
  }

  upsertStreamCandidates(key: string, candidates: RankedCandidate[], expiresAt: number): void {
    this.db.prepare(`
      INSERT INTO stream_cache (key, payload, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(candidates), expiresAt, Date.now());
  }

  deleteStreamCandidates(key: string): void {
    this.db.prepare('DELETE FROM stream_cache WHERE key = ?').run(key);
  }

  findPlayIntent<TPayload>(id: string): StoredPlayIntent<TPayload> | undefined {
    const row = this.db.prepare('SELECT payload, expires_at FROM play_intents WHERE id = ?').get(id);
    if (!row) return undefined;

    const expiresAt = Number(row.expires_at);
    if (expiresAt <= Date.now()) {
      this.db.prepare('DELETE FROM play_intents WHERE id = ?').run(id);
      return undefined;
    }

    try {
      return { payload: JSON.parse(String(row.payload)) as TPayload, expiresAt };
    } catch {
      this.db.prepare('DELETE FROM play_intents WHERE id = ?').run(id);
      return undefined;
    }
  }

  upsertPlayIntent(id: string, payload: unknown, expiresAt: number): void {
    this.db.prepare(`
      INSERT INTO play_intents (id, payload, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(id, JSON.stringify(payload), expiresAt, Date.now());
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        media_type TEXT NOT NULL,
        media_id TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        info_hash TEXT,
        torrent_name TEXT,
        stream_title TEXT,
        source TEXT,
        file_path TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        rd_status TEXT,
        error TEXT,
        last_accessed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS jobs_media_lookup
        ON jobs(media_type, media_id, season, episode, status, last_accessed_at);

      CREATE TABLE IF NOT EXISTS stream_cache (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stream_cache_expires_at
        ON stream_cache(expires_at);

      CREATE TABLE IF NOT EXISTS play_intents (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS play_intents_expires_at
        ON play_intents(expires_at);
    `);
    this.addColumnIfMissing('jobs', 'stream_title', 'TEXT');
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
    if (!columns.includes(column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

class SqliteDatabaseAdapter implements DatabaseSync {
  constructor(private readonly db: WasmDatabaseInstance) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return new SqliteStatementAdapter(this.db, sql);
  }
}

class SqliteStatementAdapter implements StatementSync {
  constructor(
    private readonly db: WasmDatabaseInstance,
    private readonly sql: string
  ) {}

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.db.all(this.sql, bindParams(params)) as Record<string, unknown>[];
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.db.get(this.sql, bindParams(params)) as Record<string, unknown> | null ?? undefined;
  }

  run(...params: unknown[]): unknown {
    return this.db.run(this.sql, bindParams(params));
  }
}

function bindParams(params: unknown[]): Parameters<WasmDatabaseInstance['run']>[1] {
  if (params.length === 0) return undefined;
  const values = params.map((param) => {
    if (param === undefined) return null;
    if (
      param === null ||
      typeof param === 'string' ||
      typeof param === 'number' ||
      typeof param === 'bigint' ||
      typeof param === 'boolean' ||
      param instanceof Uint8Array
    ) {
      return param;
    }
    throw new TypeError(`Unsupported SQLite bind value: ${typeof param}`);
  });
  return values.length === 1 ? values[0] : values;
}

function fromRow(row: Record<string, unknown>): StoredJob {
  return {
    id: String(row.id),
    mediaType: row.media_type as MediaType,
    mediaId: String(row.media_id),
    season: row.season === null ? undefined : Number(row.season),
    episode: row.episode === null ? undefined : Number(row.episode),
    infoHash: row.info_hash ? String(row.info_hash) : undefined,
    torrentName: row.torrent_name ? String(row.torrent_name) : undefined,
    streamTitle: row.stream_title ? String(row.stream_title) : undefined,
    source: row.source ? String(row.source) : undefined,
    path: String(row.file_path || ''),
    sizeBytes: Number(row.size_bytes || 0),
    status: row.status as StoredJob['status'],
    rdStatus: row.rd_status ? String(row.rd_status) : undefined,
    error: row.error ? String(row.error) : undefined,
    lastAccessedAt: Number(row.last_accessed_at),
    createdAt: Number(row.created_at),
    pinned: Boolean(row.pinned),
    active: Boolean(row.active)
  };
}
