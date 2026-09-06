/* oxlint-disable @stylistic/no-mixed-operators */
import { IconCheckCircle } from '@mdui/icons/check-circle.js';
import { IconChevronLeft } from '@mdui/icons/chevron-left.js';
import { IconChevronRight } from '@mdui/icons/chevron-right.js';
import { IconError } from '@mdui/icons/error.js';
import { IconStarBorder } from '@mdui/icons/star-border.js';
import { IconStar } from '@mdui/icons/star.js';
import { IconWarning } from '@mdui/icons/warning.js';
import { For, Index, Match, type Setter, Show, Switch } from 'solid-js';

import { LitElementWrapper } from '@/solit';

import { providerNames } from '../../providers';
import {
  enabledProviders,
  providerIdx,
  setHasManuallySwitchedProvider,
  starredProvider,
  toggleStar,
} from '../provider-picker';
import { currentLyrics, setLyricsStore } from '../store';

export const LyricsPicker = (props: {
  setStickRef: Setter<HTMLElement | null>;
}) => {
  const next = () => {
    setHasManuallySwitchedProvider(true);
    setLyricsStore('provider', (prevProvider) => {
      const list = enabledProviders();
      if (!list.length) return prevProvider;
      const idx = list.indexOf(prevProvider);
      return list[(idx + 1) % list.length];
    });
  };

  const previous = () => {
    setHasManuallySwitchedProvider(true);
    setLyricsStore('provider', (prevProvider) => {
      const list = enabledProviders();
      if (!list.length) return prevProvider;
      const idx = list.indexOf(prevProvider);
      return list[(idx + list.length - 1) % list.length];
    });
  };

  return (
    <div class="lyrics-picker" ref={props.setStickRef}>
      <div class="lyrics-picker-left">
        <mdui-button-icon>
          <LitElementWrapper
            elementClass={IconChevronLeft}
            props={{
              onClick: previous,
              role: 'button',
              style: { padding: '5px' },
            }}
          />
        </mdui-button-icon>
      </div>

      <div class="lyrics-picker-content">
        <div class="lyrics-picker-content-label">
          <Index each={enabledProviders()}>
            {(provider) => (
              <div
                class="lyrics-picker-item"
                style={{
                  transform: `translateX(${providerIdx() * -100 - 5}%)`,
                }}
                tabindex="-1"
              >
                <Switch>
                  <Match
                    when={
                      // prettier-ignore
                      currentLyrics().state === 'fetching'
                    }
                  >
                    <tp-yt-paper-spinner-lite
                      active
                      class="loading-indicator style-scope"
                      style={{ padding: '5px', transform: 'scale(0.5)' }}
                      tabindex="-1"
                    />
                  </Match>
                  <Match when={currentLyrics().state === 'error'}>
                    <LitElementWrapper
                      elementClass={IconError}
                      props={{ style: { padding: '5px', scale: '0.8' } }}
                    />
                  </Match>
                  <Match
                    when={
                      currentLyrics().state === 'done' &&
                      (currentLyrics().data?.lines ||
                        currentLyrics().data?.lyrics)
                    }
                  >
                    <LitElementWrapper
                      elementClass={IconCheckCircle}
                      props={{ style: { padding: '5px', scale: '0.8' } }}
                    />
                  </Match>
                  <Match
                    when={
                      currentLyrics().state === 'done' &&
                      !currentLyrics().data?.lines &&
                      !currentLyrics().data?.lyrics
                    }
                  >
                    <LitElementWrapper
                      elementClass={IconWarning}
                      props={{ style: { padding: '5px', scale: '0.8' } }}
                    />
                  </Match>
                </Switch>
                <yt-formatted-string
                  class="description ytmusic-description-shelf-renderer"
                  text={{ runs: [{ text: provider() }] }}
                />
                <mdui-button-icon onClick={toggleStar} tabindex={-1}>
                  <Show
                    fallback={
                      <LitElementWrapper elementClass={IconStarBorder} />
                    }
                    when={starredProvider() === provider()}
                  >
                    <LitElementWrapper elementClass={IconStar} />
                  </Show>
                </mdui-button-icon>
              </div>
            )}
          </Index>
        </div>

        <ul class="lyrics-picker-content-dots">
          <For each={enabledProviders()}>
            {(_, idx) => (
              <li
                class="lyrics-picker-dot"
                onClick={() => setLyricsStore('provider', providerNames[idx()])}
                style={{
                  background: idx() === providerIdx() ? 'white' : 'black',
                }}
              />
            )}
          </For>
        </ul>
      </div>

      <div class="lyrics-picker-left">
        <mdui-button-icon>
          <LitElementWrapper
            elementClass={IconChevronRight}
            props={{
              onClick: next,
              role: 'button',
              style: { padding: '5px' },
            }}
          />
        </mdui-button-icon>
      </div>
    </div>
  );
};
