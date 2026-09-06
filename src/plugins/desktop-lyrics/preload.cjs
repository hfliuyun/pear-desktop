// Static preload for the desktop lyrics overlay window.
// Loaded via `import preloadScript from './preload.cjs?asset'` in backend.ts.
// Intentionally plain CommonJS: it ships as a raw asset, not through vite.
/* oxlint-disable typescript/no-require-imports, typescript/no-unsafe-argument, typescript/no-unsafe-call, typescript/no-unsafe-return, typescript/no-unsafe-member-access, typescript/no-unsafe-assignment */
const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = new Set([
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
]);

const RECEIVE_CHANNELS = new Set([
  'desktop-lyrics:config',
  'desktop-lyrics:time',
  'desktop-lyrics:song',
  'desktop-lyrics:lyrics',
]);

contextBridge.exposeInMainWorld('desktopLyrics', {
  send: (channel, ...args) => {
    if (!SEND_CHANNELS.has(channel)) return;
    ipcRenderer.send(channel, ...args);
  },
  on: (channel, listener) => {
    if (!RECEIVE_CHANNELS.has(channel)) return;
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
  },
});
