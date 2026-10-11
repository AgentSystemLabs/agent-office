import { xrBrowserButton } from '../xr-browser';
/** Session-wide checklist tools; kept outside individual test cards. */
export const playtestToolbarExtensions: readonly (() => HTMLElement)[] = [xrBrowserButton];
