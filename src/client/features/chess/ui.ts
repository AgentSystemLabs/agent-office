// The chess window: a board to play on, whose turn it is, what each side has taken, the moves so
// far, and new-game/resign buttons. Opened with E from a chess chair (see features/seating), played
// against an idle agent (ai.ts moves for them) or both sides yourself. An ordinary modal, so its ✕
// and Esc put you straight back into mouse-look (see input/focus.ts).

import { h, openModal, type Modal } from '../../ui/dom';
import { store } from '../../state';
import { ChessGame, file, rank, squareName, type Color, type Move, type PieceType } from './engine';
import { chooseMove, idleOpponents } from './ai';
import type { Ctx } from '../../core/context';
import './ui.css';

const GLYPH: Record<PieceType, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PROMO_CHOICE: Exclude<PieceType, 'p' | 'k'>[] = ['q', 'r', 'b', 'n'];

const sideName = (c: Color): string => (c === 'w' ? 'White' : 'Black');

/** A game of chess against an idle agent, from a chess chair. */
export class Chess {
  private modal: Modal | null = null;

  constructor(private readonly ctx: Ctx) {}

  /** Puts it away, if you're at it (the building changed maps under you). */
  stop() {
    this.modal?.close();
  }

  /** E on a chess chair, sitting down: play from that chair's side (chair 2 is Black). */
  play(seatId?: string) {
    if (this.modal) return;
    const ctx = this.ctx;
    const game = new ChessGame();
    const me: Color = seatId === 'chess-chair-2' ? 'b' : 'w';
    // No board of your own: White's pieces start at the bottom from chair 1.
    const flip = me === 'b';
    let selected = -1;
    let targets: Move[] = [];
    let over: string | null = null;
    let resigned: Color | null = null;
    let thinking = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let aiName: string | null = idleOpponents()[0]?.name ?? null;

    const title = h('h2', {}, '♟️ Chess');
    const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
    const opp = h('div.chess-opp', {});
    const status = h('div.chess-status', { role: 'status' }, '');
    const board = h('div.chess-board', { role: 'grid', 'aria-label': 'Chessboard' });
    const promoRow = h('div.chess-promo', {});
    const takenByMe = h('div.chess-taken', {});
    const takenByAi = h('div.chess-taken', {});
    const moves = h('ol.chess-moves', {});
    const newGame = h('button.btn', { type: 'button' }, '↺ New game');
    const resign = h('button.btn', { type: 'button' }, '🏳️ Resign');
    const el = h(
      'div.modal.chess-modal',
      { role: 'dialog', 'aria-label': 'Chess' },
      h('header', {}, title, close),
      h('div.chess-top', {}, opp, status),
      h('div.chess-main', {}, board, h('div.chess-side', {}, takenByMe, takenByAi, h('h3', {}, 'Moves'), moves, promoRow)),
      h('footer', {}, h('span.grow', {}, 'Click one of your pieces, then where it goes. Pawns choose what they become.'), newGame, resign),
    );

    /** What each side is called: you and the agent, or White and Black playing solo. */
    const nameOf = (c: Color): string => (aiName ? (c === me ? 'You' : aiName) : sideName(c));

    const say = (text: string) => {
      status.textContent = text;
    };

    /** The board's squares in display order: your side along the bottom. */
    const order = (): number[] => {
      const sqs: number[] = [];
      const ranks = flip ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
      const files = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      for (const r of ranks) for (const f of files) sqs.push(r * 8 + f);
      return sqs;
    };

    const cells = new Map<number, HTMLButtonElement>();
    for (const sq of order()) {
      const dark = (file(sq) + rank(sq)) % 2 === 0;
      const cell = h('button.chess-sq', {
        type: 'button',
        role: 'gridcell',
        'aria-label': squareName(sq),
        class: dark ? 'dark' : 'light',
      });
      cell.addEventListener('click', () => click(sq));
      board.append(cell);
      cells.set(sq, cell);
    }

    const refreshOpp = () => {
      opp.replaceChildren();
      const label = h('label', {}, 'Opponent: ');
      const select = h('select', { 'aria-label': 'Opponent' }) as HTMLSelectElement;
      const solo = document.createElement('option');
      solo.value = '';
      solo.textContent = 'Just me (both sides)';
      select.append(solo);
      for (const o of idleOpponents()) {
        const opt = document.createElement('option');
        opt.value = o.name;
        opt.textContent = `🤖 ${o.name}`;
        select.append(opt);
      }
      select.value = aiName ?? '';
      select.addEventListener('change', () => {
        aiName = select.value || null;
        start();
      });
      label.append(select);
      opp.append(label);
      if (!idleOpponents().length) opp.append(h('span.chess-hint', {}, 'No idle agents — hire one at an empty desk.'));
    };

    const refresh = () => {
      const last = game.lastMove();
      const st = game.status();
      for (const [sq, cell] of cells) {
        const p = game.pieces[sq];
        cell.textContent = '';
        if (p) {
          const s = h('span.chess-piece', { class: p.c === 'w' ? 'white' : 'black' }, GLYPH[p.t]);
          cell.append(s);
        }
        cell.classList.toggle('sel', sq === selected);
        cell.classList.toggle('tgt', targets.some((m) => m.to === sq));
        cell.classList.toggle('last', !!last && (last.from === sq || last.to === sq));
        cell.classList.toggle('check', !!p && p.t === 'k' && p.c === game.turn && st.check);
      }
      // What each side has taken, most valuable first, with who's ahead.
      const show = (el: HTMLElement, by: Color, label: string) => {
        const taken = [...game.capturedBy(by)].sort((a, b) => VALUES[b.t] - VALUES[a.t]);
        el.replaceChildren();
        el.append(h('span.chess-who', {}, label));
        for (const p of taken) el.append(h('span.chess-min', { class: p.c === 'w' ? 'white' : 'black' }, GLYPH[p.t]));
      };
      show(takenByMe, me, `${nameOf(me)} took: `);
      show(takenByAi, me === 'w' ? 'b' : 'w', `${nameOf(me === 'w' ? 'b' : 'w')} took: `);
      moves.replaceChildren();
      const sans = game.moves();
      for (let i = 0; i < sans.length; i += 2) {
        moves.append(h('li', {}, `${i / 2 + 1}. ${sans[i]}${sans[i + 1] ? ` ${sans[i + 1]}` : ''}`));
      }
      moves.scrollTop = moves.scrollHeight;
      resign.toggleAttribute('disabled', over !== null);
      if (over) say(over);
      else if (thinking) say(`${aiName} is thinking…`);
      else {
        const who = aiName ? (game.turn === me ? 'Your move' : `${aiName} to move`) : `${nameOf(game.turn)} to move`;
        say(st.check ? `${who} — check!` : who);
      }
    };

    const endSounds = () => {
      const st = game.status();
      if (!st.over) return;
      if (st.reason === 'checkmate') ctx.sound.chess(st.winner === me || !aiName ? 'win' : 'lose');
      else ctx.sound.chess('draw');
    };

    const finish = (text: string) => {
      over = text;
      selected = -1;
      targets = [];
      refresh();
    };

    const resultText = (): string | null => {
      if (resigned) {
        const winner = resigned === 'w' ? 'b' : 'w';
        const verb = aiName && resigned === me ? 'resign' : 'resigns';
        return `${nameOf(resigned)} ${verb} — ${nameOf(winner)} wins!`;
      }
      const st = game.status();
      if (!st.over) return null;
      if (st.reason === 'checkmate') return `Checkmate — ${nameOf(st.winner!)} wins!`;
      if (st.reason === 'stalemate') return 'Stalemate — draw.';
      if (st.reason === 'fifty') return 'Draw — fifty moves without a pawn move or capture.';
      if (st.reason === 'material') return 'Draw — neither side can mate.';
      return 'Draw — the same position three times.';
    };

    const move = (m: Move) => {
      const piece = game.pieces[m.from]!;
      const takes = !!game.pieces[m.to] || (piece.t === 'p' && m.to === game.ep && !game.pieces[m.to]);
      game.play(m);
      selected = -1;
      targets = [];
      promoRow.replaceChildren();
      const done = resultText();
      if (done) {
        finish(done);
        endSounds();
        return;
      }
      ctx.sound.chess(takes ? 'capture' : 'move');
      if (game.status().check) ctx.sound.chess('check');
      refresh();
      maybeAi();
    };

    const click = (sq: number) => {
      if (over || thinking) return;
      const p = game.pieces[sq];
      // One of yours (or either side, playing solo): show where it goes.
      if (p && p.c === game.turn && (!aiName || game.turn === me)) {
        const ms = game.movesFrom(sq);
        if (!ms.length) {
          ctx.sound.chess('select');
          return;
        }
        selected = sq;
        targets = ms;
        promoRow.replaceChildren();
        ctx.sound.chess('select');
        refresh();
        return;
      }
      // Somewhere it goes: pawns on the last rank choose what they become first.
      const to = targets.filter((m) => m.to === sq);
      if (selected >= 0 && to.length) {
        if (to.some((m) => m.promo)) {
          promoRow.replaceChildren();
          promoRow.append(h('span.chess-who', {}, 'Promote to: '));
          for (const kind of PROMO_CHOICE) {
            const b = h('button.btn.chess-promo-btn', { type: 'button', 'aria-label': `Promote to ${kind}` }, GLYPH[kind]);
            b.addEventListener('click', () => move({ from: selected, to: sq, promo: kind }));
            promoRow.append(b);
          }
          refresh();
          return;
        }
        move({ from: selected, to: sq });
      }
    };

    const maybeAi = () => {
      if (over || !aiName || game.turn === me) return;
      thinking = true;
      refresh();
      timer = setTimeout(() => {
        timer = null;
        if (!this.modal) return;
        const m = chooseMove(game);
        thinking = false;
        if (!m) {
          const done = resultText();
          if (done) finish(done);
          endSounds();
          return;
        }
        move(m);
      }, 450 + Math.random() * 500);
    };

    const start = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      game.reset();
      over = null;
      resigned = null;
      thinking = false;
      selected = -1;
      targets = [];
      promoRow.replaceChildren();
      refreshOpp();
      refresh();
      maybeAi();
    };

    newGame.addEventListener('click', start);
    resign.addEventListener('click', () => {
      if (over) return;
      resigned = aiName ? me : game.turn;
      ctx.sound.chess('lose');
      finish(resultText()!);
    });

    const offWorkers = store.on('workers', () => {
      if (this.modal) refreshOpp();
    });

    this.modal = openModal(el, {
      doing: '♟️ playing chess',
      onClose: () => {
        if (timer) clearTimeout(timer);
        offWorkers();
        this.modal = null;
      },
    });
    close.addEventListener('click', () => this.modal?.close());
    start();
  }
}
