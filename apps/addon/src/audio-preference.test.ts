import { describe, expect, it } from 'vitest';
import { buildMkvpropeditDefaultArgs, choosePreferredAudioTrack, type AudioTrack } from './audio-preference.js';

const priority = ['pt-BR', 'pt', 'por', 'pob', 'br', 'en', 'eng'];

describe('audio preference', () => {
  it('prefers Portuguese audio over English and native/default audio', () => {
    const tracks = [
      track(0, 'tur', 'Turkish', true),
      track(1, 'eng', 'English'),
      track(2, 'por', 'Portuguese Brazil')
    ];

    expect(choosePreferredAudioTrack(tracks, priority)).toMatchObject({ audioPosition: 2 });
  });

  it('prefers English when Portuguese is unavailable', () => {
    const tracks = [
      track(0, 'tur', 'Turkish', true),
      track(1, 'eng', 'English')
    ];

    expect(choosePreferredAudioTrack(tracks, priority)).toMatchObject({ audioPosition: 1 });
  });

  it('leaves the native/default audio alone when no preferred language exists', () => {
    const tracks = [
      track(0, 'tur', 'Turkish', true),
      track(1, 'deu', 'German')
    ];

    expect(choosePreferredAudioTrack(tracks, priority)).toBeUndefined();
  });

  it('builds mkvpropedit args that clear other default audio flags', () => {
    const tracks = [
      track(0, 'tur', 'Turkish', true),
      track(1, 'eng', 'English'),
      track(2, 'por', 'Portuguese Brazil')
    ];

    expect(buildMkvpropeditDefaultArgs('/cache/movie.mkv', tracks, tracks[2])).toEqual([
      '/cache/movie.mkv',
      '--edit',
      'track:a1',
      '--set',
      'flag-default=0',
      '--edit',
      'track:a2',
      '--set',
      'flag-default=0',
      '--edit',
      'track:a3',
      '--set',
      'flag-default=1'
    ]);
  });
});

function track(audioPosition: number, language: string, title: string, isDefault = false): AudioTrack {
  return {
    streamIndex: audioPosition + 1,
    audioPosition,
    language,
    title,
    default: isDefault
  };
}
