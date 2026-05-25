# XCACHE Stremio Addon

XCACHE is a self-hosted Stremio addon that turns torrent streams into a local cache. It can use Real-Debrid as an optional accelerator, but it is designed to keep working through local qBittorrent when RD is unavailable or slow.

This project does not provide a hosted backend. You run the addon, qBittorrent and cache storage on your own server.

## What It Does

- Adds Stremio streams named `[⚡] / XCACHE` for cached options and `[⬇️] / XCACHE` for qBittorrent fallback options.
- Prioritizes local cache, then RD, then qBittorrent local download.
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
