import fs from 'node:fs';
import path from 'node:path';
import type { CacheEntry, MediaType } from '@xcache/core';

export interface StoredJob extends CacheEntry {
  infoHash?: string;
  torrentName?: string;
  streamTitle?: string;
  source?: string;
  rdStatus?: string;
  error?: string;
}

type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  };
};

export class XCacheStore {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(dbPath: string): Promise<XCacheStore> {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = await import('node:sqlite') as unknown as { DatabaseSync: new (path: string) => DatabaseSync };
    const db = new sqlite.DatabaseSync(dbPath);
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
