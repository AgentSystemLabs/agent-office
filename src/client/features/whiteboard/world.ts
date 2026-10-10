import { WHITEBOARD } from '../../../shared/layout';
import { buildRollingBoard, type RollingBoard } from '../../world/rolling-board';
import type { Fixture } from '../../world/office/fixture';
export type WhiteboardStand = RollingBoard;
export const buildWhiteboard = () => buildRollingBoard({ ...WHITEBOARD, label: '📝 Whiteboard', kind: 'whiteboard' });

declare module '../../world/types' {
  interface OfficeHandles {
    /** The rolling whiteboard everyone draws on together. */
    whiteboard: WhiteboardStand;
  }
}

/** The whiteboard, out on the floor between the desks and the lounge. */
export const whiteboard: Fixture<'whiteboard'> = () => {
  const built = buildWhiteboard();
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable], handle: { whiteboard: built } };
};
