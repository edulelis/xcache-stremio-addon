# Configuration Reference

## Required

- `PUBLIC_BASE_URL`: public HTTPS base URL of your addon.
- `BASE_PATH`: optional path prefix if serving under a subpath, for example `/xcache`.
- `INSTALL_TOKEN_SECRET`: private secret used to derive your install token.
- `QBITTORRENT_URL`: internal qBittorrent Web API URL.
- `QBITTORRENT_USER`: qBittorrent WebUI username.
- `QBITTORRENT_PASS`: qBittorrent WebUI password.

## Optional

- `REAL_DEBRID_API_TOKEN`: enables RD acceleration when set.
- `RD_MODE`: `rd_plus_local`, `cached_only`, `local_first`, or `off`.
- `SCRAPER_STREAM_URLS`: comma-separated Stremio stream endpoint templates.
- `XCACHE_ALLOWED_RESOLUTIONS`: defaults to `1080p,720p`.
- `XCACHE_PREFERRED_LANGUAGES`: defaults to `pt-BR,pt,en`.
- `XCACHE_PREFERRED_PROVIDERS`: defaults to `Comando,MicoLeaoDublado,BluDV`.
- `XCACHE_BLOCKED_PROVIDERS`: defaults to `Cinecalidad`.
- `XCACHE_ALLOW_SPANISH_NATIVE`: defaults to `false`.
- `CACHE_MAX_BYTES`: defaults to `100GiB`.
- `CACHE_MIN_FREE_BYTES`: defaults to `50GiB`.
