# XCACHE Stremio Addon

XCACHE is a self-hosted Stremio addon that turns torrent streams into a local cache. It can use Real-Debrid as an optional accelerator, but it is designed to keep working through local qBittorrent when RD is unavailable or slow.

This project does not provide a hosted backend. You run the addon, qBittorrent and cache storage on your own server.

## What It Does

- Adds Stremio streams named `[⚡] / XCACHE` for cached options and `[⬇️] / XCACHE` for qBittorrent fallback options.
- Prioritizes local cache, then RD, then qBittorrent local download.
- Starts local qBittorrent downloads in the background and plays a live-ish HLS status video while the file is not ready yet.
- Filters/ranks streams for PT-BR-first workflows.
- Excludes `2160p` by default.
- Blocks `Cinecalidad` by default unless native Spanish handling is enabled.
- Keeps cache inside `CACHE_DIR` and evicts least-recently-used files above the configured limit.

## Quick Start

```bash
git clone https://github.com/your-user/xcache-stremio-addon.git
cd xcache-stremio-addon
cp .env.example .env
```

Edit `.env`, then start:

```bash
docker compose -f docker-compose.example.yml up -d --build
```

Generate your install token:

```bash
docker compose -f docker-compose.example.yml build xcache-addon
docker compose -f docker-compose.example.yml run --rm xcache-addon npm run print-token
```

Install this URL in Stremio:

```text
https://xcache.example.com/<your-install-token>/manifest.json
```

Replace `https://xcache.example.com` with your own public domain or tunnel.

## Stream Sources

Set `SCRAPER_STREAM_URLS` to one or more Stremio-compatible stream endpoint templates:

```env
SCRAPER_STREAM_URLS=https://your-source.example/stream/{type}/{id}.json
```

The addon expects each source to return a normal Stremio stream response with a `streams` array. Any source that exposes `infoHash`, magnet URLs, or torrent URLs can be used.

XCACHE keeps a short in-memory cache of source stream results so Stremio refreshes do not repeatedly hit slower upstream addons. Tune it with `XCACHE_STREAM_CACHE_TTL_MS`.

Source calls are bounded by `XCACHE_SCRAPER_TIMEOUT_MS`. When a local cached stream already exists, XCACHE waits up to `XCACHE_LOCAL_STREAM_SEARCH_WAIT_MS` for the source list so the `[⚡]` local stream and the remaining torrent options can appear together; if the source is slower than that, XCACHE returns the local stream immediately and keeps warming the torrent list in the background.

When Real-Debrid is enabled, XCACHE checks instant availability in batches and keeps a short in-memory cache. By default this check runs in the background so stream listing is not blocked by RD latency. Tune that cache with `XCACHE_RD_AVAILABILITY_CACHE_TTL_MS`, or set `XCACHE_RD_AVAILABILITY_BLOCKING=true` if you prefer the initial list to wait for RD status.

## Local Playback

XCACHE only serves local files after qBittorrent reports that the selected video file is nearly complete. The default threshold is `XCACHE_LOCAL_READY_MIN_PROGRESS=0.98`.

If the stream is still downloading, XCACHE starts or resumes the qBittorrent job and redirects playback to a live-ish HLS status screen. The screen updates every `XCACHE_STATUS_SEGMENT_SECONDS` seconds with progress, download speed, seed count, ETA, source and resolution. It intentionally does not switch to the movie inside the same playback; once the screen says the download is complete, reopen the title and play the `[⚡]` local cache stream.

Set `XCACHE_STATUS_VIDEO_MODE=mp4_static` to disable dynamic HLS and use the static MP4 fallback on devices that do not handle live playlists well.

## Configure Page

The static configurator can be hosted on GitHub Pages. It only generates:

- a manifest URL for your own server;
- a public `.env` snippet for non-secret preferences.

It does not store secrets and does not use a shared XCACHE backend.

## Development

```bash
npm install
npm test
npm run lint
npm run build
```

Run the addon locally:

```bash
npm run dev:addon
```

## Security

Never put Real-Debrid tokens, qBittorrent credentials, install token secrets, cookies or private manifests in GitHub Pages, README files, tests or issue comments. See [SECURITY.md](SECURITY.md).
