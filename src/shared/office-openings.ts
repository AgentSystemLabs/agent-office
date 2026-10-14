import type { Opening } from './layout.js';
import { SCRANTON_DOOR } from './scranton.js';

/** Extra feature doorways cut by the office shell; their fixtures supply the adjoining rooms. */
export const OFFICE_OPENINGS: readonly Opening[] = [SCRANTON_DOOR];
