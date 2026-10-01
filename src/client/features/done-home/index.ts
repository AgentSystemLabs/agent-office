/** 🏠 The Workers panel's button that sends every worker that's done home at once (see shared/done-home.ts). */
import type { Ctx } from '../../core/context';
import { doneHomeButton } from '../../shared/done-home';
import { store } from '../../state';
import { $ } from '../../ui/dom';

/** Puts the button under the waiting count and keeps it up to date with the workers. */
export function installDoneHome(ctx: Ctx) {
  const button = doneHomeButton(ctx.net, () => store.workers.values());
  $('waiting').after(button.el);
  store.on('workers', button.render);
  store.on('project', button.render);
}
