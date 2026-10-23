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
    prepare(canvas: HTMLCanvasElement) {
      const probe = document.createElement('canvas');
      let gl: WebGL2RenderingContext | null;
      try { gl = probe.getContext('webgl2', { antialias: false }); } catch { return; }
      if (!gl) return;
      try {
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        if (debug && softwareRenderer(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)))) {
          // Context attributes are fixed at creation. Keep hardware AA; avoid software MSAA's raster cost.
          canvas.getContext('webgl2', { alpha: false, antialias: false });
        }
      } catch { /* The normal renderer still decides whether WebGL is available. */ }
      finally { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* Already lost. */ } }
    },
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
    afterDraw() {
      if (!software) return;
      // Start idle time after slow submission, rather than immediately drawing another overdue frame.
      lastDraw = performance.now();
    },
    shouldDraw({ now }: Pick<Frame, 'now'>): boolean {
      if (overlay.open || (software && (localModal() || now - lastDraw < 200))) return false;
      lastDraw = now;
      return true;
    },
  };
}
