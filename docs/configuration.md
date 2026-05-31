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
- `TMDB_API_KEY`: optional TMDB v3 API key used to resolve `tmdb:` IDs to IMDb `tt` IDs before scraping sources.
- `TMDB_READ_ACCESS_TOKEN`: optional TMDB read access token alternative to `TMDB_API_KEY`.
- `XCACHE_TMDB_RESOLVER_TIMEOUT_MS`: TMDB ID resolver timeout. Defaults to `3000`.
- `XCACHE_TMDB_ID_CACHE_TTL_MS`: TMDB to IMDb ID cache TTL. Defaults to `86400000`.
- `SCRAPER_STREAM_URLS`: comma-separated Stremio stream endpoint templates.
- `XCACHE_STREAM_CACHE_TTL_MS`: source stream result cache TTL. Defaults to `600000`.
- `XCACHE_PLAY_INTENT_TTL_MS`: short playback URL intent TTL. Defaults to `86400000`.
- `XCACHE_SCRAPER_TIMEOUT_MS`: per-source request timeout. Defaults to `10000`.
- `XCACHE_LOCAL_STREAM_SEARCH_WAIT_MS`: max wait for source streams when a local cache stream already exists. Defaults to `2500`.
- `XCACHE_TRACKER_INJECTION_ENABLED`: injects public trackers into newly-started qBittorrent downloads. Defaults to `false`.
- `XCACHE_TRACKER_LIST_URL`: remote text file with one public tracker per line. Defaults to the `ngosang/trackerslist` best list when set in `.env.example`.
- `XCACHE_TRACKER_EXTRA_URLS`: comma-separated extra tracker URLs appended after the remote list.
- `XCACHE_TRACKER_MAX`: maximum trackers injected per torrent. Defaults to `30`.
- `XCACHE_TRACKER_REFRESH_MS`: tracker list cache TTL. Defaults to `86400000`.
- `XCACHE_TRACKER_FETCH_TIMEOUT_MS`: tracker list fetch timeout. Defaults to `5000`.
- `XCACHE_ALLOWED_RESOLUTIONS`: defaults to `1080p,720p`.
- `XCACHE_PREFERRED_LANGUAGES`: defaults to `pt-BR,pt,en`.
- `XCACHE_PREFERRED_PROVIDERS`: defaults to `Comando,MicoLeaoDublado,BluDV`.
- `XCACHE_BLOCKED_PROVIDERS`: defaults to `Cinecalidad`.
- `XCACHE_BLOCKED_QUALITY_TAGS`: low-quality release tags excluded before ranking. Defaults to CAM/TS/TeleSync/TeleCine/screener/workprint style tags.
- `XCACHE_ALLOW_SPANISH_NATIVE`: defaults to `false`.
- `CACHE_MAX_BYTES`: defaults to `100GiB`.
- `CACHE_MIN_FREE_BYTES`: defaults to `50GiB`.
- `XCACHE_AUDIO_DEFAULT_ENABLED`: enables default audio flag correction for completed local MKV files. Defaults to `false`.
- `XCACHE_AUDIO_LANGUAGE_PRIORITY`: preferred audio language order used only when audio correction is enabled. Defaults to empty.
- `XCACHE_FFPROBE_PATH`: ffprobe binary path. Defaults to `ffprobe`.
- `XCACHE_MKVPROPEDIT_PATH`: mkvpropedit binary path. Defaults to `mkvpropedit`.
