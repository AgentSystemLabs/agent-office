// Entering VR: whether this browser can, asking for a session, and what went wrong when it can't.
// Plain WebXR (navigator.xr + renderer.xr.setSession), following three's VRButton pattern
// (three/examples/jsm/webxr/VRButton.js): probe with isSessionSupported, request local-floor with
// bounded-floor as the fallback, hand-tracking as an optional feature.

/** The reference space three should render from once the session below is granted. */
export type VrReferenceSpace = 'local-floor' | 'bounded-floor' | 'local';

/** The smallest slice of Navigator this module needs, so tests can hand it a fake. */
export interface XrNavigator {
  xr?: {
    isSessionSupported(mode: string): Promise<boolean>;
    requestSession(mode: string, init?: XRSessionInit): Promise<XRSession>;
  };
}

export type XrAvailability = 'supported' | 'unsupported' | 'insecure';

/**
 * Whether the Enter VR button shows. Only an XR browser on a secure origin that grants
 * immersive-vr gets one; everywhere else the top bar stays exactly as it was.
 */
export async function probeXRSupport(nav: XrNavigator = navigator, secure = window.isSecureContext): Promise<XrAvailability> {
  if (!nav.xr) return secure ? 'unsupported' : 'insecure';
  try {
    return (await nav.xr.isSessionSupported('immersive-vr')) ? 'supported' : 'unsupported';
  } catch {
    // isSessionSupported rejects where XR is disallowed (permissions policy, no GPU process…).
    return 'unsupported';
  }
}

const HAND_FEATURES: string[] = ['hand-tracking'];

/**
 * Asks for an immersive-vr session: local-floor first (standing height, no setup), then
 * bounded-floor (room-scale with bounds), then whatever the runtime grants with both optional
 * (three renders from 'local' then, and the rig treats the floor as y=0 of the headset's start).
 * Returns the session and the reference space three must request for it.
 */
export async function requestVRSession(nav: XrNavigator = navigator): Promise<{ session: XRSession; referenceSpace: VrReferenceSpace }> {
  const xr = nav.xr;
  if (!xr) throw new Error('WebXR is not available in this browser');
  const attempts: { init: XRSessionInit; referenceSpace: VrReferenceSpace }[] = [
    { init: { requiredFeatures: ['local-floor'], optionalFeatures: [...HAND_FEATURES, 'bounded-floor', 'layers'] }, referenceSpace: 'local-floor' },
    { init: { requiredFeatures: ['bounded-floor'], optionalFeatures: [...HAND_FEATURES, 'local-floor', 'layers'] }, referenceSpace: 'bounded-floor' },
    { init: { optionalFeatures: ['local-floor', 'bounded-floor', ...HAND_FEATURES, 'layers'] }, referenceSpace: 'local' },
  ];
  let lastError: unknown = null;
  for (const a of attempts) {
    try {
      const session = await xr.requestSession('immersive-vr', a.init);
      return { session, referenceSpace: a.referenceSpace };
    } catch (err) {
      lastError = err;
      // The user saying no (or the headset being busy) is final: don't retry past a refusal.
      if (isRefusal(err)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not start a VR session');
}

/** A rejection because the user declined, the headset is busy, or XR is blocked here — not worth a fallback. */
function isRefusal(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  return name === 'NotAllowedError' || name === 'AbortError' || name === 'SecurityError';
}

/** What the toast says when entering VR fails: the real reason, in the user's words. */
export function describeSessionError(err: unknown): string {
  const e = err as { name?: unknown; message?: unknown };
  const msg = typeof e?.message === 'string' ? e.message : '';
  switch (e?.name) {
    case 'NotSupportedError':
      return /https|secure/i.test(msg) ? 'VR needs HTTPS or localhost — the page is not on a secure origin' : 'This headset or browser cannot do immersive VR';
    case 'SecurityError':
      return 'VR needs HTTPS or localhost — the page is not on a secure origin';
    case 'NotAllowedError':
      return 'The headset declined the VR session — try again from the browser on the headset';
    case 'AbortError':
      return 'No VR session — is the headset awake with its browser in the foreground?';
    case 'InvalidStateError':
      return 'A VR session is already running somewhere — end it first';
    default:
      return msg ? `Could not enter VR: ${msg}` : 'Could not enter VR';
  }
}
