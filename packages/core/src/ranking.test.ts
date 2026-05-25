import { describe, expect, it } from 'vitest';
import { rankCandidates } from './ranking.js';
import type { FilterOptions, StreamCandidate } from './types.js';

const options: FilterOptions = {
  allowedResolutions: ['1080p', '720p'],
  preferredLanguages: ['pt-BR', 'pt', 'en'],
  preferredProviders: ['Comando', 'MicoLeaoDublado', 'BluDV'],
  blockedProviders: ['Cinecalidad'],
  allowSpanishNative: false
};

describe('rankCandidates', () => {
  it('prioritizes local cache above RD and downloadable torrents', () => {
    const candidates: StreamCandidate[] = [
      candidate('download', { languages: ['pt-BR'], provider: 'Comando' }),
      candidate('rd', { isCachedRd: true, languages: ['pt-BR'], provider: 'Comando' }),
      candidate('local', { isCachedLocal: true, languages: ['en'] })
    ];

    expect(rankCandidates(candidates, options).map((item) => item.name)).toEqual(['local', 'rd', 'download']);
  });

  it('filters 2160p and non-native Cinecalidad', () => {
    const ranked = rankCandidates(
      [
        candidate('4k', { resolution: '2160p', languages: ['pt-BR'] }),
        candidate('cinecalidad', { provider: 'Cinecalidad', languages: ['es'], resolution: '1080p' }),
        candidate('ptbr', { provider: 'Comando', languages: ['pt-BR'], resolution: '1080p' })
      ],
      options
    );

    expect(ranked.map((item) => item.name)).toEqual(['ptbr']);
  });

  it('allows Cinecalidad only for native Spanish content when configured', () => {
    const ranked = rankCandidates(
      [candidate('cinecalidad', { provider: 'Cinecalidad', languages: ['es'], resolution: '1080p' })],
      { ...options, allowSpanishNative: true, nativeLanguage: 'es' }
    );

    expect(ranked).toHaveLength(1);
  });
});

function candidate(name: string, overrides: Partial<StreamCandidate> = {}): StreamCandidate {
  return {
    source: 'test',
    name,
    title: name,
    infoHash: 'a'.repeat(40),
    resolution: '1080p',
    languages: [],
    isDownloadable: true,
    ...overrides
  };
}
