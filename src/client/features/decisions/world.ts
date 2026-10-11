import * as THREE from 'three';
import { bossMonitor } from '../../world/office/boss-monitor';
import type { Fixture } from '../../world/office/fixture';
import type { Interactable } from '../../world/types';
export function mountDecisionMonitor(bossScreen: THREE.Mesh) {
  const desk = bossScreen.parent!.parent!, built = bossMonitor(-0.52);
  desk.add(built.group); desk.updateWorldMatrix(true, true);
  const point = built.screen.getWorldPosition(new THREE.Vector3());
  const it: Interactable = { kind: 'decisions', x: point.x, y: point.y - 1.18, z: point.z + 0.9, radius: 1.6 };
  built.screen.userData.interact = it; built.group.userData.interact = it;
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const c = canvas.getContext('2d')!, texture = new THREE.CanvasTexture(canvas);
  const mat = built.screen.material as THREE.MeshBasicMaterial; mat.color.set('#ffffff'); mat.map = texture;
  const alertCanvas = document.createElement('canvas'); alertCanvas.width = 768; alertCanvas.height = 160;
  const a = alertCanvas.getContext('2d')!, alertTexture = new THREE.CanvasTexture(alertCanvas);
  const alert = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTexture, depthTest: false }));
  alert.position.set(0, 1.8, -0.15); alert.scale.set(1.9, 0.4, 1); built.group.add(alert);
  let blocked = 0;
  function render(open: number, count: number) {
    blocked = count; alert.visible = count > 0;
    c.fillStyle = count ? '#702440' : '#253b50'; c.fillRect(0,0,640,360);
    c.textAlign = 'center'; c.fillStyle = '#fff7dc'; c.font = 'bold 48px sans-serif'; c.fillText('Entscheidungen',320,90);
    c.font = 'bold 88px sans-serif'; c.fillText(String(open),320,203);
    c.font = '32px sans-serif'; c.fillText(count ? `${count} ${count === 1 ? 'blockiert' : 'blockieren'} Arbeit` : 'Fragen an dich',320,275); texture.needsUpdate = true;
    a.clearRect(0,0,768,160); a.fillStyle = '#e84779'; a.strokeStyle = '#303048'; a.lineWidth = 10; a.beginPath(); a.roundRect(5,5,758,150,30); a.fill(); a.stroke();
    a.fillStyle = '#fff'; a.textAlign='center'; a.font='bold 37px sans-serif'; a.fillText(`${count} Entscheidung${count === 1 ? '' : 'en'} ${count === 1 ? 'braucht' : 'brauchen'} dich`,384,92); alertTexture.needsUpdate=true;
  }
  render(0,0);
  return { screen: built.screen, interactable: it, render, update(t: number) { alert.material.opacity = blocked ? 0.84 + Math.sin(t * 3) * 0.16 : 0; } };
}
declare module '../../world/types' { interface OfficeHandles { decisionMonitor: ReturnType<typeof mountDecisionMonitor> } }
export const decisionMonitor: Fixture<'decisionMonitor'> = site => {
  const built = mountDecisionMonitor(site.get('bossScreen'));
  return { handle: { decisionMonitor: built }, interactables: [built.interactable], update: t => built.update(t) };
};
