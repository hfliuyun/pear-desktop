import { BrowserWindow, globalShortcut, ipcMain, Menu, screen } from 'electron';

import { t } from '@/i18n';
import { createBackend } from '@/utils';

import overlayHtml from './overlay.html?asset';
import preloadScript from './preload.cjs?asset';

import type {
  DesktopLyricsConfig,
  OverlayConfigPayload,
  OverlayLyricsPayload,
  OverlaySongPayload,
  OverlayTimePayload,
} from './types';
import type { BackendContext } from '@/types/contexts';

const WINDOW_HEIGHT = 150;
const WINDOW_WIDTH_RATIO = 0.66;
const DEFAULT_BOTTOM_MARGIN = 120;
const SAVE_POSITION_THROTTLE = 500;
/** while dragging, the overlay may leave the screen as long as this much stays visible */
const DRAG_VISIBLE_MARGIN = 80;
/** cursor-follow polling interval while dragging (≈120Hz) */
const DRAG_POLL_INTERVAL = 8;

const IPC_CHANNELS = [
  'desktop-lyrics:overlay-ready',
  'desktop-lyrics:set-locked',
  'desktop-lyrics:hide',
  'desktop-lyrics:seek',
  'desktop-lyrics:play-pause',
  'desktop-lyrics:next',
  'desktop-lyrics:prev',
  'desktop-lyrics:popup-settings',
  'desktop-lyrics:drag-start',
  'desktop-lyrics:drag-end',
  'desktop-lyrics:set-hover-rects',
  'desktop-lyrics:time',
  'desktop-lyrics:song',
  'desktop-lyrics:lyrics',
] as const;

const LOCK_SHORTCUT = 'Control+Alt+L';
const TOGGLE_SHORTCUT = 'Control+Alt+D';
const PLAY_PAUSE_SHORTCUT = 'Control+Alt+P';
const NEXT_SHORTCUT = 'Control+Alt+Right';
const PREV_SHORTCUT = 'Control+Alt+Left';

let backendCtx: BackendContext<DesktopLyricsConfig> | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlaySize: { width: number; height: number } | null = null;
let cachedConfig: DesktopLyricsConfig | null = null;
let cachedTime: OverlayTimePayload | null = null;
let cachedSong: OverlaySongPayload | null = null;
let cachedLyrics: OverlayLyricsPayload | null = null;
let savePositionTimer: NodeJS.Timeout | undefined;
let registeredShortcuts: string[] = [];
/** accelerators that could not be registered (usually taken by another app) */
let failedShortcuts: string[] = [];
/** baseline of what the plugin menu last showed; the menu is rebuilt whenever this diverges */
let menuSync: { locked: boolean; visible: boolean; shortcuts: string } | null =
  null;
/**
 * Hover-driven interactivity: the overlay is mouse-transparent by default and
 * the renderer asks to become interactive only while the cursor is over
 * visible content (lyrics / toolbar / status), so the invisible window never
 * blocks the screen. While locked, only the small lock button qualifies.
 */
let hoverInteractive = false;
let dragTimer: NodeJS.Timeout | undefined;
let dragOrigin: {
  cursorX: number;
  cursorY: number;
  winX: number;
  winY: number;
} | null = null;
let dragSize: { width: number; height: number } | null = null;

const clampValue = (value: number, min: number, max: number) =>
  max < min ? min : Math.min(Math.max(value, min), max);

const onDisplayRemoved = () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const [x, y] = overlayWindow.getPosition();
  const [width, height] = overlayWindow.getSize();
  const clamped = clampPosition(x, y, width, height);
  overlayWindow.setPosition(clamped.x, clamped.y);
};

/**
 * Clamp a window position fully inside the workArea of the display nearest to
 * it, so the overlay can't get lost (e.g. after unplugging an monitor).
 */
export const clampPosition = (
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  const area = screen.getDisplayMatching({ x, y, width, height }).workArea;
  return {
    x: clampValue(x, area.x, area.x + area.width - width),
    y: clampValue(y, area.y, area.y + area.height - height),
  };
};

/**
 * Relaxed clamp used while dragging: the window may partly leave the screen
 * (so the lyrics text can reach the edges), but never fully disappear.
 */
const clampLoose = (
  x: number,
  y: number,
  width: number,
  height: number,
  margin = DRAG_VISIBLE_MARGIN,
): { x: number; y: number } => {
  const area = screen.getDisplayMatching({ x, y, width, height }).workArea;
  return {
    x: clampValue(x, area.x - width + margin, area.x + area.width - margin),
    y: clampValue(y, area.y - height + margin, area.y + area.height - margin),
  };
};

const defaultPosition = (width: number, height: number) => {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - DEFAULT_BOTTOM_MARGIN,
  };
};

const resolvePosition = (
  config: DesktopLyricsConfig,
  width: number,
  height: number,
) => {
  if (config.position.x === null || config.position.y === null) {
    return defaultPosition(width, height);
  }
  return clampPosition(config.position.x, config.position.y, width, height);
};

export const createOverlayWindow = (
  ctx: BackendContext<DesktopLyricsConfig>,
) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const config = cachedConfig;
  if (!config) return null;

  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.round(workArea.width * WINDOW_WIDTH_RATIO);
  const height = WINDOW_HEIGHT;
  const position = resolvePosition(config, width, height);

  const commonOptions = {
    width,
    height,
    x: position.x,
    y: position.y,
    frame: false,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: preloadScript,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  };

  const win = new BrowserWindow({ ...commonOptions, transparent: true });

  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  win.on('closed', () => {
    overlayWindow = null;
  });

  // The overlay must never be maximized/snapped (e.g. by system gestures on
  // old app-region drags): a full-screen transparent window blocks the whole
  // desktop. Snap back to the intended size immediately.
  win.on('maximize', () => {
    if (!win.isDestroyed()) win.unmaximize();
  });
  win.on('resize', () => {
    if (win.isDestroyed() || !overlaySize) return;
    const [w, h] = win.getSize();
    if (w === overlaySize.width && h === overlaySize.height) return;
    const [x, y] = win.getPosition();
    win.setBounds({
      x,
      y,
      width: overlaySize.width,
      height: overlaySize.height,
    });
  });

  // -webkit-app-region drags move the window natively, so the renderer cannot
  // observe them; persist from here instead (throttled, D7).
  win.on('move', () => {
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      const [x, y] = overlayWindow.getPosition();
      cachedConfig = { ...cachedConfig!, position: { x, y } };
      ctx.setConfig({ position: { x, y } });
    }, SAVE_POSITION_THROTTLE);
  });

  overlaySize = { width, height };
  win.loadFile(overlayHtml);
  applyIgnoreMouse();
  if (config.visible) {
    win.showInactive();
  }

  overlayWindow = win;
  return win;
};

export const destroyOverlayWindow = () => {
  clearTimeout(savePositionTimer);
  clearInterval(dragTimer);
  dragTimer = undefined;
  dragOrigin = null;
  dragSize = null;
  overlayWindow?.destroy();
  overlayWindow = null;
};

const overlayTexts = () => ({
  lockedToast: t('plugins.desktop-lyrics.overlay.locked-toast'),
  loading: t('plugins.desktop-lyrics.overlay.loading'),
  noLyrics: t('plugins.desktop-lyrics.overlay.no-lyrics'),
  settingsTooltip: t('plugins.desktop-lyrics.overlay.settings-tooltip'),
});

const applyIgnoreMouse = () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setIgnoreMouseEvents(!hoverInteractive, { forward: true });
};

const applyConfigToOverlay = (config: DesktopLyricsConfig) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  const payload: OverlayConfigPayload = { ...config, texts: overlayTexts() };
  overlayWindow.webContents.send('desktop-lyrics:config', payload);

  if (config.visible) {
    overlayWindow.showInactive();
  } else {
    overlayWindow.hide();
  }
};

const toggleLock = () => {
  const locked = !cachedConfig?.locked;
  cachedConfig = { ...cachedConfig!, locked };
  backendCtx?.setConfig({ locked });
};

const toggleVisible = () => {
  const visible = !cachedConfig?.visible;
  cachedConfig = { ...cachedConfig!, visible };
  if (visible && backendCtx) {
    createOverlayWindow(backendCtx);
  }
  applyConfigToOverlay(cachedConfig);
  backendCtx?.setConfig({ visible });
};

// Playback control goes through the main window's renderer just like the
// seek channel does — `peard:*` handlers live in src/renderer.ts.
const togglePlayback = () => {
  backendCtx?.ipc.send('peard:toggle-play');
};
const playNext = () => {
  backendCtx?.ipc.send('peard:next-video');
};
const playPrevious = () => {
  backendCtx?.ipc.send('peard:previous-video');
};

/** accelerators that failed to register, for the plugin menu tooltip */
export const getShortcutFeedback = (): string[] => failedShortcuts;

const registerShortcuts = (config: DesktopLyricsConfig) => {
  unregisterShortcuts();
  if (!config.shortcuts) return;

  for (const [accelerator, handler] of [
    [TOGGLE_SHORTCUT, toggleVisible],
    [LOCK_SHORTCUT, toggleLock],
    [PLAY_PAUSE_SHORTCUT, togglePlayback],
    [NEXT_SHORTCUT, playNext],
    [PREV_SHORTCUT, playPrevious],
  ] as const) {
    if (globalShortcut.isRegistered(accelerator)) {
      registeredShortcuts.push(accelerator);
      continue;
    }
    if (globalShortcut.register(accelerator, handler)) {
      registeredShortcuts.push(accelerator);
    } else {
      // usually taken by another app (e.g. Intel graphics hotkeys on
      // Ctrl+Alt+arrows); surfaced through the plugin menu tooltip
      failedShortcuts.push(accelerator);
    }
  }
};

const unregisterShortcuts = () => {
  for (const accelerator of registeredShortcuts) {
    globalShortcut.unregister(accelerator);
  }
  registeredShortcuts = [];
  failedShortcuts = [];
};

const replayState = (config: DesktopLyricsConfig) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const win = overlayWindow;

  win.webContents.send('desktop-lyrics:config', {
    ...config,
    texts: overlayTexts(),
  });
  if (cachedSong) win.webContents.send('desktop-lyrics:song', cachedSong);
  if (cachedLyrics) win.webContents.send('desktop-lyrics:lyrics', cachedLyrics);
  if (cachedTime) win.webContents.send('desktop-lyrics:time', cachedTime);
};

const stopDragLoop = () => {
  clearInterval(dragTimer);
  dragTimer = undefined;
  dragOrigin = null;
  dragSize = null;
};

/** client-space (DIP) rects of the overlay's visible, interactive content */
type HoverRect = { x: number; y: number; width: number; height: number };
let hoverRects: HoverRect[] = [];
let dragForceInteractive = false;
let hoverPoller: NodeJS.Timeout | undefined;
/** true while the popup settings menu is open (native menu needs the window interactive) */
let popupOpen = false;

/**
 * Open the exact template the Plugins → Desktop Lyrics menu shows, anchored to
 * the overlay (QQ音乐-style "hover the gear / right-click the lyrics").
 */
const popupSettingsMenu = async () => {
  if (
    !backendCtx ||
    !overlayWindow ||
    overlayWindow.isDestroyed() ||
    popupOpen ||
    cachedConfig?.locked
  ) {
    return;
  }
  const ctx = backendCtx;

  // Lazy import on purpose: menu.ts imports backend.ts for the shortcut
  // feedback, so a static import here would cycle at module evaluation.
  const [{ menu: buildMenu }, { refreshMenu }] = await Promise.all([
    import('./menu'),
    import('@/menu'),
  ]);
  const template = await buildMenu({
    getConfig: ctx.getConfig,
    setConfig: ctx.setConfig,
    window: ctx.window,
    refresh: () => refreshMenu(ctx.window),
  });

  popupOpen = true;
  Menu.buildFromTemplate(template).popup({
    window: overlayWindow,
    callback: () => {
      popupOpen = false;
    },
  });
};

/**
 * Poll the real cursor against the published rects and toggle mouse
 * transparency accordingly. Polling (instead of forwarded mousemove) is
 * deliberate: `forward: true` is unreliable on Windows for transparent
 * focusable:false windows.
 */
const startHoverPoller = () => {
  clearInterval(hoverPoller);
  hoverPoller = setInterval(() => {
    if (
      !overlayWindow ||
      overlayWindow.isDestroyed() ||
      !overlayWindow.isVisible()
    ) {
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const [winX, winY] = overlayWindow.getPosition();
    const clientX = cursor.x - winX;
    const clientY = cursor.y - winY;
    const hit =
      dragForceInteractive ||
      popupOpen ||
      hoverRects.some(
        (r) =>
          clientX >= r.x &&
          clientX <= r.x + r.width &&
          clientY >= r.y &&
          clientY <= r.y + r.height,
      );
    if (hit !== hoverInteractive) {
      hoverInteractive = hit;
      applyIgnoreMouse();
    }
  }, 30);
};

export const backend = createBackend<
  {
    createOverlayWindow: typeof createOverlayWindow;
    destroyOverlayWindow: typeof destroyOverlayWindow;
    clampPosition: typeof clampPosition;
  },
  DesktopLyricsConfig
>({
  createOverlayWindow,
  destroyOverlayWindow,
  clampPosition,

  async start(ctx) {
    backendCtx = ctx;
    cachedConfig = await ctx.getConfig();
    cachedTime = null;
    cachedSong = null;
    cachedLyrics = null;
    hoverInteractive = false;
    hoverRects = [];
    dragForceInteractive = false;
    menuSync = {
      locked: cachedConfig.locked,
      visible: cachedConfig.visible,
      shortcuts: '',
    };
    startHoverPoller();

    ctx.ipc.on('desktop-lyrics:time', (payload: OverlayTimePayload) => {
      cachedTime = payload;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('desktop-lyrics:time', payload);
      }
    });

    ctx.ipc.on('desktop-lyrics:song', (payload: OverlaySongPayload) => {
      cachedSong = payload;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('desktop-lyrics:song', payload);
      }
    });

    ctx.ipc.on('desktop-lyrics:lyrics', (payload: OverlayLyricsPayload) => {
      cachedLyrics = payload;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('desktop-lyrics:lyrics', payload);
      }
    });

    ctx.ipc.on('desktop-lyrics:overlay-ready', () => {
      if (!cachedConfig) return;
      replayState(cachedConfig);
    });

    ctx.ipc.on('desktop-lyrics:set-locked', (locked: boolean) => {
      cachedConfig = { ...cachedConfig!, locked };
      ctx.setConfig({ locked });
    });

    ctx.ipc.on('desktop-lyrics:hide', () => {
      cachedConfig = { ...cachedConfig!, visible: false };
      applyConfigToOverlay(cachedConfig);
      ctx.setConfig({ visible: false });
    });

    ctx.ipc.on('desktop-lyrics:seek', (seconds: number) => {
      ctx.ipc.send('peard:seek-to', seconds);
    });

    // Toolbar playback buttons forward to the main window's player API, whose
    // handlers live in src/renderer.ts (same route the seek channel takes).
    ctx.ipc.on('desktop-lyrics:play-pause', () => {
      ctx.ipc.send('peard:toggle-play');
    });
    ctx.ipc.on('desktop-lyrics:next', () => {
      ctx.ipc.send('peard:next-video');
    });
    ctx.ipc.on('desktop-lyrics:prev', () => {
      ctx.ipc.send('peard:previous-video');
    });

    // Right-click on the lyrics opens the plugin's settings menu in place
    ctx.ipc.on('desktop-lyrics:popup-settings', () => {
      popupSettingsMenu();
    });

    // Hover-driven interactivity: the renderer publishes the client rects of
    // its visible content; the poller above toggles mouse transparency so the
    // invisible window margins never block the desktop.
    ctx.ipc.on('desktop-lyrics:set-hover-rects', (rects: HoverRect[]) => {
      hoverRects = Array.isArray(rects) ? rects : [];
    });

    // Dragging: the renderer only signals start/end; the main process follows
    // the real cursor on a short polling loop, which is as smooth as a native
    // window drag (no per-event IPC round trips).
    ctx.ipc.on('desktop-lyrics:drag-start', () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      const cursor = screen.getCursorScreenPoint();
      const [x, y] = overlayWindow.getPosition();
      const [width, height] = overlayWindow.getSize();
      dragOrigin = { cursorX: cursor.x, cursorY: cursor.y, winX: x, winY: y };
      dragSize = { width, height };
      // stay interactive for the whole gesture, even off the text
      dragForceInteractive = true;
      if (!hoverInteractive) {
        hoverInteractive = true;
        applyIgnoreMouse();
      }
      clearInterval(dragTimer);
      dragTimer = setInterval(() => {
        if (
          !dragOrigin ||
          !dragSize ||
          !overlayWindow ||
          overlayWindow.isDestroyed()
        ) {
          return;
        }
        const cursor = screen.getCursorScreenPoint();
        const position = clampLoose(
          dragOrigin.winX + cursor.x - dragOrigin.cursorX,
          dragOrigin.winY + cursor.y - dragOrigin.cursorY,
          dragSize.width,
          dragSize.height,
        );
        overlayWindow.setPosition(position.x, position.y);
      }, DRAG_POLL_INTERVAL);
    });

    ctx.ipc.on('desktop-lyrics:drag-end', () => {
      stopDragLoop();
      dragForceInteractive = false;
    });

    // When the main window goes away the app is quitting (window-all-closed
    // → app.quit on Win/Linux): destroy the overlay so nothing hangs.
    ctx.window.once('closed', () => {
      destroyOverlayWindow();
      unregisterShortcuts();
    });

    screen.on('display-removed', onDisplayRemoved);

    createOverlayWindow(ctx);
    registerShortcuts(cachedConfig);
    if (menuSync) menuSync.shortcuts = registeredShortcuts.join(',');
  },

  stop() {
    destroyOverlayWindow();
    unregisterShortcuts();
    clearInterval(hoverPoller);
    hoverPoller = undefined;
    screen.removeListener('display-removed', onDisplayRemoved);
    for (const channel of IPC_CHANNELS) {
      ipcMain.removeAllListeners(channel);
    }
    backendCtx = null;
    hoverInteractive = false;
    hoverRects = [];
    dragForceInteractive = false;
    popupOpen = false;
    menuSync = null;
    cachedConfig = null;
    cachedTime = null;
    cachedSong = null;
    cachedLyrics = null;
  },

  async onConfigChange(newConfig) {
    cachedConfig = newConfig;
    if (
      newConfig.visible &&
      backendCtx &&
      (!overlayWindow || overlayWindow.isDestroyed())
    ) {
      createOverlayWindow(backendCtx);
    }
    applyConfigToOverlay(newConfig);
    registerShortcuts(newConfig);

    // Lock/visibility/shortcut-registration can be toggled outside the menu
    // (overlay lock button, global shortcuts, registration failures); rebuild
    // the menu so its checkboxes and tooltip reflect reality. Compared against
    // the last state the menu was built with — NOT against cachedConfig, which
    // IPC handlers already mutate before this runs. Lazy import on purpose: a
    // static import would create a module-evaluation cycle with menu.ts's
    // top-level await (startup deadlock).
    const shortcutsSignature = registeredShortcuts.join(',');
    if (
      backendCtx &&
      (!menuSync ||
        menuSync.locked !== newConfig.locked ||
        menuSync.visible !== newConfig.visible ||
        menuSync.shortcuts !== shortcutsSignature)
    ) {
      menuSync = {
        locked: newConfig.locked,
        visible: newConfig.visible,
        shortcuts: shortcutsSignature,
      };
      const { refreshMenu } = await import('@/menu');
      refreshMenu(backendCtx.window);
    }
  },
});
