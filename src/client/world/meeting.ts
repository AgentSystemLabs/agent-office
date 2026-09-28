import * as THREE from 'three';
import { MEETING_PATTERNS, meetingSummary } from '../../shared/meetings';
import { fmtCost, fmtTokens, type Meeting, type MeetingState } from '../../shared/protocol';
import { SANS, MONO } from '../fonts';

const INK = '#eeeeee';
const MUTED = '#8c8c8c';

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
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, W, H);
    const m = state.current;
    g.textBaseline = 'alphabetic';
    if (!m) {
      g.fillStyle = INK;
      g.textAlign = 'center';
      g.font = `700 56px ${SANS}`;
      g.fillText('🤝 The meeting room is free', W / 2, H / 2 - 10);
      g.font = `500 34px ${SANS}`;
      g.fillStyle = MUTED;
      g.fillText('Press E at the table to call a meeting: whatever it writes shows up here.', W / 2, H / 2 + 50);
      g.textAlign = 'left';
      this.texture.needsUpdate = true;
      return;
    }
    const p = MEETING_PATTERNS[m.pattern];
    // Across the top: the file, and where the meeting is, on a tinted band with an accent edge.
    g.fillStyle = m.status === 'stopped' ? 'rgba(239, 68, 68, .12)' : m.status === 'done' ? 'rgba(60, 207, 145, .12)' : 'rgba(90, 169, 230, .1)';
    g.fillRect(0, 0, W, 70);
    g.fillStyle = m.status === 'stopped' ? '#ef4444' : m.status === 'done' ? '#3ccf91' : '#5aa9e6';
    g.fillRect(0, 0, 8, 70);
    g.fillStyle = '#ee6018';
    g.font = `600 36px ${MONO}`;
    g.fillText(`📄 ${m.output}`, 24, 48);
    g.font = `500 30px ${SANS}`;
    g.fillStyle = MUTED;
    g.textAlign = 'right';
    g.fillText(`${p.icon} ${p.label} · ${m.status === 'running' ? meetingStage(m) : m.status === 'done' ? '✅ done' : '⛔ stopped'}`, W - 24, 48);
    g.textAlign = 'left';

    const text = (m.preview ?? '').replace(/\r/g, '');
    if (!text.trim()) {
      g.fillStyle = '#8c8c8c';
      g.font = `500 42px ${SANS}`;
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
      g.font = heading ? `700 ${size}px ${SANS}` : `400 ${size}px ${SANS}`;
      g.fillStyle = heading ? INK : '#c9c9c9';
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
    g.fillStyle = !m ? '#0a0a0a' : m.status === 'running' ? '#10141a' : m.status === 'done' ? '#0f1a13' : '#1f0d0f';
    g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    // A strip across the top says whether the room is taken.
    const [strip, label] = !m ? ['#3ccf91', '● FREE'] : m.status === 'running' ? ['#f2b84b', '● IN A MEETING'] : m.status === 'done' ? ['#8ae65c', '✅ DONE'] : ['#f27e93', '⛔ STOPPED'];
    g.fillStyle = strip;
    g.fillRect(0, 0, W, 78);
    g.fillStyle = '#0a0a0a';
    g.font = `700 34px ${SANS}`;
    g.fillText(label, pad, 53);
    if (!m) {
      let y = lines('🤝 Meeting room', `700 46px ${SANS}`, '#eeeeee', 160, 2, 58);
      lines('Press E at the table to call a meeting: a debate, lead & team, map-reduce, red / blue or a review panel.', `500 30px ${SANS}`, '#c9c9c9', y + 30, 8, 42);
      this.texture.needsUpdate = true;
      return;
    }
    const p = MEETING_PATTERNS[m.pattern];
    let y = lines(`${p.icon} ${p.label}`, `600 30px ${SANS}`, '#ee6018', 130, 1, 40);
    y = lines(m.title, `700 42px ${SANS}`, '#eeeeee', y + 16, 3, 50);
    y += 18;
    if (m.status === 'running') {
      y = lines(meetingStage(m), `500 30px ${SANS}`, '#c9c9c9', y, 3, 40);
      const who = speaking(m);
      if (who.length) lines(`💬 ${who.join(', ')}`, `500 28px ${SANS}`, '#8fc0ea', y + 8, 3, 38);
      // The budget, as a bar that fills up, and what's been spent.
      const f = Math.min(1, m.tokens / Math.max(1, m.budget));
      const barY = H - 118;
      g.fillStyle = 'rgba(255, 255, 255, .14)';
      g.fillRect(pad, barY, W - 2 * pad, 20);
      g.fillStyle = f > 0.9 ? '#ef4444' : f > 0.7 ? '#f2b84b' : '#3ccf91';
      g.fillRect(pad, barY, (W - 2 * pad) * f, 20);
      g.fillStyle = '#eeeeee';
      g.font = `500 28px ${SANS}`;
      g.fillText(`${fmtTokens(m.tokens)} of ${fmtTokens(m.budget)} tokens`, pad, H - 58);
      g.font = `500 26px ${SANS}`;
      g.fillStyle = '#c9c9c9';
      if (m.cost > 0) g.fillText(`${fmtCost(m.cost)}${m.costKnown ? '' : '+'} so far`, pad, H - 22);
    } else {
      // The summary line after the pattern, which is up top already.
      lines(meetingSummary(m).split(' · ').slice(1).join(' · '), `500 28px ${SANS}`, '#c9c9c9', y, Math.floor((H - y) / 38), 38);
    }
    this.texture.needsUpdate = true;
  }
}
