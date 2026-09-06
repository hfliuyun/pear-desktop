export type DesktopLyricsTheme = 'green' | 'blue' | 'orange' | 'pink' | 'mono';
export type DesktopLyricsLinesMode = 'single' | 'double';
export type DesktopLyricsAlign = 'left' | 'center' | 'right';

export interface DesktopLyricsConfig {
  enabled: boolean;
  /** Overlay visibility (persisted; toggled from the plugin menu, tray of states survives restarts) */
  visible: boolean;
  /** When locked, the overlay window is click-through (mouse events reach underlying apps) */
  locked: boolean;
  /** Last dragged position (screen coordinates); null values → default bottom-center placement */
  position: { x: number | null; y: number | null };
  lines: DesktopLyricsLinesMode;
  fontSize: number;
  fontFamily: string;
  theme: DesktopLyricsTheme;
  opacity: number;
  align: DesktopLyricsAlign;
  karaoke: boolean;
  showNextLine: boolean;
  showToolbar: boolean;
  clickToSeek: boolean;
  showTranslation: boolean;
  shortcuts: boolean;
  /** seconds added to the playback time before matching lyrics lines */
  timeOffset: number;
  /** semi-transparent panel behind the lyrics text */
  background: boolean;
}

/**
 * A lyrics line extended with an optional translation and word-level timings
 * (desktop-lyrics own extension; `LineLyrics` from synced-lyrics is
 * intentionally untouched).
 */
export interface LyricLineEx {
  timeInMs: number;
  duration: number;
  text: string;
  translation?: string;
  words?: OverlayLyricWord[];
}

/** Word-level karaoke timing, shaped like synced-lyrics' parsed LRC words */
export interface OverlayLyricWord {
  timeInMs: number;
  word: string;
}

export interface OverlayTimePayload {
  timeMs: number;
  paused: boolean;
  videoId: string;
  /** Date.now() at send time, used to compensate IPC latency */
  at: number;
}

export interface OverlaySongPayload {
  title: string;
  artist: string;
  videoId: string;
  songDuration: number;
}

export interface OverlayLyricsPayload {
  provider: string;
  state: 'fetching' | 'done' | 'error';
  lines: LyricLineEx[] | null;
}

/** Translated UI strings for the static overlay page (main-process i18n) */
export interface OverlayTexts {
  lockedToast: string;
  loading: string;
  noLyrics: string;
  settingsTooltip: string;
}

export interface OverlayConfigPayload extends DesktopLyricsConfig {
  texts: OverlayTexts;
}
