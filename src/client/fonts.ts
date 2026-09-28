// The office's bundled fonts (public/fonts, no CDN): Geist for prose and long-form content,
// Geist Mono for UI chrome, metadata and anything drawn on a world canvas.

export const SANS = "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif";
export const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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
  ]).catch(() => undefined);
}
