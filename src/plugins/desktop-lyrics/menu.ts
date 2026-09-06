import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { getShortcutFeedback } from './backend';

import type {
  DesktopLyricsAlign,
  DesktopLyricsConfig,
  DesktopLyricsTheme,
} from './types';
import type { MenuContext } from '@/types/contexts';
import type { MenuItemConstructorOptions } from 'electron';

const FONT_SIZES = [24, 28, 32, 36, 42, 48, 56];
const OPACITIES = [0.6, 0.8, 0.95, 1];
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 120;
const MIN_OPACITY = 0.05;

/** seconds; positive values show the lyrics earlier, negative ones later */
const TIME_OFFSETS = [
  { value: 1, key: 'early-1' },
  { value: 0.5, key: 'early-05' },
  { value: 0, key: 'synced' },
  { value: -0.5, key: 'late-05' },
  { value: -1, key: 'late-1' },
] as const;

const FONT_FAMILIES = [
  { id: 'yahei', value: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { id: 'simhei', value: 'SimHei, sans-serif' },
  { id: 'kaiti', value: "KaiTi, 'Kaiti SC', serif" },
  { id: 'system', value: 'system-ui, sans-serif' },
] as const;

const THEMES: DesktopLyricsTheme[] = [
  'green',
  'blue',
  'orange',
  'pink',
  'mono',
];
const ALIGNS: DesktopLyricsAlign[] = ['left', 'center', 'right'];
const LINES_MODES = ['single', 'double'] as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * The overlay consumes arbitrary numeric values, so the presets are only the
 * menu's shortcuts; anything else shows up as (and is edited through) the
 * checked "custom" entry, which keeps the radio group from showing no
 * selection at all.
 */
const customLabel = (prefix: string, inPresets: boolean, display: string) =>
  inPresets ? prefix : `${prefix} (${display})`;

const promptFontSize = async (
  ctx: MenuContext<DesktopLyricsConfig>,
  current: number,
) => {
  const output: unknown = await prompt(
    {
      title: t('plugins.desktop-lyrics.menu.font-size.label'),
      label: t('plugins.desktop-lyrics.menu.font-size.custom-prompt', {
        min: MIN_FONT_SIZE,
        max: MAX_FONT_SIZE,
      }),
      value: String(current),
      type: 'input',
      inputAttrs: {
        type: 'number',
        min: String(MIN_FONT_SIZE),
        max: String(MAX_FONT_SIZE),
        step: '1',
      },
      width: 420,
      ...promptOptions(),
    },
    ctx.window,
  );
  if (typeof output !== 'string') return;

  const size = Number.parseInt(output, 10);
  if (Number.isNaN(size)) return;
  ctx.setConfig({ fontSize: clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE) });
  ctx.refresh();
};

const promptOpacity = async (
  ctx: MenuContext<DesktopLyricsConfig>,
  current: number,
) => {
  const output: unknown = await prompt(
    {
      title: t('plugins.desktop-lyrics.menu.opacity.label'),
      label: t('plugins.desktop-lyrics.menu.opacity.custom-prompt', {
        min: Math.round(MIN_OPACITY * 100),
        max: 100,
      }),
      value: String(current),
      type: 'input',
      inputAttrs: {
        type: 'number',
        min: String(MIN_OPACITY),
        max: '1',
        step: '0.05',
      },
      width: 420,
      ...promptOptions(),
    },
    ctx.window,
  );
  if (typeof output !== 'string') return;

  const opacity = Number.parseFloat(output);
  if (Number.isNaN(opacity)) return;
  ctx.setConfig({
    opacity: Math.round(clamp(opacity, MIN_OPACITY, 1) * 100) / 100,
  });
  ctx.refresh();
};

const shortcutsTooltip = (enabled: boolean) => {
  const failed = getShortcutFeedback();
  if (enabled && failed.length > 0) {
    return t('plugins.desktop-lyrics.menu.shortcuts.register-failed', {
      accelerators: failed.join(' / '),
    });
  }
  return t('plugins.desktop-lyrics.menu.shortcuts.tooltip');
};

export const menu = async (
  ctx: MenuContext<DesktopLyricsConfig>,
): Promise<MenuItemConstructorOptions[]> => {
  const config = await ctx.getConfig();

  return [
    {
      label: t('plugins.desktop-lyrics.menu.show-overlay.label'),
      toolTip: t('plugins.desktop-lyrics.menu.show-overlay.tooltip'),
      type: 'checkbox',
      checked: config.visible,
      click() {
        ctx.setConfig({ visible: !config.visible });
        ctx.refresh();
      },
    },
    {
      label: t('plugins.desktop-lyrics.menu.lock.label'),
      toolTip: t('plugins.desktop-lyrics.menu.lock.tooltip'),
      type: 'checkbox',
      checked: config.locked,
      click(item) {
        ctx.setConfig({ locked: item.checked });
        ctx.refresh();
      },
    },
    {
      label: t('plugins.desktop-lyrics.menu.lines.label'),
      type: 'submenu',
      submenu: LINES_MODES.map((mode) => ({
        label: t(`plugins.desktop-lyrics.menu.lines.${mode}.label`),
        type: 'radio' as const,
        checked: config.lines === mode,
        click() {
          ctx.setConfig({ lines: mode });
          ctx.refresh();
        },
      })),
    },
    {
      label: t('plugins.desktop-lyrics.menu.font-size.label'),
      type: 'submenu',
      submenu: [
        ...FONT_SIZES.map((size) => ({
          label: `${size}`,
          type: 'radio' as const,
          checked: config.fontSize === size,
          click() {
            ctx.setConfig({ fontSize: size });
            ctx.refresh();
          },
        })),
        {
          label: customLabel(
            t('plugins.desktop-lyrics.menu.font-size.custom'),
            FONT_SIZES.includes(config.fontSize),
            `${config.fontSize}px`,
          ),
          type: 'radio' as const,
          checked: !FONT_SIZES.includes(config.fontSize),
          click() {
            promptFontSize(ctx, config.fontSize);
          },
        },
      ],
    },
    {
      label: t('plugins.desktop-lyrics.menu.font-family.label'),
      type: 'submenu',
      submenu: FONT_FAMILIES.map(({ id, value }) => ({
        label: t(`plugins.desktop-lyrics.menu.font-family.${id}.label`),
        type: 'radio' as const,
        checked: config.fontFamily === value,
        click() {
          ctx.setConfig({ fontFamily: value });
          ctx.refresh();
        },
      })),
    },
    {
      label: t('plugins.desktop-lyrics.menu.theme.label'),
      type: 'submenu',
      submenu: THEMES.map((theme) => ({
        label: t(`plugins.desktop-lyrics.menu.theme.${theme}.label`),
        type: 'radio' as const,
        checked: config.theme === theme,
        click() {
          ctx.setConfig({ theme });
          ctx.refresh();
        },
      })),
    },
    {
      label: t('plugins.desktop-lyrics.menu.opacity.label'),
      type: 'submenu',
      submenu: [
        ...OPACITIES.map((opacity) => ({
          label: `${Math.round(opacity * 100)}%`,
          type: 'radio' as const,
          checked: config.opacity === opacity,
          click() {
            ctx.setConfig({ opacity });
            ctx.refresh();
          },
        })),
        {
          label: customLabel(
            t('plugins.desktop-lyrics.menu.opacity.custom'),
            OPACITIES.includes(config.opacity),
            `${Math.round(config.opacity * 100)}%`,
          ),
          type: 'radio' as const,
          checked: !OPACITIES.includes(config.opacity),
          click() {
            promptOpacity(ctx, config.opacity);
          },
        },
      ],
    },
    {
      label: t('plugins.desktop-lyrics.menu.background.label'),
      toolTip: t('plugins.desktop-lyrics.menu.background.tooltip'),
      type: 'checkbox',
      checked: config.background,
      click(item) {
        ctx.setConfig({ background: item.checked });
        ctx.refresh();
      },
    },
    {
      label: t('plugins.desktop-lyrics.menu.align.label'),
      type: 'submenu',
      submenu: ALIGNS.map((align) => ({
        label: t(`plugins.desktop-lyrics.menu.align.${align}.label`),
        type: 'radio' as const,
        checked: config.align === align,
        click() {
          ctx.setConfig({ align });
          ctx.refresh();
        },
      })),
    },
    {
      label: t('plugins.desktop-lyrics.menu.karaoke.label'),
      toolTip: t('plugins.desktop-lyrics.menu.karaoke.tooltip'),
      type: 'checkbox',
      checked: config.karaoke,
      click(item) {
        ctx.setConfig({ karaoke: item.checked });
        ctx.refresh();
      },
    },
    {
      label: t('plugins.desktop-lyrics.menu.show-next-line.label'),
      type: 'checkbox',
      checked: config.showNextLine,
      click(item) {
        ctx.setConfig({ showNextLine: item.checked });
        ctx.refresh();
      },
    },
    {
      label: t('plugins.desktop-lyrics.menu.show-toolbar.label'),
      type: 'checkbox',
      checked: config.showToolbar,
      click(item) {
        ctx.setConfig({ showToolbar: item.checked });
        ctx.refresh();
      },
    },
    {
      label: t('plugins.desktop-lyrics.menu.click-to-seek.label'),
      toolTip: t('plugins.desktop-lyrics.menu.click-to-seek.tooltip'),
      type: 'checkbox',
      checked: config.clickToSeek,
      click(item) {
        ctx.setConfig({ clickToSeek: item.checked });
        ctx.refresh();
      },
    },
    {
      label: t('plugins.desktop-lyrics.menu.show-translation.label'),
      toolTip: t('plugins.desktop-lyrics.menu.show-translation.tooltip'),
      type: 'checkbox',
      checked: config.showTranslation,
      click(item) {
        ctx.setConfig({ showTranslation: item.checked });
        ctx.refresh();
      },
    },
    {
      label: t('plugins.desktop-lyrics.menu.time-offset.label'),
      toolTip: t('plugins.desktop-lyrics.menu.time-offset.tooltip'),
      type: 'submenu',
      submenu: TIME_OFFSETS.map(({ value, key }) => ({
        label: t(`plugins.desktop-lyrics.menu.time-offset.${key}`),
        type: 'radio' as const,
        checked: config.timeOffset === value,
        click() {
          ctx.setConfig({ timeOffset: value });
          ctx.refresh();
        },
      })),
    },
    {
      label: t('plugins.desktop-lyrics.menu.shortcuts.label'),
      toolTip: shortcutsTooltip(config.shortcuts),
      type: 'checkbox',
      checked: config.shortcuts,
      click(item) {
        ctx.setConfig({ shortcuts: item.checked });
        ctx.refresh();
      },
    },
  ];
};
