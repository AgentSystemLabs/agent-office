// Every Spanish UI string, split so no file grows past the size guard.
import { part01 } from './part-01';
import { part02 } from './part-02';
import { part03 } from './part-03';
import { part04 } from './part-04';
import { part05 } from './part-05';
import { part06 } from './part-06';
import { part07 } from './part-07';
import { part08 } from './part-08';
import { part09 } from './part-09';
import { part10 } from './part-10';
import { part11 } from './part-11';
import { part12 } from './part-12';
import { part13 } from './part-13';
import { manual } from './manual';

export const es: Record<string, string> = {
  ...part01,
  ...part02,
  ...part03,
  ...part04,
  ...part05,
  ...part06,
  ...part07,
  ...part08,
  ...part09,
  ...part10,
  ...part11,
  ...part12,
  ...part13,
  ...manual,
};
