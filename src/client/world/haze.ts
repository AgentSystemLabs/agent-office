import { FLOOR, WALL_HEIGHT } from '../../shared/layout';

/*
 * The haze over everything outside: three.js's own fog, swapped (in sky.ts) for one that thins out
 * with height over the street and stays out of the office.
 */

/**
 * The furthest off the haze ever is, however high up you are: past that nothing's built (the grass
 * and the road round the office end there, the city round the roof just past it), so it hides that.
 */
export const HAZE_MAX = 300;
/**
 * The haze thins out with height over the street: past HAZE_CLEAR meters up, every HAZE_ABOVE
 * meters more you see as far again as down on the street (from the roof of six floors, 3.4 times).
 */
const HAZE_CLEAR = 6;
const HAZE_ABOVE = 17.5;

/**
 * How far off something's lost in the haze (with the fog's far edge down on the street at `far`),
 * seen from or standing `above` meters over the street, whichever's higher (see HAZE).
 */
export function hazeReach(above: number, far: number): number {
  return Math.min(HAZE_MAX, far * (1 + Math.max(0, above - HAZE_CLEAR) / HAZE_ABOVE));
}

const v3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`;

/**
 * The haze, over three.js's own fog: it thins out with height over the street (see HAZE_ABOVE), as
 * thin as it is at your eye or at what you're looking at, whichever is higher. So from high up you
 * see further, the street below included, and from down on the street the top of the building is
 * as clear as the view from up there. Past HAZE_MAX there's nothing to see, whatever the height.
 * The haze is outside: only the stretch of the way to what you're looking at that's out of the
 * office's walls (and the back office's) counts, so in there the desks stay clear and the fog
 * starts at the windows. Not on the roof, or in a hall of its own (the castle keeps its gloom).
 */
export const HAZE_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vSkyFogW;
#endif
`;

/** Where the vertex is: the view matrix undone (its rotation's transpose), from the camera. */
export const HAZE_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vSkyFogW = vec3( dot( viewMatrix[ 0 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 2 ].xyz, mvPosition.xyz ) ) + cameraPosition;
#endif
`;

export const HAZE_PARS = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vSkyFogW;
  uniform float skyStreet;
  uniform float skyHazeInside;
  uniform vec4 skyHazeWing;

  // How much of the way from a to b is inside the box lo–hi, 0–1.
  float skyThrough( vec3 a, vec3 b, vec3 lo, vec3 hi ) {
    vec3 d = b - a;
    vec3 inv = ( vec3( greaterThanEqual( d, vec3( 0.0 ) ) ) * 2.0 - 1.0 ) / max( abs( d ), vec3( 1e-5 ) );
    vec3 t0 = ( lo - a ) * inv;
    vec3 t1 = ( hi - a ) * inv;
    vec3 n = min( t0, t1 );
    vec3 f = max( t0, t1 );
    return max( min( min( f.x, f.y ), min( f.z, 1.0 ) ) - max( max( n.x, n.y ), max( n.z, 0.0 ) ), 0.0 );
  }
#endif
`;

export const HAZE = /* glsl */ `
#ifdef USE_FOG
  // Only the way through the open air: what's inside the office's walls (or the back office's) doesn't count.
  float skyIn = skyThrough( cameraPosition, vSkyFogW, ${v3(FLOOR.minX, -0.06, FLOOR.minZ)}, ${v3(FLOOR.maxX, WALL_HEIGHT, FLOOR.maxZ)} );
  if ( skyHazeWing.x < skyHazeWing.y ) skyIn += skyThrough( cameraPosition, vSkyFogW, vec3( skyHazeWing.x, -0.06, skyHazeWing.z ), vec3( skyHazeWing.y, ${WALL_HEIGHT.toFixed(3)}, skyHazeWing.w ) );
  float skyDepth = vFogDepth * ( 1.0 - skyHazeInside * min( skyIn, 1.0 ) );
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * skyDepth * skyDepth );
  #else
    // How many times as far off the haze is as down on the street; and past HAZE_MAX, from 45% of
    // the way there, as the haze on the roof always went.
    float skyReach = 1.0 + max( max( cameraPosition.y, vSkyFogW.y ) - skyStreet - ${HAZE_CLEAR.toFixed(1)}, 0.0 ) / ${HAZE_ABOVE.toFixed(1)};
    float fogFactor = max( smoothstep( fogNear, fogFar, skyDepth / skyReach ), smoothstep( ${(HAZE_MAX * 0.45).toFixed(1)}, ${HAZE_MAX.toFixed(1)}, skyDepth ) );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
