import { createEffect, createMemo, createSignal, runWithOwner } from 'solid-js';
import * as z from 'zod';

import { reactiveOwner } from './reactive-root';
import { config } from './state';
import { lyricsStore, setLyricsStore } from './store';

import {
  type ProviderName,
  ProviderNames,
  providerNames,
  ProviderNameSchema,
  type ProviderState,
} from '../providers';

import type { MusicPlayer } from '@/types/music-player';
import type { PlayerAPIEvents } from '@/types/player-api-events';

const LocalStorageSchema = z.object({
  provider: ProviderNameSchema,
});

// providers left after the user disabled some in the settings menu
export const enabledProviders = () => {
  const disabled = config()?.disabledProviders;
  return disabled?.length
    ? providerNames.filter((provider) => !disabled.includes(provider))
    : Array.from(providerNames);
};

const shouldSwitchProvider = (providerData: ProviderState) => {
  if (providerData.state === 'error') return true;
  if (providerData.state === 'fetching') return true;
  return (
    providerData.state === 'done' &&
    !providerData.data?.lines &&
    !providerData.data?.lyrics
  );
};

const providerBias = (p: ProviderName) =>
  (lyricsStore.lyrics[p].state === 'done' ? 1 : -1) +
  (lyricsStore.lyrics[p].data?.lines?.length ? 2 : -1) +
  (lyricsStore.lyrics[p].data?.lines?.length && p === ProviderNames.YTMusic
    ? 1
    : 0) +
  (lyricsStore.lyrics[p].data?.lyrics ? 1 : -1);

export const pickBestProvider = () => {
  const disabled = config()?.disabledProviders ?? [];
  const preferred = config()?.preferredProvider;
  if (preferred && !disabled.includes(preferred)) {
    const data = lyricsStore.lyrics[preferred].data;
    if (Array.isArray(data?.lines) || data?.lyrics) {
      return { provider: preferred, force: true };
    }
  }

  const providers = enabledProviders();
  providers.sort((a, b) => providerBias(b) - providerBias(a));

  return { provider: providers[0], force: false };
};

export const [hasManuallySwitchedProvider, setHasManuallySwitchedProvider] =
  createSignal(false);

export const [starredProvider, setStarredProvider] =
  createSignal<ProviderName | null>(null);

const [videoId, setVideoId] = createSignal<string | null>(null);

export const providerIdx = runWithOwner(reactiveOwner, () =>
  createMemo(() => enabledProviders().indexOf(lyricsStore.provider)),
)!;

export const toggleStar = () => {
  const id = videoId();
  if (id === null) return;

  const key = `ytmd-sl-starred-${id}`;

  setStarredProvider((starred) => {
    if (lyricsStore.provider === starred) {
      localStorage.removeItem(key);
      return null;
    }

    const provider = lyricsStore.provider;
    localStorage.setItem(key, JSON.stringify({ provider }));

    return provider;
  });
};

const videoDataChangeHandler = (
  name: string,
  { videoId: id }: PlayerAPIEvents['videodatachange']['value'],
) => {
  setVideoId(id);

  if (name !== 'dataloaded') return;
  setHasManuallySwitchedProvider(false);
};

/** called by renderer/index.ts once the player API is up */
export const attachProviderPicker = (api: MusicPlayer) => {
  api.addEventListener('videodatachange', videoDataChangeHandler);
};

// Selection must live at module scope, NOT inside the LyricsPicker component:
// the picker only mounts when the lyrics panel is opened, and provider
// consumers without UI (desktop lyrics, synced overlay) need a provider to be
// picked as soon as fetch results arrive.
runWithOwner(reactiveOwner, () => {
  createEffect(() => {
    const id = videoId();
    if (id === null) {
      setStarredProvider(null);
      return;
    }

    const key = `ytmd-sl-starred-${id}`;
    const value = localStorage.getItem(key);
    if (!value) {
      setStarredProvider(null);
      return;
    }

    const parseResult = LocalStorageSchema.safeParse(JSON.parse(value));
    if (parseResult.success) {
      setLyricsStore('provider', parseResult.data.provider);
      setStarredProvider(parseResult.data.provider);
    } else {
      setStarredProvider(null);
    }
  });

  createEffect(() => {
    const disabled = config()?.disabledProviders ?? [];

    // the displayed provider got disabled (or is disabled at startup):
    // always re-pick, even if it had been chosen manually
    if (disabled.includes(lyricsStore.provider)) {
      const { provider } = pickBestProvider();
      if (provider) setLyricsStore('provider', provider);
      return;
    }

    if (!hasManuallySwitchedProvider()) {
      const starred = starredProvider();
      if (starred !== null && !disabled.includes(starred)) {
        setLyricsStore('provider', starred);
        return;
      }

      const candidates = enabledProviders();
      const allProvidersFailed = candidates.every((p) =>
        shouldSwitchProvider(lyricsStore.lyrics[p]),
      );
      if (!candidates.length || allProvidersFailed) return;

      const { provider, force } = pickBestProvider();
      if (
        force ||
        providerBias(lyricsStore.provider) < providerBias(provider)
      ) {
        setLyricsStore('provider', provider);
      }
    }
  });
});
