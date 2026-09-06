import { test, expect } from '@playwright/test';

import { LRC } from './lrc';

test('empty string', () => {
  const lrc = LRC.parse('');
  expect(lrc).toStrictEqual({ lines: [], tags: [] });
});

test('chorus', () => {
  const lrc = LRC.parse(`\
[00:12.00]Line 1 lyrics
[00:17.20]Line 2 lyrics
[00:21.10][00:45.10]Repeating lyrics (e.g. chorus)
[mm:ss.xx]Last lyrics line\
`);

  expect(lrc).toStrictEqual({
    lines: [
      { duration: 12000, text: '', words: [], time: '00:00:00', timeInMs: 0 },
      {
        duration: 5200,
        text: 'Line 1 lyrics',
        words: [],
        time: '00:12:00',
        timeInMs: 12000,
      },
      {
        duration: 3900,
        text: 'Line 2 lyrics',
        words: [],
        time: '00:17:20',
        timeInMs: 17200,
      },
      {
        duration: 24000,
        text: 'Repeating lyrics (e.g. chorus)',
        words: [],
        time: '00:21:10',
        timeInMs: 21100,
      },
      {
        duration: Infinity,
        text: 'Repeating lyrics (e.g. chorus)',
        words: [],
        time: '00:45:10',
        timeInMs: 45100,
      },
    ],
    tags: [],
  });
});

test('attributes', () => {
  const lrc = LRC.parse(
    `[ar:Chubby Checker oppure  Beatles, The]
[al:Hits Of The 60's - Vol. 2 – Oldies]
[ti:Let's Twist Again]
[au:Written by Kal Mann / Dave Appell, 1961]
[length: 2:23]

[00:12.00]Naku Penda Piya-Naku Taka Piya-Mpenziwe
[00:15.30]Some more lyrics ...`,
  );

  expect(lrc).toStrictEqual({
    lines: [
      { duration: 12000, text: '', words: [], time: '00:00:00', timeInMs: 0 },
      {
        duration: 3300,
        text: 'Naku Penda Piya-Naku Taka Piya-Mpenziwe',
        words: [],
        time: '00:12:00',
        timeInMs: 12000,
      },
      {
        duration: Infinity,
        text: 'Some more lyrics ...',
        words: [],
        time: '00:15:30',
        timeInMs: 15300,
      },
    ],
    tags: [
      { tag: 'ar', value: 'Chubby Checker oppure  Beatles, The' },
      { tag: 'al', value: "Hits Of The 60's - Vol. 2 – Oldies" },
      { tag: 'ti', value: "Let's Twist Again" },
      { tag: 'au', value: 'Written by Kal Mann / Dave Appell, 1961' },
      { tag: 'length', value: '2:23' },
    ],
  });
});

test('karaoke', () => {
  const lrc = LRC.parse(
    '[00:00.00] <00:00.04> When <00:00.16> the <00:00.82> truth <00:01.29> is <00:01.63> found <00:03.09> to <00:03.37> be <00:05.92> lies',
  );

  expect(lrc).toStrictEqual({
    lines: [
      {
        duration: Infinity,
        text: 'When the truth is found to be lies',
        time: '00:00:00',
        timeInMs: 0,
        words: [
          {
            timeInMs: 40,
            word: 'When',
          },
          {
            timeInMs: 160,
            word: 'the',
          },
          {
            timeInMs: 820,
            word: 'truth',
          },
          {
            timeInMs: 1290,
            word: 'is',
          },
          {
            timeInMs: 1630,
            word: 'found',
          },
          {
            timeInMs: 3090,
            word: 'to',
          },
          {
            timeInMs: 3370,
            word: 'be',
          },
          {
            timeInMs: 5920,
            word: 'lies',
          },
        ],
      },
    ],
    tags: [],
  });
});

test('karaoke with CJK words has no injected spaces', () => {
  // \w+ never matched CJK characters and join(' ') inserted bogus gaps; the
  // enhanced line is marker-dense with no whitespace between words
  const lrc = LRC.parse('[00:01.00]<00:01.50>中<00:02.00>文<00:02.50>歌');

  expect(lrc.lines).toStrictEqual([
    { duration: 1000, text: '', words: [], time: '00:00:00', timeInMs: 0 },
    {
      duration: Infinity,
      text: '中文歌',
      time: '00:01:00',
      timeInMs: 1000,
      words: [
        { timeInMs: 1500, word: '中' },
        { timeInMs: 2000, word: '文' },
        { timeInMs: 2500, word: '歌' },
      ],
    },
  ]);
});

test('karaoke with mixed CJK and latin words keeps spaces around latin', () => {
  const lrc = LRC.parse(
    '[00:00.10] <00:00.10> 这 <00:00.50> love <00:01.00> 故事',
  );

  expect(lrc.lines).toStrictEqual([
    {
      duration: Infinity,
      text: '这 love 故事',
      time: '00:00:10',
      timeInMs: 100,
      words: [
        { timeInMs: 100, word: '这' },
        { timeInMs: 500, word: 'love' },
        { timeInMs: 1000, word: '故事' },
      ],
    },
  ]);
});

test('karaoke word timings follow the offset tag', () => {
  const lrc = LRC.parse('[offset:500]\n[00:01.00]<00:01.00>你<00:01.50>好');

  expect(lrc.lines).toStrictEqual([
    { duration: 1500, text: '', words: [], time: '00:00:00', timeInMs: 0 },
    {
      duration: Infinity,
      text: '你好',
      time: '00:01:00',
      timeInMs: 1500,
      words: [
        { timeInMs: 1500, word: '你' },
        { timeInMs: 2000, word: '好' },
      ],
    },
  ]);
});
