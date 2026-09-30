import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { Gallery } from '../../world/gallery';

/** The pictures people hung on the walls, as the office has them. */
export function installGallery(ctx: Ctx): Gallery {
  // Pictures people hung on the walls
  const gallery = new Gallery();
  ctx.office.group.add(gallery.group);
  store.on('decor', () => gallery.sync(store.decor));
  return gallery;
}
