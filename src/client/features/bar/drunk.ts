import * as THREE from 'three';

/**
 * How the world looks after a few drinks at the rooftop bar (see booze.ts). While you're drunk the
 * frame is drawn into a texture first, then onto the screen through a shader that doubles it (two
 * images drifting apart and back), smears it, waves it like it's under water, lets the colors bleed
 * apart at the edges and darkens round them. Sober, everything draws straight to the screen as
 * always, and this costs nothing.
 */

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float amount;
uniform float time;
uniform float motion;
uniform vec2 texel;
varying vec2 vUv;

vec3 tap( vec2 uv ) {
  return texture2D( map, clamp( uv, vec2( 0.001 ), vec2( 0.999 ) ) ).rgb;
}

// A soft smear: the middle and four taps round it.
vec3 smear( vec2 uv, vec2 r ) {
  return tap( uv ) * 0.4 + ( tap( uv + vec2( r.x, 0.0 ) ) + tap( uv - vec2( r.x, 0.0 ) ) + tap( uv + vec2( 0.0, r.y ) ) + tap( uv - vec2( 0.0, r.y ) ) ) * 0.15;
}

void main() {
  float a = clamp( amount, 0.0, 1.6 );
  float k = min( a, 1.0 );
  float t = time * motion;
  vec2 c = vUv - 0.5;
  // The room breathes in and out, and ripples like it's under water.
  vec2 uv = 0.5 + c * ( 1.0 - 0.03 * a * ( 0.5 + 0.5 * sin( t * 0.8 ) ) );
  uv += vec2( sin( uv.y * 7.0 + t * 1.4 ), cos( uv.x * 6.0 + t * 1.1 ) ) * 0.005 * a;
  // Two of everything.
  vec2 off = vec2( sin( t * 0.7 + 1.0 ), 0.45 * cos( t * 0.53 ) ) * ( 0.008 + 0.014 * a ) * k;
  vec2 r = texel * ( 1.0 + 3.5 * a );
  vec3 col = mix( smear( uv, r ), smear( uv + off, r ), 0.45 * k );
  // Colors bleed apart toward the edges.
  float edge = dot( c, c );
  vec2 ca = c * 0.02 * a * ( 0.25 + edge * 2.5 );
  col.r = mix( col.r, tap( uv + ca ).r, 0.6 * k );
  col.b = mix( col.b, tap( uv - ca ).b, 0.6 * k );
  // Warm, a little oversaturated, and dark round the edges.
  float lum = dot( col, vec3( 0.299, 0.587, 0.114 ) );
  col = max( mix( vec3( lum ), col, 1.0 + 0.4 * k ), 0.0 );
  col *= mix( vec3( 1.0 ), vec3( 1.08, 0.98, 0.9 ), k );
  col *= 1.0 - smoothstep( 0.12, 0.62, edge ) * 0.6 * k;
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}
`;

export class DrunkVision {
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  private readonly warmMap = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly size = new THREE.Vector2();
  private prepared = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.warmMap.colorSpace = THREE.SRGBColorSpace;
    this.warmMap.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null },
        amount: { value: 0 },
        time: { value: 0 },
        motion: { value: 1 },
        texel: { value: new THREE.Vector2() },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Allocates the target and compiles the shader before the first visible drunk frame needs them. */
  prepare() {
    const target = this.ensureTarget();
    if (this.prepared) return;
    const previous = this.renderer.getRenderTarget();
    const u = this.mat.uniforms;
    u.map.value = this.warmMap;
    u.amount.value = 0;
    u.time.value = 0;
    u.motion.value = 0;
    u.texel.value.set(1 / target.width, 1 / target.height);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    this.prepared = true;
  }

  private ensureTarget(): THREE.WebGLRenderTarget {
    // At no more than 1.5 pixels to a CSS pixel: it's all going to be smeared anyway.
    const css = this.renderer.getSize(this.size);
    const scale = Math.min(this.renderer.getPixelRatio(), 1.5);
    const w = Math.max(1, Math.round(css.x * scale));
    const h = Math.max(1, Math.round(css.y * scale));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      // An sRGB target keeps the darks from banding in 8 bits; multisampled, like the screen.
      this.target = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      this.prepared = false;
    }
    return this.target;
  }

  /** Sends what's drawn next into the texture instead of onto the screen. */
  begin() {
    const target = this.ensureTarget();
    this.renderer.setRenderTarget(target);
  }

  /** Puts the frame on the screen, `amount` drunk (see Booze.amount); `motion` false holds it still. */
  end(amount: number, time: number, motion: boolean) {
    const target = this.target!;
    this.renderer.setRenderTarget(null);
    const u = this.mat.uniforms;
    u.map.value = target.texture;
    u.amount.value = amount;
    u.time.value = time;
    u.motion.value = motion ? 1 : 0;
    u.texel.value.set(1 / target.width, 1 / target.height);
    this.renderer.render(this.scene, this.camera);
  }

  /** Lets go of the texture once you've sobered up. */
  release() {
    this.target?.dispose();
    this.target = null;
    this.prepared = false;
  }
}
