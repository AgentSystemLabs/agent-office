import * as THREE from 'three';
import { MEETING_PATTERNS, meetingSummary } from '../../shared/meetings';
import { fmtCost, fmtTokens, type Meeting, type MeetingState } from '../../shared/protocol';

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const INK = '#2b2d42';

function canvasTexture(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, g: canvas.getContext('2d')!, texture };
}

/** Breaks text into lines no wider than `maxW`, cutting words too long for a line of their own. */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (cur && g.measureText(`${cur} ${word}`).width > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
    while (g.measureText(cur).width > maxW && cur.length > 1) {
      let cut = cur.length - 1;
      while (cut > 1 && g.measureText(cur.slice(0, cut)).width > maxW) cut--;
      lines.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Who has the floor right now: the roles on the parts being worked on. */
export function speaking(m: Meeting): string[] {
  return m.turns.filter((t) => t.state !== 'done').map((t) => m.seats[t.seat]?.role ?? '?');
}

/** What's on the table in a line: "Round 2 of 3 · critiquing". */
export function meetingStage(m: Meeting): string {
  const doing = [...new Set(m.turns.filter((t) => t.state !== 'done').map((t) => t.doing))].join(', ');
  return `Round ${m.round} of ${m.rounds}${doing ? ` · ${doing}` : ''}`;
}

/**
 * The board on the meeting room's back wall: the meeting's output file as it's being written, like a
 * shared screen, with what's being worked on across the top.
 */
export class MeetingBoardTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;

  constructor() {
    const c = canvasTexture(1500, 500);
    this.canvas = c.canvas;
    this.g = c.g;
    this.texture = c.texture;
  }

  render(state: MeetingState) {
    const { g } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#fbfdff';
    g.fillRect(0, 0, W, H);
    const m = state.current;
    g.textBaseline = 'alphabetic';
    if (!m) {
      g.fillStyle = INK;
      g.textAlign = 'center';
      g.font = `900 64px ${FONT}`;
      g.fillText('🤝 The meeting room is free', W / 2, H / 2 - 10);
      g.font = `700 36px ${FONT}`;
      g.fillStyle = '#5c5f73';
      g.fillText('Press E at the table to call a meeting: whatever it writes shows up here.', W / 2, H / 2 + 50);
      g.textAlign = 'left';
      this.texture.needsUpdate = true;
      return;
    }
    const p = MEETING_PATTERNS[m.pattern];
    // Across the top: the file, and where the meeting is.
    g.fillStyle = m.status === 'stopped' ? '#ffd6e0' : m.status === 'done' ? '#caffbf' : '#e7f5ff';
    g.fillRect(0, 0, W, 70);
    g.fillStyle = INK;
    g.font = `800 36px ${MONO}`;
    g.fillText(`📄 ${m.output}`, 24, 48);
    g.font = `800 34px ${FONT}`;
    g.textAlign = 'right';
    g.fillText(`${p.icon} ${p.label} · ${m.status === 'running' ? meetingStage(m) : m.status === 'done' ? '✅ done' : '⛔ stopped'}`, W - 24, 48);
    g.textAlign = 'left';

    const text = (m.preview ?? '').replace(/\r/g, '');
    if (!text.trim()) {
      g.fillStyle = '#8d99ae';
      g.font = `800 44px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(m.status === 'running' ? `Nothing written yet: ${speaking(m).join(', ') || 'the table'} ${speaking(m).length === 1 ? 'is' : 'are'} on it` : m.reason ? `⛔ ${m.reason}` : 'Nothing was written', W / 2, H / 2 + 30);
      g.textAlign = 'left';
      this.texture.needsUpdate = true;
      return;
    }
    // The file, markdown-ish: headings bold and bigger, the rest as it is. Only what fits: its start.
    let y = 118;
    const x = 30;
    const maxW = W - 60;
    for (const raw of text.split('\n')) {
      if (y > H - 14) break;
      const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
      const line = heading ? heading[2] : raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
      const size = heading ? (heading[1].length === 1 ? 44 : 36) : 28;
      g.font = heading ? `900 ${size}px ${FONT}` : `600 ${size}px ${FONT}`;
      g.fillStyle = heading ? INK : '#3d405b';
      if (!line.trim()) {
        y += size * 0.5;
        continue;
      }
      for (const l of wrap(g, line, maxW)) {
        if (y > H - 14) break;
        g.fillText(l, x, y);
        y += size * 1.25;
      }
    }
    this.texture.needsUpdate = true;
  }
}

/**
 * The panel on the glass beside the meeting room's door, like a room-booking screen: what's on, the
 * round, who has the floor and the tokens against the budget; once it's over, its one-line summary.
 */
export class MeetingSignTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;

  constructor() {
    const c = canvasTexture(500, 800);
    this.canvas = c.canvas;
    this.g = c.g;
    this.texture = c.texture;
  }

  render(state: MeetingState) {
    const { g } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const m = state.current;
    const pad = 28;
    const lines = (text: string, font: string, color: string, y: number, max: number, lh: number) => {
      g.font = font;
      g.fillStyle = color;
      for (const l of wrap(g, text, W - 2 * pad).slice(0, max)) {
        g.fillText(l, pad, y);
        y += lh;
      }
      return y;
    };
    g.fillStyle = !m ? '#2b2d42' : m.status === 'running' ? '#1d3557' : m.status === 'done' ? '#1b4332' : '#6a040f';
    g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    // A strip across the top says whether the room is taken.
    const [strip, label] = !m ? ['#06d6a0', '● FREE'] : m.status === 'running' ? ['#ffd166', '● IN A MEETING'] : m.status === 'done' ? ['#9ef01a', '✅ DONE'] : ['#ffb3c1', '⛔ STOPPED'];
    g.fillStyle = strip;
    g.fillRect(0, 0, W, 78);
    g.fillStyle = INK;
    g.font = `900 38px ${FONT}`;
    g.fillText(label, pad, 53);
    if (!m) {
      let y = lines('🤝 Meeting room', `900 50px ${FONT}`, '#fffaf3', 160, 2, 58);
      lines('Press E at the table to call a meeting: a debate, lead & team, map-reduce, red / blue or a review panel.', `700 32px ${FONT}`, '#e9ecef', y + 30, 8, 42);
      this.texture.needsUpdate = true;
      return;
    }
    const p = MEETING_PATTERNS[m.pattern];
    let y = lines(`${p.icon} ${p.label}`, `800 34px ${FONT}`, '#ffd166', 130, 1, 40);
    y = lines(m.title, `900 44px ${FONT}`, '#fffaf3', y + 16, 3, 50);
    y += 18;
    if (m.status === 'running') {
      y = lines(meetingStage(m), `800 32px ${FONT}`, '#e9ecef', y, 3, 40);
      const who = speaking(m);
      if (who.length) lines(`💬 ${who.join(', ')}`, `700 30px ${FONT}`, '#bde0fe', y + 8, 3, 38);
      // The budget, as a bar that fills up, and what's been spent.
      const f = Math.min(1, m.tokens / Math.max(1, m.budget));
      const barY = H - 118;
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.fillRect(pad, barY, W - 2 * pad, 20);
      g.fillStyle = f > 0.9 ? '#ef476f' : f > 0.7 ? '#ffd166' : '#06d6a0';
      g.fillRect(pad, barY, (W - 2 * pad) * f, 20);
      g.fillStyle = '#fffaf3';
      g.font = `800 30px ${FONT}`;
      g.fillText(`${fmtTokens(m.tokens)} of ${fmtTokens(m.budget)} tokens`, pad, H - 58);
      g.font = `700 28px ${FONT}`;
      g.fillStyle = '#e9ecef';
      if (m.cost > 0) g.fillText(`${fmtCost(m.cost)}${m.costKnown ? '' : '+'} so far`, pad, H - 22);
    } else {
      // The summary line after the pattern, which is up top already.
      lines(meetingSummary(m).split(' · ').slice(1).join(' · '), `700 30px ${FONT}`, '#e9ecef', y, Math.floor((H - y) / 38), 38);
    }
    this.texture.needsUpdate = true;
  }
}
