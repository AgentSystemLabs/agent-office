// The rows of the controls help (openHelp in hud.ts), in the order it shows them: a key or an emoji, and
// what it does. A new control is a new row in help.rows, in every language (shared/locales).

import { IS_MAC } from './termkeys';
import { L } from '../i18n';

/** The rows in the page's language (see help.rows in shared/locales), with the command palette's key for this machine. */
export const HELP_ROWS: readonly (readonly [string, string])[] = L.help.rows(IS_MAC ? '⌘K' : 'Ctrl+K');
