import { LOBBY } from '../../../shared/lobby';
import type { Ctx } from '../../core/context';
import { store } from '../../state';

/** Keep project-only controls off the public coworking floor. */
export function installLobby(ctx: Ctx) {
  const update = () => {
    const publicSpace = store.floor === LOBBY;
    for (const it of ctx.office.interactables) if (it.kind === 'expand') it.off = publicSpace;
    if (publicSpace) for (const desk of ctx.office.desks.values()) desk.vacancy.visible = false;
  };
  store.on('floorPlan', update);
  store.on('workers', update);
  store.on('floor', update);
}
