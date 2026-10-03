import * as THREE from 'three';
import { inCheck, kingSquare, legalMoves, parseFen, squareName, type ChessState, type Color } from '../../../shared/chess';
import { chessSeatOf } from '../../../shared/chess-seats';
import type { ChessTable } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { $, h, toast } from '../../ui/dom';
import type { ChessTableView, Marks, Picked } from './board';
import { chessCorner } from './world';

// Playing chess at one of the roof's tables (see world.ts, and server/chess.ts for the game itself):
// sitting in a chair is taking that side, and while you do, looking at your own pieces lights them, a
// click on one picks it up (its legal squares glow), and a click on a glowing square moves it. The table's
// flag resigns (click it twice) and its coin sets the pieces up again. The server judges every move; the
// page only shows where one may go.

/** How the game stands, in a few words, for the hint and the line at the top of the screen. */
export function statusOf(t: ChessTable | undefined, side: Color | null): string {
  if (!t) return 'waiting for the game';
  const names = { w: t.w?.name ?? 'nobody', b: t.b?.name ?? 'nobody' };
  const mine = (c: Color) => (c === side ? 'you' : names[c]);
  if (t.end) {
    const e = t.end;
    if (e.kind === 'checkmate' || e.kind === 'resign') {
      const win = e.winner!;
      const how = e.kind === 'checkmate' ? 'Checkmate' : `${e.winner === 'w' ? 'Black' : 'White'} resigned`;
      return `${how} — ${win === side ? 'you win!' : `${mine(win)} wins`}`;
    }
    return e.kind === 'stalemate' ? 'Stalemate — a draw' : e.kind === 'insufficient' ? 'Draw — neither side can mate' : 'Draw — fifty moves without a capture or a pawn move';
  }
  if (!t.w || !t.b) return `${t.w ? 'White' : 'Black'} is waiting for an opponent`;
  const state = parseFen(t.fen);
  const turn = state?.turn ?? 'w';
  const check = state && inCheck(state) ? ' (check!)' : '';
  if (!t.moves && side === null) return `${names.w} (White) vs ${names.b} (Black) — White to move`;
  return turn === side ? `your move${check}` : `${turn === 'w' ? 'White' : 'Black'} (${names[turn]}) to move${check}`;
}

export class ChessController {
  /** Each table's game, as the server last said (by table number). */
  readonly tables = new Map<number, ChessTable>();
  /** The chair you're in, as the server knows it (what you last told it). */
  private joined: { table: number; side: Color } | null = null;
  private selected = -1;
  /** Which version of each table its board shows (see tick). */
  private shown = new Map<number, ChessTable>();
  private markKey = new Map<number, string>();
  private armedAt = 0;
  private ndc: THREE.Vector2 | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly lineEl = h('div.chess-line');
  private readonly tipEl = h('div.chess-tip');
  private readonly hud = h('div.chess-hud.panel.hidden', { id: 'chess', 'aria-label': 'Chess' }, this.lineEl, this.tipEl);
  private parsed = { fen: '', state: null as ChessState | null };

  constructor(private readonly ctx: Ctx) {
    $('hud').append(this.hud);
    ctx.canvas.addEventListener('pointermove', (e) => {
      const r = ctx.canvas.getBoundingClientRect();
      (this.ndc ??= new THREE.Vector2()).set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    ctx.canvas.addEventListener('pointerleave', () => (this.ndc = null));
  }

  /** Which side of which table you're sitting at, if you are. */
  get seat(): { table: number; side: Color } | null {
    return this.joined;
  }

  /** A table's game, from the server. */
  apply(t: ChessTable) {
    const before = this.tables.get(t.n);
    this.tables.set(t.n, t);
    if (this.joined?.table !== t.n) return;
    if (before && (before.moves !== t.moves || before.end !== t.end || !before.w !== !t.w || !before.b !== !t.b)) this.selected = -1;
    if (!before?.end && t.end) toast(`♟ ${statusOf(t, this.joined.side)}`);
    this.ctx.hint.invalidate();
  }

  private state(t: ChessTable): ChessState | null {
    if (this.parsed.fen !== t.fen) this.parsed = { fen: t.fen, state: parseFen(t.fen) };
    return this.parsed.state;
  }

  /** The ray through the crosshair (first person) or the mouse (third). */
  private aim(): THREE.Raycaster | null {
    const ndc = this.ctx.player.view === 'first' ? CENTER : this.ndc;
    if (!ndc) return null;
    this.ray.setFromCamera(ndc, this.ctx.camera);
    return this.ray;
  }

  /** E or a click at the table you're at: pick up a piece, put it down, resign, or set up again. */
  click() {
    const my = this.joined;
    const corner = chessCorner();
    const t = my && this.tables.get(my.table);
    const ray = this.aim();
    const view = my && corner?.tables[my.table - 1];
    if (!my || !t || !ray || !view) return;
    const hit = view.pick(ray);
    const net = this.ctx.net;
    if (hit?.act === 'new') {
      net.send({ t: 'chess.new', table: my.table });
      return;
    }
    if (hit?.act === 'resign') {
      // A flag that's easy to knock: it takes two clicks.
      const now = performance.now();
      if (now - this.armedAt < 3000) {
        this.armedAt = 0;
        net.send({ t: 'chess.resign', table: my.table });
      } else {
        this.armedAt = now;
        toast('Click the flag again to resign', 'warn');
      }
      return;
    }
    const state = this.state(t);
    if (hit?.sq === undefined || !state || t.end || !t.w || !t.b || state.turn !== my.side) return this.deselect();
    const sq = hit.sq;
    if (this.selected >= 0 && legalMoves(state, this.selected).some((m) => m.to === sq)) {
      net.send({ t: 'chess.move', table: my.table, from: this.selected, to: sq });
      this.deselect();
    } else if (state.board[sq] && (state.board[sq] === state.board[sq].toUpperCase()) === (my.side === 'w') && sq !== this.selected) {
      this.selected = sq;
    } else this.deselect();
  }

  private deselect() {
    this.selected = -1;
  }

  /** What the hint says at a table: who's playing and how it stands, and what to do about it. */
  describe(n: number): { status: string; playing: boolean } {
    const t = this.tables.get(n);
    const mine = this.joined?.table === n ? this.joined.side : null;
    return { status: t && (t.w || t.b) ? statusOf(t, mine) : 'nobody playing — sit in a chair to start', playing: mine !== null };
  }

  /** Every frame, up on the roof: the boards show what the server says, you sit and get up, and what's lit follows your aim. */
  tick(t: number, dt: number) {
    const { ctx } = this;
    const corner = chessCorner();
    if (!corner) return;
    corner.update(t, dt);
    for (const [n, table] of this.tables) {
      const view = corner.tables[n - 1];
      if (view && this.shown.get(n) !== table) {
        view.show(table);
        this.shown.set(n, table);
      }
    }
    // Sitting down at a chair is taking that side; getting up leaves it.
    const chair = chessSeatOf(ctx.player.seat?.seatId);
    if (chair?.table !== this.joined?.table || chair?.side !== this.joined?.side) {
      if (this.joined) ctx.net.send({ t: 'chess.leave' });
      this.joined = chair ?? null;
      this.selected = -1;
      if (chair) {
        ctx.net.send({ t: 'chess.join', table: chair.table, side: chair.side });
        // Look down at the board.
        if (ctx.player.view === 'first') ctx.player.lookPitch = -0.7;
      }
      ctx.hint.invalidate();
    }
    this.light(corner.tables);
    this.draw();
  }

  /** What's lit on each board: the last move and a king in check on all of them, and for yours, what you aim at and can do. */
  private light(views: readonly ChessTableView[]) {
    const my = this.joined;
    let aimed: Picked | null = null;
    if (my) {
      const ray = this.aim();
      aimed = ray ? (views[my.table - 1]?.pick(ray) ?? null) : null;
    }
    for (const view of views) {
      const t = this.tables.get(view.n);
      const state = t && this.state(t);
      if (!t || !state) continue;
      const mine = my?.table === view.n;
      const hover = mine ? aimed?.sq : undefined;
      const piece = hover !== undefined ? state.board[hover] : '';
      const live = mine && !t.end && !!t.w && !!t.b;
      const ownPiece = !!piece && (piece === piece.toUpperCase()) === (my?.side === 'w');
      const picked = live && this.selected >= 0 && state.turn === my.side;
      const dests = picked ? [...new Set(legalMoves(state, this.selected).map((m) => m.to))] : [];
      const pawn = picked && state.board[this.selected].toLowerCase() === 'p';
      const takes = (to: number) => !!state.board[to] || (pawn && to === state.ep);
      const marks: Marks = {
        last: t.last,
        check: inCheck(state) ? kingSquare(state, state.turn) : undefined,
        hover: live && hover !== undefined && (ownPiece || dests.includes(hover)) ? hover : undefined,
        selected: picked ? this.selected : undefined,
        moves: dests.filter((to) => !takes(to)),
        takes: dests.filter(takes),
      };
      const key = `${t.fen}|${t.moves}|${t.end?.kind}|${marks.hover}|${marks.selected}|${aimed?.act}`;
      if (this.markKey.get(view.n) !== key) {
        this.markKey.set(view.n, key);
        view.setMarks(marks);
      }
      view.lightToken(mine ? (aimed?.act ?? null) : null);
    }
  }

  /** Off the roof: nobody's at a table. */
  hide() {
    this.joined = null;
    this.selected = -1;
    this.hud.classList.add('hidden');
  }

  /** The line at the top of the screen while you're sitting at a table. */
  private draw() {
    const my = this.joined;
    this.hud.classList.toggle('hidden', !my);
    if (!my) return;
    const t = this.tables.get(my.table);
    const line = `♟ Table ${my.table} · you're ${my.side === 'w' ? 'White' : 'Black'} — ${statusOf(t, my.side)}`;
    const tip = t?.end ? 'Click the coin to play again' : this.selected >= 0 ? `${squareName(this.selected)} picked up — click a glowing square, or another piece` : 'Click a piece, then where it goes · W A S D gets you up';
    if (this.lineEl.textContent !== line) this.lineEl.textContent = line;
    if (this.tipEl.textContent !== tip) this.tipEl.textContent = tip;
  }
}

const CENTER = new THREE.Vector2(0, 0);
