import { h, openModal, toast } from './dom';

/**
 * Pairing a VR headset from the laptop: a QR code encoding the LAN ws(s) URL plus a short pairing
 * code, the code to type instead, and an expiry countdown. The QR encoder is vendored (~200 lines,
 * byte mode, EC level L, versions 1–10) rather than the `qrcode` package (~30 dependencies):
 * smaller, and validated module-by-module against that package plus a jsQR round-trip sweep.
 */

/** Byte mode, error correction L, versions 1–10: the pairing payload always fits. */
const ECC_CODEWORDS_PER_BLOCK = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const ECC_BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
/** Version information strings for versions 7–10 (18 bits each, BCH already applied). */
const VERSION_BITS: Record<number, number> = {
  7: 0b000111110010010100,
  8: 0b001000010110111100,
  9: 0b001001101010011001,
  10: 0b001010010011010011,
};

/** GF(256) with x⁸ + x⁴ + x³ + x² + 1. */
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree: number): number[] {
  // ∏(x + αⁱ), highest degree first.
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const out = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = out[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) out[i + j] ^= gfMul(gen[j], coef);
  }
  return out.slice(data.length);
}

/** Format info bits for EC level L and a mask (0–7), with BCH + mask already applied. */
function formatBits(mask: number): number {
  let data = (0b01 << 3) | mask; // L = 01
  let rem = data << 10;
  const g = 0b10100110111;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= g << (i - 10);
  return ((data << 10) | (rem & 0x3ff)) ^ 0b101010000010010;
}

const MASKS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function finder(matrix: (boolean | null)[][], r: number, c: number) {
  for (let dr = -1; dr <= 7; dr++)
    for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= matrix.length || cc >= matrix.length) continue;
      const edge = dr === -1 || dr === 7 || dc === -1 || dc === 7;
      matrix[rr][cc] = edge ? false : dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
    }
}

/** Draws `text` as a QR code into `canvas` (byte mode, EC level L). Returns false when it doesn't fit. */
export function drawQr(canvas: HTMLCanvasElement, text: string): boolean {
  const bytes = new TextEncoder().encode(text);
  // Smallest version whose data capacity (bytes) holds the payload.
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const total = TOTAL_CODEWORDS[v - 1];
    const eccTotal = ECC_CODEWORDS_PER_BLOCK[v - 1] * ECC_BLOCKS[v - 1];
    const capacity = total - eccTotal - (v >= 10 ? 2 : 1) - 1;
    if (capacity >= bytes.length) {
      version = v;
      break;
    }
  }
  if (!version) return false;
  const size = version * 4 + 17;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));

  finder(matrix, 0, 0);
  finder(matrix, 0, size - 7);
  finder(matrix, size - 7, 0);
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }
  if (version >= 2) {
    // Alignment pattern centers per version (skipped where they would overlap the finders).
    const centers = [
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
    ][version - 2];
    for (const r of centers)
      for (const c of centers) {
        // The three corners are finders, not alignment patterns; everywhere else the pattern goes
        // down whole, over the timing row/column too.
        if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) continue;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) matrix[r + dr][c + dc] = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
      }
  }
  matrix[size - 8][8] = true; // dark module
  // Reserve the format info areas (filled in after masking), so no data lands on them.
  const reserve = (r: number, c: number) => {
    if (matrix[r][c] === null) matrix[r][c] = false;
  };
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      reserve(i, 8);
      reserve(8, i);
    }
    if (i < 7) reserve(size - 1 - i, 8);
    if (i !== 8) reserve(8, size - 1 - i);
  }
  // Versions 7+: two 3×6 version info blocks (written after masking, like format info).
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      reserve(size - 11 + (i % 3), Math.floor(i / 3));
      reserve(Math.floor(i / 3), size - 11 + (i % 3));
    }
  }

  // Bit stream: byte mode indicator, length, data, terminator, pad to bytes, pad codewords.
  const bits: number[] = [];
  const push = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  const eccTotal = ECC_CODEWORDS_PER_BLOCK[version - 1] * ECC_BLOCKS[version - 1];
  const dataCapacity = TOTAL_CODEWORDS[version - 1] - eccTotal;
  const blocks = ECC_BLOCKS[version - 1];
  // Interleaving across blocks only matters for multi-block versions; keep short blocks first.
  const dataWords: number[] = [];
  while (bits.length % 8 !== 0) bits.push(0);
  for (let i = 0; i < bits.length; i += 8) dataWords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // Pad codewords alternate 0xEC, 0x11 from the first pad byte, however many data bytes came before.
  for (let p = 0; dataWords.length < dataCapacity; p++) dataWords.push(p % 2 === 0 ? 0xec : 0x11);
  const shortLen = Math.floor(dataCapacity / blocks);
  const longCount = dataCapacity % blocks;
  const eccLen = ECC_CODEWORDS_PER_BLOCK[version - 1];
  const dataBlocks: number[][] = [];
  let at = 0;
  for (let b = 0; b < blocks; b++) {
    const len = shortLen + (b >= blocks - longCount ? 1 : 0);
    dataBlocks.push(dataWords.slice(at, at + len));
    at += len;
  }
  const eccBlocks = dataBlocks.map((d) => rsRemainder(d, eccLen));
  const codewords: number[] = [];
  for (let i = 0; i < shortLen + 1; i++) for (const d of dataBlocks) if (i < d.length) codewords.push(d[i]);
  for (let i = 0; i < eccLen; i++) for (const e of eccBlocks) codewords.push(e[i]);
  const allBits: number[] = [];
  for (const w of codewords) for (let i = 7; i >= 0; i--) allBits.push((w >> i) & 1);
  // Remainder bits for versions 1–10.
  const remainder = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0][version - 1];
  for (let i = 0; i < remainder; i++) allBits.push(0);

  // Zig-zag placement up the column pairs, skipping column 6 (timing).
  const cells: [number, number][] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [right, right - 1]) if (matrix[row][c] === null) cells.push([row, c]);
    }
    upward = !upward;
  }
  // Try every mask; keep the one with the lowest penalty.
  let best: boolean[][] = [];
  let bestMask = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const mask = MASKS[m];
    const grid = matrix.map((row) => row.map((v) => v === true));
    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i];
      grid[r][c] = Boolean((allBits[i] ?? 0) ^ (mask(r, c) ? 1 : 0));
    }
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
      best = grid;
    }
  }
  const grid = best;
  // Format info, both copies.
  const fmt = formatBits(bestMask);
  for (let i = 0; i < 15; i++) {
    const b = ((fmt >> i) & 1) === 1;
    if (i < 6) grid[i][8] = b;
    else if (i === 6) grid[7][8] = b;
    else if (i === 7) grid[8][8] = b;
    else if (i === 8) grid[8][7] = b;
    else grid[8][14 - i] = b;
    if (i < 8) grid[8][size - 1 - i] = b;
    else grid[size - 15 + i][8] = b;
  }
  if (version >= 7) {
    const vb = VERSION_BITS[version];
    for (let i = 0; i < 18; i++) {
      const b = ((vb >> i) & 1) === 1;
      grid[size - 11 + (i % 3)][Math.floor(i / 3)] = b;
      grid[Math.floor(i / 3)][size - 11 + (i % 3)] = b;
    }
  }
  // A white quiet zone of 4 modules all round, scaled up crisply.
  const scale = Math.max(4, Math.floor(240 / (size + 8)));
  canvas.width = canvas.height = (size + 8) * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) ctx.fillRect((c + 4) * scale, (r + 4) * scale, scale, scale);
  return true;
}

/** QR penalty rules 1–4 (runs, 2×2 blocks, finder-like patterns, dark balance). */
function penalty(grid: boolean[][]): number {
  const n = grid.length;
  let score = 0;
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c <= n; c++) {
      if (c < n && grid[r][c] === grid[r][c - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r <= n; r++) {
      if (r < n && grid[r][c] === grid[r - 1][c]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
  }
  for (let r = 0; r + 1 < n; r++) for (let c = 0; c + 1 < n; c++) if (grid[r][c] === grid[r][c + 1] && grid[r][c] === grid[r + 1][c] && grid[r][c] === grid[r + 1][c + 1]) score += 3;
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  const match = (a: boolean[]) => a.length === 11 && (a.every((v, i) => v === pat1[i]) || a.every((v, i) => v === pat2[i]));
  for (let r = 0; r < n; r++) for (let c = 0; c + 11 <= n; c++) if (match(grid[r].slice(c, c + 11))) score += 40;
  for (let c = 0; c < n; c++) for (let r = 0; r + 11 <= n; r++) if (match(grid.slice(r, r + 11).map((row) => row[c]))) score += 40;
  let dark = 0;
  for (const row of grid) for (const v of row) if (v) dark++;
  score += Math.abs(Math.round((dark / (n * n)) * 100) - 50) * 2;
  return score;
}

export interface QrPayload {
  /** The office's ws(s) URL as the headset reaches it, e.g. wss://192.168.1.5:4600 or the --public-url. */
  url: string;
  /** The pairing code from /api/pair/start, for POST /api/pair/claim. */
  code: string;
  /** `sha256/…` pin for the office's TLS cert, when the office serves TLS itself (see /api/server-url). */
  pin?: string;
}

/** GET /api/server-url (session auth): the ws(s) URL a headset on the LAN uses for this office, plus the TLS pin when the office serves TLS itself (so a self-signed office verifies on the headset instead of failing against the system trust store). */
export async function fetchServerUrl(): Promise<{ url: string; pin?: string }> {
  const res = await fetch('/api/server-url');
  if (!res.ok) throw new Error('Could not reach the office');
  const body = (await res.json()) as { url?: unknown; fingerprint?: unknown };
  if (typeof body.url !== 'string' || !body.url) throw new Error('The office gave no URL');
  const pin = typeof body.fingerprint === 'string' && body.fingerprint ? body.fingerprint : undefined;
  return { url: body.url.replace(/^http/, 'ws'), ...(pin ? { pin } : {}) };
}

/** POST /api/pair/start (session auth): a short code for the headset to claim. */
export async function fetchPairCode(): Promise<{ code: string; expiresAt: number }> {
  const res = await fetch('/api/pair/start', { method: 'POST' });
  if (res.status === 429) throw new Error('Too many codes — wait a few minutes');
  if (!res.ok) throw new Error('Could not reach the office');
  const body = (await res.json()) as { code?: unknown; expiresAt?: unknown };
  if (typeof body.code !== 'string' || typeof body.expiresAt !== 'number') throw new Error('The office gave no code');
  return { code: body.code, expiresAt: body.expiresAt };
}

/** The 🥽 VR panel: a QR for the headset to scan, the code to type, and how long both last. */
export function openVrPair() {
  const canvas = h('canvas.vr-qr', { width: 240, height: 240, role: 'img', 'aria-label': 'Pairing QR code' }) as HTMLCanvasElement;
  const codeEl = h('div.vr-code', {}, '····');
  const countdown = h('p.vr-countdown', {}, '');
  const status = h('p.vr-status', {}, 'Making a code…');
  const refresh = h('button.btn', { type: 'button' }, 'Refresh');
  const done = h('button.btn.primary', { type: 'button' }, 'Done');
  const body = h('div.body.vr', {}, canvas, codeEl, countdown, status);
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Pair a VR headset', style: 'width:min(380px,100%)' },
    h('header', {}, h('h2', {}, '🥽 Pair a VR headset'), h('button.btn.close', { 'aria-label': 'Close' }, '✕')),
    body,
    h('footer', {}, h('span.grow', {}, 'One code at a time: a new one voids the old.'), refresh, done),
  );
  const modal = openModal(el);
  el.querySelector('.close')!.addEventListener('click', () => modal.close());
  done.addEventListener('click', () => modal.close());

  let expiresAt = 0;
  const tick = () => {
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    countdown.textContent = expiresAt ? (left > 0 ? `Code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Code expired — Refresh for a new one') : '';
  };
  const load = async () => {
    refresh.disabled = true;
    status.textContent = 'Making a code…';
    status.className = 'vr-status';
    codeEl.textContent = '····';
    try {
      const [info, pair] = await Promise.all([fetchServerUrl(), fetchPairCode()]);
      const payload: QrPayload = { url: info.url, code: pair.code, ...(info.pin ? { pin: info.pin } : {}) };
      if (!drawQr(canvas, JSON.stringify(payload))) throw new Error('The code did not fit in a QR');
      expiresAt = pair.expiresAt;
      codeEl.textContent = pair.code;
      status.textContent = 'Scan with the headset app, or type the code.';
      tick();
    } catch (err) {
      expiresAt = 0;
      tick();
      status.textContent = (err as Error).message || 'Something went wrong';
      status.className = 'vr-status error';
      toast('VR pairing failed: ' + status.textContent, 'warn');
    } finally {
      refresh.disabled = false;
    }
  };
  refresh.addEventListener('click', () => void load());
  const timer = setInterval(() => {
    if (!canvas.isConnected) return clearInterval(timer); // the panel closed
    tick();
  }, 1000);
  void load();
}
