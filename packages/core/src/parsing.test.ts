import { describe, expect, it } from 'vitest';
import { detectLanguages, normalizeInfoHash, normalizeStremioStream, parseMediaId, parseResolution } from './parsing.js';

describe('parseMediaId', () => {
  it('parses tmdb movie ids', () => {
    expect(parseMediaId('movie', 'tmdb:1234821')).toMatchObject({
      type: 'movie',
      tmdbId: '1234821'
    });
  });

  it('parses imdb series episode ids', () => {
    expect(parseMediaId('series', 'tt1234567:2:8')).toMatchObject({
      type: 'series',
      imdbId: 'tt1234567',
      season: 2,
      episode: 8
    });
  });
});

describe('stream parsing', () => {
  it('normalizes info hashes from magnets', () => {
    expect(normalizeInfoHash('magnet:?xt=urn:btih:ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD')).toBe(
      'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );
  });

  it('detects pt-br dual audio and resolution', () => {
    const text = 'Jurassic.World.Recomeco.2025.1080p.WEB-DL.DUAL.5.1-Comando 12.5 GB 👤 84';
    expect(detectLanguages(text)).toContain('pt-BR');
    expect(parseResolution(text)).toBe('1080p');
    expect(normalizeStremioStream({ title: text, infoHash: 'a'.repeat(40) }, 'test', ['Comando'])).toMatchObject({
      provider: 'Comando',
      resolution: '1080p',
      seeders: 84
    });
  });
});
