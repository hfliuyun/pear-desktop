import { getSongInfo } from '@/providers/song-info-front';
import { createRenderer } from '@/utils';

import {
  fetchTranslation,
  getTranslation,
  getTranslationVersion,
  lookupTranslation,
  type TranslationMap,
} from './translation';

import {
  currentLyrics,
  fetchLyrics,
  lyricsStore,
} from '../synced-lyrics/renderer/store';

import type { LineLyrics } from '../synced-lyrics/types';
import type {
  DesktopLyricsConfig,
  LyricLineEx,
  OverlayLyricsPayload,
  OverlaySongPayload,
  OverlayTimePayload,
} from './types';
import type { SongInfo } from '@/providers/song-info';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

let _ytAPI: MusicPlayer | null = null;
let ctxRef: RendererContext<DesktopLyricsConfig> | null = null;
let config: DesktopLyricsConfig | null = null;
let currentSong: SongInfo | null = null;
let lastForwardedLyrics: unknown = null;
let lastTranslationVersion = 0;

const attachTranslation = (
  line: LineLyrics,
  translation: TranslationMap | null | undefined,
): LyricLineEx => {
  // word-level karaoke timings pass through when the source provides them
  const base: LyricLineEx = {
    timeInMs: line.timeInMs,
    duration: line.duration,
    text: line.text,
    ...(line.words?.length ? { words: [...line.words] } : {}),
  };

  if (!translation) return base;

  const text = lookupTranslation(translation, line.timeInMs);
  return text ? { ...base, translation: text } : base;
};

const sendLyrics = () => {
  if (!ctxRef) return;

  const state = currentLyrics();
  const translation =
    currentSong && config?.showTranslation
      ? getTranslation(currentSong.videoId)
      : undefined;

  const payload: OverlayLyricsPayload = {
    provider: lyricsStore.provider,
    state: state.state,
    lines: state.data?.lines
      ? state.data.lines.map((line) => attachTranslation(line, translation))
      : null,
  };
  ctxRef.ipc.send('desktop-lyrics:lyrics', payload);
};

const sendLyricsIfChanged = () => {
  const state = currentLyrics();
  const translationVersion = getTranslationVersion();
  if (
    state === lastForwardedLyrics &&
    translationVersion === lastTranslationVersion
  ) {
    return;
  }
  lastForwardedLyrics = state;
  lastTranslationVersion = translationVersion;
  sendLyrics();
};

const onSongInfo = (info: SongInfo) => {
  const songChanged = !currentSong || currentSong.videoId !== info.videoId;
  currentSong = info;

  const payload: OverlaySongPayload = {
    title: info.title,
    artist: info.artist,
    videoId: info.videoId,
    songDuration: info.songDuration,
  };
  ctxRef?.ipc.send('desktop-lyrics:song', payload);

  // The synced-lyrics store dedupes concurrent fetches per videoId
  // (searchCache), so this stays free when both plugins are enabled.
  fetchLyrics(info);

  if (songChanged && config?.showTranslation) {
    fetchTranslation(info).then(() => sendLyricsIfChanged());
  }
};

const poll = () => {
  if (!_ytAPI || !ctxRef) return;

  // self-heal: the main process may broadcast the resumed song before this
  // renderer registered its 'peard:update-song-info' listener, so a one-shot
  // getSongInfo() in start() can miss it — retry until a song shows up
  if (!currentSong) {
    const info = getSongInfo();
    if (info?.videoId) {
      onSongInfo(info);
    }
  }

  const payload: OverlayTimePayload = {
    timeMs: (_ytAPI.getCurrentTime() ?? 0) * 1000,
    paused: _ytAPI.getPlayerState() === 2,
    videoId: currentSong?.videoId ?? '',
    at: Date.now(),
  };
  ctxRef.ipc.send('desktop-lyrics:time', payload);

  sendLyricsIfChanged();
};

export const renderer = createRenderer<
  {
    pollInterval?: NodeJS.Timeout | string | number;
  },
  DesktopLyricsConfig
>({
  onConfigChange(newConfig) {
    const showTranslationChanged =
      config && config.showTranslation !== newConfig.showTranslation;
    config = newConfig;

    if (showTranslationChanged && currentSong) {
      if (newConfig.showTranslation) {
        fetchTranslation(currentSong).then(() => sendLyricsIfChanged());
      } else {
        // re-forward so translations are stripped immediately
        sendLyrics();
      }
    }
  },

  onPlayerApiReady(api: MusicPlayer) {
    _ytAPI = api;

    if (!this.pollInterval) {
      this.pollInterval = setInterval(poll, 100);
    }
  },

  async start(ctx: RendererContext<DesktopLyricsConfig>) {
    ctxRef = ctx;
    config = await ctx.getConfig();

    ctx.ipc.on('peard:update-song-info', onSongInfo);

    // pick up a song that was already playing before the plugin started
    const info = getSongInfo();
    if (info?.videoId) {
      onSongInfo(info);
    }
  },

  stop(ctx: RendererContext<DesktopLyricsConfig>) {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    ctx.ipc.removeAllListeners('peard:update-song-info');
    ctxRef = null;
    currentSong = null;
    lastForwardedLyrics = null;
  },
});
