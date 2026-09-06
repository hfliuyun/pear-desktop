import { LRC } from '../synced-lyrics/parsers/lrc';
import { netFetch } from '../synced-lyrics/renderer';

import type { SongInfo } from '@/providers/song-info';

// D8 (P1): the ChineseLyrics provider requests `trans: 1` from QQ but
// discards the translation LRC in its result. To avoid touching
// synced-lyrics, desktop-lyrics fetches and parses the translation itself and
// aligns it to the displayed lines by timestamp. When synced-lyrics is
// disabled `netFetch` is unbound and this silently degrades to "no
// translation" (all errors are caught).

const QQ_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg?ct=19&cv=1877';
const QQ_HEADERS = {
  'Content-Type': 'application/json',
  'Referer': 'https://y.qq.com/',
};

const DURATION_TOLERANCE_S = 15;
const TRANSLATION_TOLERANCE_MS = 1000;
const CACHE_LIMIT = 50;

export interface TranslationMap {
  /** sorted line start times in ms */
  times: number[];
  byTime: Map<number, string>;
}

const cache = new Map<string, TranslationMap | null>();
const inFlight = new Map<string, Promise<void>>();
let version = 0;

export const getTranslationVersion = () => version;

/** undefined = not fetched yet, null = fetched but no translation available */
export const getTranslation = (
  videoId: string,
): TranslationMap | null | undefined => cache.get(videoId);

export const lookupTranslation = (
  map: TranslationMap,
  timeInMs: number,
): string | undefined => {
  const exact = map.byTime.get(timeInMs);
  if (exact !== undefined) return exact;

  const { times } = map;
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] < timeInMs) low = mid + 1;
    else high = mid;
  }
  const candidate = times[low];
  if (Math.abs(candidate - timeInMs) <= TRANSLATION_TOLERANCE_MS) {
    return map.byTime.get(candidate);
  }
  return undefined;
};

// AbortSignal is not structured-cloneable over the netFetch IPC, so wrap
// requests in a race instead of passing a signal to the backend.
const withTimeout = <T>(promise: Promise<T>, ms = 10_000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);

// The QQ endpoints return base64-encoded UTF-8; atob alone yields mojibake
// for non-ASCII text, so the bytes must be decoded explicitly.
const decodeBase64Utf8 = (base64: string) =>
  new TextDecoder('utf-8').decode(
    Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
  );

type QQResponse<T> = { req_1?: { code?: number; data?: T } };
type QQSearchData = {
  body?: { song?: { list?: { mid: string; interval: number }[] } };
};
type QQLyricData = { trans?: string };

const searchSongMid = async (info: SongInfo): Promise<string | null> => {
  // Combined "title artist" queries are unstable on QQ, so fall back to the
  // title-only query (same strategy as the ChineseLyrics provider).
  const queries = [`${info.title} ${info.artist}`, info.title];
  for (const query of queries) {
    const [status, text] = await withTimeout(
      netFetch(QQ_URL, {
        method: 'POST',
        headers: QQ_HEADERS,
        body: JSON.stringify({
          req_1: {
            method: 'DoSearchForQQMusicDesktop',
            module: 'music.search.SearchCgiService',
            param: { search_type: 0, query, page_num: 1, num_per_page: 5 },
          },
        }),
      }),
    );
    if (status !== 200) continue;

    const data = JSON.parse(text) as QQResponse<QQSearchData>;
    const songs =
      data?.req_1?.code === 0 ? (data.req_1.data?.body?.song?.list ?? []) : [];
    // Timestamp alignment below acts as the final correctness check, so a
    // plain duration match is enough here.
    const match = songs.find((song) =>
      info.songDuration > 0
        ? Math.abs(song.interval - info.songDuration) <= DURATION_TOLERANCE_S
        : true,
    );
    if (match) return match.mid;
  }
  return null;
};

const fetchTransLrc = async (songMid: string): Promise<string | null> => {
  const [status, text] = await withTimeout(
    netFetch(QQ_URL, {
      method: 'POST',
      headers: QQ_HEADERS,
      body: JSON.stringify({
        req_1: {
          module: 'music.musichallSong.PlayLyricInfo',
          method: 'GetPlayLyricInfo',
          param: { songMid, trans: 1, roma: 0, crypt: 0 },
        },
      }),
    }),
  );
  if (status !== 200) return null;

  const data = JSON.parse(text) as QQResponse<QQLyricData>;
  const base64 = data?.req_1?.data?.trans;
  if (data?.req_1?.code !== 0 || !base64) return null;

  return decodeBase64Utf8(base64);
};

const parseTransLrc = (lrcText: string): TranslationMap | null => {
  const lines = LRC.parse(lrcText).lines.filter(
    (line) => line.text.trim().length > 0,
  );
  if (!lines.length) return null;

  const times: number[] = [];
  const byTime = new Map<number, string>();
  for (const line of lines) {
    times.push(line.timeInMs);
    byTime.set(line.timeInMs, line.text);
  }
  return { times, byTime };
};

const evict = () => {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

/** Fetch (and cache) the translation for a song; resolves to the new version. */
export const fetchTranslation = async (info: SongInfo): Promise<number> => {
  if (!info.videoId) return version;
  if (cache.has(info.videoId)) return version;

  const existing = inFlight.get(info.videoId);
  if (existing) {
    await existing.catch(() => undefined);
    return version;
  }

  const task = (async () => {
    try {
      const songMid = await searchSongMid(info);
      const transLrc = songMid ? await fetchTransLrc(songMid) : null;
      const map = transLrc ? parseTransLrc(transLrc) : null;
      if (map) version++;
      cache.set(info.videoId, map);
    } catch {
      cache.set(info.videoId, null);
    } finally {
      inFlight.delete(info.videoId);
      evict();
    }
  })();

  inFlight.set(info.videoId, task);
  await task.catch(() => undefined);
  return version;
};
