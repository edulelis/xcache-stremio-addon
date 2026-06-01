import { describe, expect, it } from 'vitest';
import {
  buildHlsTranscodeArgs,
  chooseTranscodeAudioTrack,
  isBrowserUserAgent,
  parseMediaInfo,
  requiresH264AacTranscode,
  shouldUseBrowserTranscode,
  type TranscodeConfig
} from './transcode.js';

const priority = ['pt-BR', 'pt', 'por', 'pob', 'br', 'en', 'eng'];
const config: TranscodeConfig = {
  mode: 'auto',
  cacheDir: '/tmp/xcache-transcode',
  segmentSeconds: 6,
  preset: 'veryfast',
  crf: 23,
  audioBitrate: '192k',
  audioLanguagePriority: priority,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe'
};

describe('browser HLS transcode', () => {
  it('detects browser user agents without forcing native players', () => {
    expect(isBrowserUserAgent('Mozilla/5.0 AppleWebKit Chrome/125 Safari/537.36')).toBe(true);
    expect(isBrowserUserAgent('Mozilla/5.0 Firefox/126')).toBe(true);
    expect(isBrowserUserAgent('ExoPlayerLib/2.19.1')).toBe(false);
    expect(isBrowserUserAgent('VLC/3.0.20 LibVLC/3.0.20')).toBe(false);
  });

  it('picks Portuguese audio before the file default', () => {
    const media = parseMediaInfo({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264' },
        { index: 1, codec_type: 'audio', codec_name: 'aac', disposition: { default: 1 }, tags: { language: 'tur', title: 'Turkish' } },
        { index: 2, codec_type: 'audio', codec_name: 'eac3', tags: { language: 'por', title: 'Portuguese Brazil' } }
      ]
    });

    expect(chooseTranscodeAudioTrack(media.audio, priority)).toMatchObject({ streamIndex: 2, language: 'por' });
  });

  it('requires transcode for HEVC and advanced audio codecs', () => {
    expect(requiresH264AacTranscode(parseMedia('hevc', 'aac'), priority)).toBe(true);
    expect(requiresH264AacTranscode(parseMedia('h264', 'dts'), priority)).toBe(true);
    expect(requiresH264AacTranscode(parseMedia('h264', 'truehd'), priority)).toBe(true);
    expect(requiresH264AacTranscode(parseMedia('h264', 'eac3'), priority)).toBe(true);
    expect(requiresH264AacTranscode(parseMedia('h264', 'ac3'), priority)).toBe(true);
    expect(requiresH264AacTranscode(parseMedia('h264', 'aac'), priority)).toBe(false);
  });

  it('only applies auto transcode to browser clients', () => {
    const media = parseMedia('hevc', 'eac3');
    expect(shouldUseBrowserTranscode('Mozilla/5.0 Chrome/125', media, config)).toBe(true);
    expect(shouldUseBrowserTranscode('ExoPlayerLib/2.19.1', media, config)).toBe(false);
    expect(shouldUseBrowserTranscode('ExoPlayerLib/2.19.1', media, { ...config, mode: 'always' })).toBe(true);
    expect(shouldUseBrowserTranscode('Mozilla/5.0 Chrome/125', media, { ...config, mode: 'off' })).toBe(false);
  });

  it('builds HLS ffmpeg args for H.264/AAC with the selected audio stream', () => {
    const args = buildHlsTranscodeArgs({
      inputPath: '/cache/movie.mkv',
      outputDirectory: '/tmp/xcache-transcode/job',
      selectedAudio: { streamIndex: 2, audioPosition: 1, codec: 'eac3', language: 'por', default: false },
      segmentSeconds: 6,
      preset: 'veryfast',
      crf: 23,
      audioBitrate: '192k'
    });

    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args).toContain('yuv420p');
    expect(args).toContain('-hls_playlist_type');
    expect(args).toContain('event');
    expect(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4)).toEqual(['-map', '0:v:0', '-map', '0:2']);
  });
});

function parseMedia(videoCodec: string, audioCodec: string) {
  return parseMediaInfo({
    streams: [
      { index: 0, codec_type: 'video', codec_name: videoCodec },
      { index: 1, codec_type: 'audio', codec_name: audioCodec, disposition: { default: 1 }, tags: { language: 'eng' } }
    ]
  });
}
