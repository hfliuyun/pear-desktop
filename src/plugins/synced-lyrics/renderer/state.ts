import { createSignal } from 'solid-js';

import type { SyncedLyricsPluginConfig } from '../types';

export const [isVisible, setIsVisible] = createSignal<boolean>(false);
export const [config, setConfig] =
  createSignal<SyncedLyricsPluginConfig | null>(null);
export const [currentTime, setCurrentTime] = createSignal<number>(-1);
