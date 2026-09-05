import { t } from '@/i18n';
import { getSongInfo } from '@/providers/song-info-front';

import { lyricsStore, retrySearch } from '../store';

export const NotFoundKaomoji = () => {
  return (
    <div style={{ 'margin-bottom': '5%' }}>
      <yt-formatted-string
        class="text-lyrics description ytmusic-description-shelf-renderer"
        style={{
          'display': 'inline-flex',
          'justify-content': 'center',
          'width': '100%',
          'user-select': 'none',
        }}
        text={{
          runs: [{ text: '＼(〇_ｏ)／' }],
        }}
      />

      <yt-button-renderer
        data={{
          icon: { iconType: 'REFRESH' },
          isDisabled: false,
          style: 'STYLE_DEFAULT',
          text: {
            simpleText: t('plugins.synced-lyrics.refetch-btn.normal'),
          },
        }}
        onClick={() => retrySearch(lyricsStore.provider, getSongInfo())}
        style={{
          'margin-top': '1em',
          'width': '100%',
        }}
      />
    </div>
  );
};
