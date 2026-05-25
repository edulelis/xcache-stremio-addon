import { describe, expect, it } from 'vitest';
import { isTorrentReferenceUrl, torrentReference } from './torrent-reference.js';

describe('torrentReference', () => {
  it('uses magnet URLs directly', () => {
    expect(torrentReference({ magnetUrl: `magnet:?xt=urn:btih:${'a'.repeat(40)}` })).toBe(
      `magnet:?xt=urn:btih:${'a'.repeat(40)}`
    );
  });

  it('accepts direct torrent URLs', () => {
    expect(torrentReference({ url: 'https://tracker.example.com/movie.torrent?download=1' })).toBe(
      'https://tracker.example.com/movie.torrent?download=1'
    );
  });

  it('falls back to infoHash instead of upstream playback URLs', () => {
    expect(torrentReference({
      url: 'https://comet.example.com/config/playback/hash/0/n/n/n',
      infoHash: 'b'.repeat(40)
    })).toBe(`magnet:?xt=urn:btih:${'b'.repeat(40)}`);
  });

  it('rejects non-torrent HTTP playback URLs when no infoHash exists', () => {
    expect(torrentReference({ url: 'https://comet.example.com/config/playback/hash/0/n/n/n' })).toBeUndefined();
    expect(isTorrentReferenceUrl('https://comet.example.com/config/playback/hash/0/n/n/n')).toBe(false);
  });
});
