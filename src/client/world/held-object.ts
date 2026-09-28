import * as THREE from 'three';
import type { CarriedObject } from '../../shared/protocol';
import { HeldCard } from './card';
import { coffeeMug } from './character';

/** Shared geometry and offsets for local XR attachments and peer carry poses. */
export class HeldObjectView {
  readonly root = new THREE.Group();
  private cardRoot = new THREE.Group();
  private card = new HeldCard(this.cardRoot, 0.28);
  private mug = coffeeMug();

  constructor() {
    this.cardRoot.position.set(0, 0.05, -0.06);
    this.mug.position.set(0, -0.04, -0.04);
    this.root.add(this.cardRoot, this.mug);
    this.root.visible = false;
  }

  set(item: CarriedObject | null | undefined): void {
    this.root.visible = !!item;
    this.card.set(item && item.kind !== 'coffee' ? item : null);
    this.mug.visible = item?.kind === 'coffee';
    this.mug.children[1].visible = item?.kind === 'coffee' && !item.empty;
  }

  pose(item: CarriedObject | null | undefined): void {
    this.set(item?.pose ? item : null);
    if (!item?.pose) return;
    this.root.position.fromArray(item.pose.position);
    this.root.quaternion.fromArray(item.pose.quaternion);
  }

  dispose(): void {
    this.card.set(null);
    this.mug.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.root.removeFromParent();
  }
}
