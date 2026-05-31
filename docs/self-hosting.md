# Self-Hosting XCACHE

XCACHE is optimized for Brazilian Portuguese stream workflows, but it is self-hosted infrastructure: you provide your own server, qBittorrent, cache storage, optional debrid token, and Stremio-compatible stream sources.

## Requirements

- Node.js 22+ for local development.
- Docker and Docker Compose for the recommended deployment.
- A public HTTPS URL, for example `https://xcache.example.com`.
- Optional Real-Debrid API token.

## 1. Configure Environment

```bash
cp .env.example .env
```

Required values:

```env
PUBLIC_BASE_URL=https://xcache.example.com
BASE_PATH=
INSTALL_TOKEN_SECRET=replace-with-random-secret
QBITTORRENT_URL=http://qbittorrent:8080
QBITTORRENT_USER=xcache
QBITTORRENT_PASS=replace-with-qbittorrent-password
CACHE_DIR=/cache
CACHE_MAX_BYTES=100GiB
CACHE_MIN_FREE_BYTES=50GiB
```

Optional RD:

```env
REAL_DEBRID_API_TOKEN=
RD_MODE=rd_plus_local
```

## 2. Configure Stream Sources

XCACHE consumes Stremio-compatible stream endpoints:

```env
SCRAPER_STREAM_URLS=https://your-source.example/stream/{type}/{id}.json
```

Multiple templates can be comma-separated.

For Brazilian Portuguese usage, choose source addons or private indexers that expose PT-BR releases. XCACHE ranks PT-BR and dual-audio results first by default, but it only works with streams returned by the sources you configure.

## 3. Optional Tracker Injection

XCACHE can add public trackers to each new qBittorrent download. This may help public torrents find more peers, but it cannot create seeders for dead torrents.

```env
XCACHE_TRACKER_INJECTION_ENABLED=true
XCACHE_TRACKER_LIST_URL=https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt
XCACHE_TRACKER_EXTRA_URLS=
XCACHE_TRACKER_MAX=30
```

## 4. Start Services

```bash
docker compose -f docker-compose.example.yml up -d --build
```

The compose file exposes only the addon and the BitTorrent peer port. qBittorrent WebUI stays internal through Docker networking.

## 5. Generate Install Token

```bash
docker compose -f docker-compose.example.yml build xcache-addon
docker compose -f docker-compose.example.yml run --rm xcache-addon npm run print-token
```

Install this in Stremio:

```text
https://xcache.example.com/<token>/manifest.json
```

## 6. Reverse Proxy

Put a reverse proxy in front of the addon:

```text
https://xcache.example.com -> http://127.0.0.1:7331
```

Use HTTPS. Stremio clients outside your LAN need a public domain or tunnel.

## 7. Cache Policy

Default cache policy:

- `CACHE_MAX_BYTES=100GiB`
- `CACHE_MIN_FREE_BYTES=50GiB`
- LRU cleanup deletes only ready, inactive, unpinned entries.

The addon stores metadata in SQLite at `CACHE_DB_PATH`.

Incomplete downloads older than `XCACHE_STALE_DOWNLOAD_MAX_AGE_MS` are removed from qBittorrent by the addon cleanup loop. The default is 10.5 days, with partial files deleted.
