import { Race, TRACK } from './model';

/** A whole-circuit view keeps upcoming corners visible without moving the office camera. */
export function paintRace(canvas: HTMLCanvasElement, race: Race) {
  const c = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  c.fillStyle = '#162d28';
  c.fillRect(0, 0, w, h);
  c.save();
  const scale = Math.min(w / 430, h / 310);
  c.translate(w / 2, h / 2);
  c.scale(scale, scale);
  // The road uses the same radial bounds as the simulation.
  const ellipse = (r: number) => { c.beginPath(); c.ellipse(0, 0, TRACK.x * r, TRACK.y * r, 0, 0, Math.PI * 2); };
  ellipse(1.25); c.fillStyle = '#e5d8b8'; c.fill();
  ellipse(1.22); c.fillStyle = '#303c4e'; c.fill();
  ellipse(.78); c.fillStyle = '#e5d8b8'; c.fill();
  ellipse(.75); c.fillStyle = '#234a3a'; c.fill();
  ellipse(1); c.strokeStyle = '#c9d4db'; c.lineWidth = .7; c.setLineDash([5, 7]); c.stroke(); c.setLineDash([]);
  // Grandstands and infield details.
  for (let i = -2; i <= 2; i++) {
    c.fillStyle = '#3a6650'; c.fillRect(i * 21 - 8, -20, 16, 40);
    c.fillStyle = '#8ce7bc'; c.fillRect(i * 21 - 8, -20, 16, 3);
  }
  c.textAlign = 'center'; c.fillStyle = '#b6f2d4'; c.font = 'bold 12px sans-serif';
  c.fillText('CIRCUIT RACER', 0, -43);
  c.fillStyle = '#9bb9ab'; c.font = '7px sans-serif'; c.fillText('OFFICE MOTORSPORT CLUB', 0, 52);
  // Start/finish stripe across the northern straight.
  for (let row = 0; row < 8; row++) for (let col = 0; col < 2; col++) {
    c.fillStyle = (row + col) % 2 ? '#14202b' : '#fff';
    c.fillRect(col * 3 - 3, -122 + row * 5.5, 3, 5.5);
  }
  // Shadow, tyres, body and windscreen rotate with the car.
  c.save(); c.translate(race.x, race.y); c.rotate(race.yaw);
  c.fillStyle = '#0006'; c.fillRect(-8, -3, 18, 10);
  c.fillStyle = '#0a1320'; c.fillRect(-6, -6, 4, 3); c.fillRect(3, -6, 4, 3); c.fillRect(-6, 3, 4, 3); c.fillRect(3, 3, 4, 3);
  c.fillStyle = '#ffcc55'; c.fillRect(-8, -4, 17, 8);
  c.fillStyle = '#ffedb5'; c.fillRect(4, -3, 4, 6);
  c.fillStyle = '#183449'; c.fillRect(-2, -3, 5, 6);
  c.fillStyle = '#ef7657'; c.fillRect(-8, -3, 2, 6);
  c.restore(); c.restore();
}
