interface LRCTag {
  tag: string;
  value: string;
}

interface LRCLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
  words: { timeInMs: number; word: string }[];
}

interface LRC {
  tags: LRCTag[];
  lines: LRCLine[];
}

const tagRegex = /^\[(?<tag>\w+):\s*(?<value>.+?)\s*\]$/;
// prettier-ignore
const timestampRegex = /^\[(?<minutes>\d+):(?<seconds>\d+)\.(?<centiseconds>\d+)\]/m;

// The word must not swallow a following `<mm:ss.xx>` marker (CJK enhanced LRC
// often has no whitespace between marker and word), so `<` is excluded.
// prettier-ignore
const wordRegex = /<(?<minutes>\d+):(?<seconds>\d+)\.(?<centiseconds>\d+)> *(?<word>[^<\s]+)/g;

// CJK scripts have no inter-word spaces; reconstructing them with join(' ')
// would inject bogus gaps between characters. Mixed lines keep spaces around
// non-CJK words, so only two adjacent CJK words are glued together.
const CJK_RE = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;
const joinWords = (words: LRCLine['words']): string =>
  words.reduce(
    (text, { word }, i) =>
      i === 0
        ? word
        : CJK_RE.test(word) && CJK_RE.test(words[i - 1].word)
          ? text + word
          : `${text} ${word}`,
    '',
  );

export const LRC = {
  parse: (text: string): LRC => {
    const lrc: LRC = {
      tags: [],
      lines: [],
    };

    let offset = 0;

    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line.startsWith('[')) continue;

      const timestamps = [];
      let match: Record<string, string> | undefined;
      while ((match = line.match(timestampRegex)?.groups)) {
        const { minutes, seconds, centiseconds } = match;
        const milliseconds = match.centiseconds.padEnd(3, '0');
        const minutesInMs = parseInt(minutes) * 60000;
        const secondsInMs = parseInt(seconds) * 1000;
        const timeInMs = minutesInMs + secondsInMs + parseInt(milliseconds);

        timestamps.push({
          time: `${minutes}:${seconds}:${centiseconds}`,
          timeInMs,
        });

        line = line.replace(timestampRegex, '');
      }
      if (!timestamps.length) {
        const tag = line.match(tagRegex)?.groups;
        if (tag) {
          if (tag.tag === 'offset') {
            offset = parseInt(tag.value);
            continue;
          }

          lrc.tags.push({
            tag: tag.tag,
            value: tag.value,
          });
        }
        continue;
      }

      let text = line.trim();
      const words = Array.from(text.matchAll(wordRegex), ({ groups }) => {
        const { minutes, seconds, centiseconds, word } = groups!;
        const milliseconds = centiseconds.padEnd(3, '0');
        const minutesInMs = parseInt(minutes) * 60000;
        const secondsInMs = parseInt(seconds) * 1000;
        const timeInMs = minutesInMs + secondsInMs + parseInt(milliseconds);

        return { timeInMs, word };
      });

      if (words.length) {
        text = joinWords(words);
      }

      for (const { time, timeInMs } of timestamps) {
        lrc.lines.push({
          time,
          timeInMs,
          text,
          words,
          duration: Infinity,
        });
      }
    }

    lrc.lines.sort(({ timeInMs: timeA }, { timeInMs: timeB }) => timeA - timeB);
    for (let i = 0; i < lrc.lines.length; i++) {
      const current = lrc.lines[i];
      const next = lrc.lines[i + 1];

      current.timeInMs += offset;
      // word timings share the line's (shifted) timeline
      for (const word of current.words) {
        word.timeInMs += offset;
      }

      if (next) {
        current.duration = next.timeInMs - current.timeInMs;
      }
    }

    const first = lrc.lines.at(0);
    if (first && first.timeInMs > 300) {
      lrc.lines.unshift({
        time: '00:00:00',
        timeInMs: 0,
        duration: first.timeInMs,
        text: '',
        words: [],
      });
    }

    return lrc;
  },
};
