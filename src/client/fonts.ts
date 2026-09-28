// The office's bundled fonts (public/fonts, no CDN): Geist for prose and long-form content,
// Geist Mono for UI chrome, metadata and anything drawn on a world canvas.

export const SANS = "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif";
export const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * The terminals' font stack (the xterm windows and the 3D laptop screens painting them).
 * Geist Mono for text, then the bundled Symbols Nerd Font Mono plus any full Nerd Font the
 * system has for oh-my-zsh / powerline / devicon glyphs, then the OS symbol and emoji fonts
 * so nothing renders as tofu.
 */
export const TERM_FONT = [
  "'Geist Mono'",
  "'Symbols Nerd Font Mono'",
  "'JetBrainsMono Nerd Font Mono'",
  "'JetBrainsMono Nerd Font'",
  "'FiraCode Nerd Font Mono'",
  "'FiraCode Nerd Font'",
  "'Hack Nerd Font Mono'",
  "'Hack Nerd Font'",
  "'MesloLGS NF'",
  "'CaskaydiaCove Nerd Font'",
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Consolas',
  "'Apple Symbols'",
  "'Segoe UI Symbol'",
  "'Noto Sans Symbols 2'",
  "'Apple Color Emoji'",
  "'Segoe UI Emoji'",
  "'Noto Color Emoji'",
  'monospace',
].join(', ');

/**
 * Loads the weights the canvas painters and HUD use, so textures don't silently draw with
 * fallback fonts. Call once at boot, then invalidate and redraw anything painted before it
 * resolved (see main.ts).
 */
export function loadFonts(): Promise<unknown> {
  return Promise.all([
    document.fonts.load('400 16px Geist'),
    document.fonts.load('600 16px Geist'),
    document.fonts.load('700 16px Geist'),
    document.fonts.load('400 16px "Geist Mono"'),
    document.fonts.load('500 16px "Geist Mono"'),
    document.fonts.load('700 16px "Geist Mono"'),
    // A powerline glyph (U+E0B0), so the symbols font is ready before a prompt paints one.
    document.fonts.load('400 16px "Symbols Nerd Font Mono"', '\ue0b0'),
  ]).catch(() => undefined);
}
