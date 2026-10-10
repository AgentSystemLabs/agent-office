import { PLAYTEST_MODES, testModes, testOutcome } from '../../../shared/playtest-categories';
import type { PlaytestState } from '../../../shared/playtests';

/** Six readable mode tiles instead of an arbitrary handful of individual tests. */
export function paintPlaytestSummary(canvas: HTMLCanvasElement, state: PlaytestState | null, error = false) {
  const g = canvas.getContext('2d')!, W = canvas.width, H = canvas.height;
  g.fillStyle = '#fffaf0'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#29283f'; g.font = '900 76px Nunito, sans-serif'; g.fillText('Deine Playtests', 34, 88);
  g.font = '700 34px Nunito, sans-serif'; g.fillStyle = '#716782';
  g.fillText(error ? 'Aktualisierung fehlgeschlagen · E zum Öffnen' : state ? `${state.items.filter(t => testOutcome(t) !== 'passed').length} offen · ${state.items.length} Tests insgesamt` : 'Checkliste wird geladen…', 38, 145);
  const gap = 24, tileW = (W - 3 * gap) / 2, tileH = (H - 280) / 3;
  PLAYTEST_MODES.forEach((mode, index) => {
    const x = gap + (index % 2) * (tileW + gap), y = 180 + Math.floor(index / 2) * (tileH + 15);
    const items = state?.items.filter(t => testModes(t).includes(mode)) ?? [];
    const passed = items.filter(t => testOutcome(t) === 'passed').length;
    const failed = items.filter(t => testOutcome(t) === 'failed').length;
    g.fillStyle = ['#e9e1f8', '#dff2df', '#ffe3d1', '#ddeafc', '#fff0bd', '#daf3ee'][index];
    g.fillRect(x, y, tileW, tileH); g.strokeStyle = '#3b3650'; g.lineWidth = 3; g.strokeRect(x, y, tileW, tileH);
    g.fillStyle = '#29283f'; g.font = '900 46px Nunito, sans-serif'; g.fillText(mode, x + 20, y + 52);
    g.font = '700 30px Nunito, sans-serif'; g.fillText(`${items.length - passed} offen · ${passed} bestanden${failed ? ` · ${failed} Fehler` : ''}`, x + 20, y + 95);
    g.fillStyle = '#ffffffa0'; g.fillRect(x + 20, y + tileH - 30, tileW - 40, 10);
    g.fillStyle = '#319379'; g.fillRect(x + 20, y + tileH - 30, items.length ? (tileW - 40) * passed / items.length : 0, 10);
  });
  g.fillStyle = '#29283f'; g.font = '800 30px Nunito, sans-serif'; g.fillText('E · Modus wählen, testen und Ergebnis festhalten', 32, H - 26);
}
