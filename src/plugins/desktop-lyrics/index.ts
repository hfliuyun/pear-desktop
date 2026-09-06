import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { menu } from './menu';
import { renderer } from './renderer';

import type { DesktopLyricsConfig } from './types';

export default createPlugin<
  typeof backend,
  unknown,
  typeof renderer,
  DesktopLyricsConfig
>({
  name: () => t('plugins.desktop-lyrics.name'),
  description: () => t('plugins.desktop-lyrics.description'),
  authors: ['Pear Desktop Contributors'],
  restartNeeded: false,
  addedVersion: '3.13.0',
  config: {
    enabled: false,
    visible: true,
    locked: false,
    position: { x: null, y: null },
    lines: 'double',
    fontSize: 36,
    fontFamily: "'Microsoft YaHei', 'PingFang SC', sans-serif",
    theme: 'green',
    opacity: 0.95,
    align: 'center',
    karaoke: true,
    showNextLine: true,
    showToolbar: true,
    clickToSeek: true,
    showTranslation: false,
    shortcuts: true,
    timeOffset: 0,
    background: false,
  },

  menu,
  backend,
  renderer,
});
