import { xrSessionButton } from '../xr-playtests';
/** Session-wide checklist tools; kept outside individual test cards. */
export const playtestToolbarExtensions: readonly (() => HTMLElement)[] = [xrSessionButton];
