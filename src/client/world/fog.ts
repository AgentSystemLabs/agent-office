import { FLOOR, WALL_HEIGHT } from '../../shared/layout';

/**
 * The furthest off the haze ever is, however high up you are: past that nothing's built (the grass
 * and the road round the office end there, the city round the roof just past it), so it hides that.
 */
export const HAZE_MAX = 300;
/**
 * The haze thins out with height over the street: past HAZE_CLEAR meters up, every HAZE_ABOVE
 * meters more you see as far again as down on the street (from the roof of six floors, 3.4 times).
 */
export const HAZE_CLEAR = 6;
export const HAZE_ABOVE = 17.5;

const v3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`;

export const OFFICE_REGION = /* glsl */ `
// Inside the office's walls (and up through its open top), or the back office's, up to its ceiling
// and no further: its roof, and the cornice over where the wall came down, are outdoors.
float skyInOffice( vec3 p ) {
  vec3 d = max( ${v3(FLOOR.minX - 0.02, -0.06, FLOOR.minZ - 0.02)} - p, p - ${v3(FLOOR.maxX + 0.02, 40, FLOOR.maxZ + 0.02)} );
  vec3 w = max( vec3( skyWing.x, -0.06, skyWing.z ) - p, p - vec3( skyWing.y, ${(WALL_HEIGHT + 0.005).toFixed(3)}, skyWing.w ) );
  float wing = length( max( w, 0.0 ) ) + step( ${(WALL_HEIGHT + 0.005).toFixed(3)}, p.y );
  return 1.0 - smoothstep( 0.0, 0.12, min( length( max( d, 0.0 ) ), wing ) );
}

`;

/**
 * The haze, over three.js's own fog: it thins out with height over the street (see HAZE_ABOVE), as
 * thin as it is at your eye or at what you're looking at, whichever is higher. So from high up you
 * see further, the street below included, and from down on the street the top of the building is
 * as clear as the view from up there. Past HAZE_MAX there's nothing to see, whatever the height.
 */
export const HAZE_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vSkyFogWorld;
#endif
`;

/** World position of the vertex: the view matrix undone (its rotation's transpose), from the camera. */
export const HAZE_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vSkyFogWorld = vec3( dot( viewMatrix[ 0 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 2 ].xyz, mvPosition.xyz ) ) + cameraPosition;
#endif
`;

export const HAZE_PARS = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vSkyFogWorld;
  uniform float skyStreet;
  #ifndef SKY_LIT
    uniform float skyInside;
    uniform vec4 skyWing;
    ${OFFICE_REGION}
  #endif
#endif
`;

export const HAZE = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    // How many times as far off the haze is as down on the street; and past HAZE_MAX, from 45% of
    // the way there, as the haze on the roof always went.
    float skyReach = 1.0 + max( max( cameraPosition.y, vSkyFogWorld.y ) - skyStreet - ${HAZE_CLEAR.toFixed(1)}, 0.0 ) / ${HAZE_ABOVE.toFixed(1)};
    float fogFactor = max( smoothstep( fogNear, fogFar, vFogDepth / skyReach ), smoothstep( ${(HAZE_MAX * 0.45).toFixed(1)}, ${HAZE_MAX.toFixed(1)}, vFogDepth ) );
  #endif
  // Mask by the surface, so the view outside a window remains foggy from indoors.
  fogFactor *= 1.0 - skyInside * skyInOffice( vSkyFogWorld );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

