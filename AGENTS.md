# AGENTS.md

This project is a public, self-hosted Stremio addon. Treat it as software that other people run on their own servers.

## Non-Negotiable Security Rules

- Never hardcode a personal domain, local filesystem path, API key, cookie, password, Real-Debrid token, qBittorrent credential, or install token.
- Examples must use `https://xcache.example.com` or `https://your-domain.example`.
- Do not commit real `.env` files, manifests containing secrets, request captures with auth headers, or test snapshots containing secrets.
- `apps/configure` must remain static and must not store or transmit secrets to any third-party service.
- Only `apps/addon` may talk to Real-Debrid, qBittorrent, torrent scrapers, or local cache storage.

## Architecture Rules

- Put pure logic in `packages/core`: parsing, filtering, ranking, cache eviction and small deterministic helpers.
- Keep HTTP/runtime orchestration in `apps/addon`.
- Keep the GitHub Pages configurator in `apps/configure`; it should only generate URLs and `.env` snippets for a user's own host.
- Prefer small interfaces around external services so tests can mock qBittorrent, Real-Debrid and stream sources.

## Product Rules

- Stream priority is: local complete cache > RD ready/cacheable > local qBittorrent fallback.
- RD is an accelerator, not a hard dependency. RD failure must not prevent local fallback.
- qBittorrent downloads must request sequential download and first/last piece priority.
- Cache cleanup may delete only inside the configured `CACHE_DIR`.
- Default stream filtering excludes `2160p` and blocks `Cinecalidad` unless native Spanish handling is explicitly enabled.

## Quality Bar

- Any change to parsing, filtering, ranking or cache eviction needs tests.
- Before opening a PR, run:
  - `npm test`
  - `npm run lint`
  - `npm run build`
- If public configuration changes, update `.env.example`, `README.md`, and `docs/self-hosting.md`.
- Check diffs for secrets before committing.
