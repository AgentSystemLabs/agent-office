import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { Gallery } from './world';

/** The pictures people hung on the walls, as the office has them. */
export function installGallery(ctx: Ctx): Gallery {
  // Pictures people hung on the walls
  const gallery = new Gallery();
  ctx.office.group.add(gallery.group);
  store.on('decor', () => gallery.sync(store.decor));
  // What's hung on the walls is there to use (and to aim at: it's on the building).
  ctx.usables.add({ usable: () => gallery.interactables });
  return gallery;
}
