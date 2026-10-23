import type { Frame } from '../../core/registry';
import type { Stage } from '../../core/scene';
import { pocketOverlay } from './overlay';
import { modalOpen } from '../../ui/dom';

export function softwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software (?:rasterizer|renderer)|microsoft basic render/i.test(name);
}

/** Keep the native inspector responsive. Software WebGL still draws the real scene, at a bounded cost. */
export function pocketPresentation(overlay: { readonly open: boolean } = pocketOverlay, localModal = modalOpen) {
  let software = false;
  let lastDraw = -Infinity;
  return {
    setup(stage: Stage) {
      try {
        const gl = stage.renderer.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        software = !!debug && softwareRenderer(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)));
      } catch { /* An unavailable renderer description must not prevent entry. */ }
      if (software) {
        stage.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 0.6));
        stage.renderer.shadowMap.enabled = false;
        stage.effect.enabled = false;
      }
    },
    shouldDraw({ now }: Pick<Frame, 'now'>): boolean {
      if (overlay.open || (software && (localModal() || now - lastDraw < 50))) return false;
      lastDraw = now;
      return true;
    },
  };
}
