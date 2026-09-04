import { jaroWinkler } from '@skyra/jaro-winkler';
import { sify } from 'chinese-conv';

import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const QQ_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg?ct=19&cv=1877';
const KUGOU_SEARCH_URL = 'https://mobileservice.kugou.com/api/v3/lyric/search';
const KUGOU_CANDIDATES_URL = 'https://krcs.kugou.com/search';
const KUGOU_DOWNLOAD_URL = 'https://lyrics.kugou.com/download';

const QQ_HEADERS = {
  'Content-Type': 'application/json',
  'Referer': 'https://y.qq.com/',
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

// The QQ/kugou endpoints return base64-encoded UTF-8; atob alone yields
// mojibake for non-ASCII text, so the bytes must be decoded explicitly.
const decodeBase64Utf8 = (base64: string) =>
  new TextDecoder('utf-8').decode(
    Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
  );

type QQSong = {
  name: string;
  mid: string;
  interval: number;
  singer: { name: string }[];
  album?: { name: string };
};

type KugouSearchInfo = {
  filename?: string;
  hash: string;
  duration?: number; // seconds
};

type KugouCandidate = {
  id: string;
  accesskey: string;
  song?: string;
  singer?: string;
  duration?: number; // milliseconds
  product_from?: string;
};

type QQResponse<T> = {
  req_1?: {
    code?: number;
    data?: T;
  };
};

type QQSearchData = { body?: { song?: { list?: QQSong[] } } };
type QQLyricData = { lyric?: string };

type KugouSearchResponse = { data?: { info?: KugouSearchInfo[] } };
type KugouCandidatesResponse = { candidates?: KugouCandidate[] };
type KugouDownloadResponse = { status?: number; content?: string };

export class ChineseLyrics implements LyricProvider {
  name = 'ChineseLyrics';
  baseUrl = 'https://y.qq.com';

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    const result =
      (await this.searchQQ(info).catch(() => null)) ??
      (await this.searchKugou(info).catch(() => null));

    return result;
  }

  // ---------- QQ Music ----------

  private async qqSearchQuery(query: string): Promise<QQSong[]> {
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
    if (status !== 200) return [];

    const data = JSON.parse(text) as QQResponse<QQSearchData>;
    // code 2001 = no results; some "title artist" combinations reliably hit it
    return data?.req_1?.code === 0
      ? (data.req_1.data?.body?.song?.list ?? [])
      : [];
  }

  private async fetchQQLyric(songMid: string): Promise<string | null> {
    const [status, text] = await withTimeout(
      netFetch(QQ_URL, {
        method: 'POST',
        headers: QQ_HEADERS,
        body: JSON.stringify({
          req_1: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param: { songMid, trans: 1, roma: 1, crypt: 0 },
          },
        }),
      }),
    );
    if (status !== 200) return null;

    const data = JSON.parse(text) as QQResponse<QQLyricData>;
    const base64 = data?.req_1?.data?.lyric;
    if (data?.req_1?.code !== 0 || !base64) return null;

    return decodeBase64Utf8(base64);
  }

  private async searchQQ(info: SearchSongInfo): Promise<LyricResult | null> {
    // Combined "title artist" queries are unstable on QQ (e.g. "大鱼 周深"
    // reliably returns empty), so fall back to the title-only query.
    const queries = [`${info.title} ${info.artist}`, info.title];
    for (const query of queries) {
      const songs = pickByDuration(
        await this.qqSearchQuery(query),
        (song) => song.interval,
        info.songDuration,
        (song) => song.singer.map((singer) => singer.name),
        info.artist,
      );
      if (!songs.length) continue;

      const lyric = await this.fetchQQLyric(songs[0].mid);
      if (!lyric) continue;

      return this.toResult(info, lyric);
    }

    return null;
  }

  // ---------- Kugou (3-step chain, no authentication) ----------

  private async fetchKugouLyric(hash: string): Promise<string | null> {
    const [candidateStatus, candidateText] = await withTimeout(
      netFetch(`${KUGOU_CANDIDATES_URL}?ver=1&man=yes&client=mobi&keyword=&duration=&hash=${hash}`),
    );
    if (candidateStatus !== 200) return null;

    const candidates =
      (JSON.parse(candidateText) as KugouCandidatesResponse)?.candidates ?? [];
    // Prefer official lyrics over user-submitted ones
    const candidate =
      candidates.find((c) => c.product_from === '官方推荐歌词') ?? candidates[0];
    if (!candidate?.id || !candidate.accesskey) return null;

    const [downloadStatus, downloadText] = await withTimeout(
      netFetch(
        `${KUGOU_DOWNLOAD_URL}?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=lrc&charset=utf8`,
      ),
    );
    if (downloadStatus !== 200) return null;

    const download = JSON.parse(downloadText) as KugouDownloadResponse;
    if (download?.status !== 200 || !download.content) return null;

    return decodeBase64Utf8(download.content);
  }

  private async searchKugou(info: SearchSongInfo): Promise<LyricResult | null> {
    const queries = [`${info.title} ${info.artist}`, info.title];
    for (const query of queries) {
      const [status, text] = await withTimeout(
        netFetch(`${KUGOU_SEARCH_URL}?keyword=${encodeURIComponent(query)}`),
      );
      if (status !== 200) continue;

      const infos =
        (JSON.parse(text) as KugouSearchResponse)?.data?.info ?? [];
      const sorted = pickByDuration(
        infos,
        (song) => song.duration,
        info.songDuration,
        // filename is "artist - title"; leading part is the artist, though
        // UGC uploads sometimes put the uploader name there instead
        (song) => song.filename?.split(' - ').slice(0, 1) ?? [],
        info.artist,
      );

      // The v3 search mixes covers/medleys into its fixed-size response, so
      // only the top duration-matched entries are worth downloading lyrics for
      for (const song of sorted.slice(0, 3)) {
        const lyric = await this.fetchKugouLyric(song.hash);
        if (!lyric) continue;

        return this.toResult(info, lyric);
      }
    }

    return null;
  }

  // ---------- Shared ----------

  private toResult(info: SearchSongInfo, lrcText: string): LyricResult {
    return {
      title: info.title,
      artists: info.artist.split(/[&,]/g).map((artist) => artist.trim()),
      lines: LRC.parse(lrcText).lines.map((line) => ({
        ...line,
        status: 'upcoming' as const,
      })),
    };
  }
}

// Duration is in seconds for both sources; tolerate ±15s like LRCLib does.
// songDuration can be 0 when unavailable, in which case no filtering applies.
// Entries whose artist matches the playing song sort first — the search
// fallbacks (title-only queries, kugou's ~20-entry fixed response) mix in
// namesake songs and covers that only the artist can rule out. Artist names
// are compared simplified because YT Music often reports traditional ones.
const pickByDuration = <T>(
  items: T[],
  seconds: (item: T) => number | undefined,
  songDuration: number,
  entryArtists: (item: T) => string[],
  songArtist: string,
): T[] => {
  const tolerance = songDuration > 0 ? 15 : Infinity;

  const targetArtists = songArtist
    .split(/[&,]/g)
    .map((artist) => sify(artist.trim().toLowerCase()))
    .filter(Boolean);

  const affinity = (item: T) => {
    const artists = entryArtists(item)
      .map((artist) => sify(artist.trim().toLowerCase()))
      .filter(Boolean);
    if (!artists.length || !targetArtists.length) return 0;

    let best = 0;
    for (const target of targetArtists) {
      for (const artist of artists) {
        best = Math.max(best, jaroWinkler(target, artist));
      }
    }
    return best;
  };

  return items
    .map((item) => {
      const duration = seconds(item);
      return {
        item,
        // entries without duration info are kept but ranked last
        durationDiff: duration ? Math.abs(duration - songDuration) : Infinity,
        artistAffinity: affinity(item),
      };
    })
    .filter(
      ({ durationDiff }) =>
        durationDiff === Infinity || durationDiff <= tolerance,
    )
    .sort(
      (a, b) =>
        b.artistAffinity - a.artistAffinity || a.durationDiff - b.durationDiff,
    )
    .map(({ item }) => item);
};
