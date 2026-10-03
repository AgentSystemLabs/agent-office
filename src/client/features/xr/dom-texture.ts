/**
 * Rasterizes an HTML window onto a canvas texture for VR, and forwards controller clicks as pointer
 * / mouse events at the matching client coordinates. Forked from three's HTMLMesh ideas: walk the
 * DOM, draw text and boxes, honor scroll offsets, and refresh on mutations.
 */
import * as THREE from 'three';

const SCALE = 2;
/** Don't repaint more often than this while the DOM is thrashing. */
const MIN_MS = 50;

export class DomTexture {
  readonly texture: THREE.CanvasTexture;
  readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private root: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private dirty = true;
  private lastPaint = 0;
  private readonly onDirty = () => {
    this.dirty = true;
  };
  /** Css pixel size of the root last painted. */
  width = 1;
  height = 1;

  constructor() {
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
  }

  /** Watch `el` and paint it. Pass null to stop. */
  attach(el: HTMLElement | null) {
    this.detach();
    this.root = el;
    if (!el) return;
    this.observer = new MutationObserver(this.onDirty);
    this.observer.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    el.addEventListener('input', this.onDirty, true);
    el.addEventListener('scroll', this.onDirty, true);
    el.addEventListener('focusin', this.onDirty, true);
    el.addEventListener('focusout', this.onDirty, true);
    this.dirty = true;
  }

  detach() {
    if (this.root) {
      this.root.removeEventListener('input', this.onDirty, true);
      this.root.removeEventListener('scroll', this.onDirty, true);
      this.root.removeEventListener('focusin', this.onDirty, true);
      this.root.removeEventListener('focusout', this.onDirty, true);
    }
    this.observer?.disconnect();
    this.observer = null;
    this.root = null;
  }

  /** Paint if dirty (throttled). Returns true when the texture changed. */
  paint(now = performance.now()): boolean {
    if (!this.root || !this.dirty || now - this.lastPaint < MIN_MS) return false;
    this.dirty = false;
    this.lastPaint = now;
    const rect = this.root.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    const cw = this.width * SCALE;
    const ch = this.height * SCALE;
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const g = this.g;
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    g.clearRect(0, 0, this.width, this.height);
    g.fillStyle = getComputedStyle(this.root).backgroundColor || '#1b1d2b';
    g.fillRect(0, 0, this.width, this.height);
    drawNode(g, this.root, rect.left, rect.top);
    this.texture.needsUpdate = true;
    return true;
  }

  /**
   * Dispatch a click (or move) at UV 0..1 over the root. Coordinates are mapped through the root's
   * bounding rect so nested scrollable panels land on the right element.
   */
  dispatch(u: number, v: number, type: 'click' | 'pointermove' | 'scroll', dy = 0) {
    const root = this.root;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const clientX = rect.left + u * rect.width;
    const clientY = rect.top + v * rect.height;
    const el = elementAt(root, clientX, clientY) ?? root;
    if (type === 'scroll') {
      const scrollable = scrollParent(el, root);
      if (scrollable) scrollable.scrollTop += dy * 40;
      this.dirty = true;
      return;
    }
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'click' ? 1 : 0,
    };
    if (type === 'pointermove') {
      el.dispatchEvent(new PointerEvent('pointermove', init));
      el.dispatchEvent(new MouseEvent('mousemove', init));
      return;
    }
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
    if (el instanceof HTMLElement && (el.tabIndex >= 0 || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable)) {
      el.focus();
    }
    this.dirty = true;
  }
}

function elementAt(root: HTMLElement, x: number, y: number): Element | null {
  const stack: Element[] = [root];
  let best: Element | null = null;
  while (stack.length) {
    const el = stack.pop()!;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    best = el;
    for (let i = 0; i < el.children.length; i++) stack.push(el.children[i]!);
  }
  return best;
}

function scrollParent(el: Element, root: HTMLElement): HTMLElement | null {
  for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue;
    const s = getComputedStyle(n);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflow === 'auto' || s.overflow === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return root.scrollHeight > root.clientHeight ? root : null;
}

function drawNode(g: CanvasRenderingContext2D, node: Node, originX: number, originY: number) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (!text.trim()) return;
    const parent = node.parentElement;
    if (!parent) return;
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || style.display === 'none') return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    g.fillStyle = style.color;
    g.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    g.textBaseline = 'top';
    for (const r of rects) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      g.fillText(text.trim(), r.left - originX, r.top - originY);
    }
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const style = getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
  const rect = node.getBoundingClientRect();
  const x = rect.left - originX;
  const y = rect.top - originY;
  const w = rect.width;
  const h = rect.height;
  if (w < 0.5 || h < 0.5) return;

  const bg = style.backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    const radius = parseFloat(style.borderRadius) || 0;
    g.fillStyle = bg;
    if (radius > 0) {
      g.beginPath();
      g.roundRect(x, y, w, h, Math.min(radius, w / 2, h / 2));
      g.fill();
    } else g.fillRect(x, y, w, h);
  }
  const bw = parseFloat(style.borderTopWidth) || 0;
  if (bw > 0 && style.borderTopStyle !== 'none') {
    g.strokeStyle = style.borderTopColor;
    g.lineWidth = bw;
    g.strokeRect(x + bw / 2, y + bw / 2, w - bw, h - bw);
  }

  if (node instanceof HTMLImageElement && node.naturalWidth) {
    try {
      g.drawImage(node, x, y, w, h);
    } catch {
      // tainted
    }
  } else if (node instanceof HTMLCanvasElement && node.width && node.height) {
    try {
      g.drawImage(node, x, y, w, h);
    } catch {
      // tainted
    }
  } else if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    const pad = parseFloat(style.paddingLeft) || 8;
    const value = node instanceof HTMLInputElement && node.type === 'password' ? '•'.repeat(node.value.length) : node.value;
    g.fillStyle = style.color;
    g.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    g.textBaseline = 'middle';
    const clipY = node instanceof HTMLTextAreaElement ? y + (parseFloat(style.paddingTop) || 8) : y + h / 2;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    if (node instanceof HTMLTextAreaElement) {
      g.textBaseline = 'top';
      const lines = value.split('\n');
      const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
      lines.forEach((line, i) => g.fillText(line, x + pad, clipY + i * lh));
    } else {
      g.fillText(value || node.placeholder || '', x + pad, clipY);
    }
    if (document.activeElement === node) {
      g.fillStyle = style.color;
      const caret = node.selectionStart ?? value.length;
      const before = value.slice(0, caret).split('\n').pop() ?? '';
      const cx = x + pad + g.measureText(before).width;
      g.fillRect(cx, node instanceof HTMLTextAreaElement ? clipY : y + 6, 2, parseFloat(style.fontSize) || 14);
    }
    g.restore();
  } else if (node instanceof HTMLSelectElement) {
    g.fillStyle = style.color;
    g.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    g.textBaseline = 'middle';
    g.fillText(node.options[node.selectedIndex]?.text ?? '', x + 8, y + h / 2);
  }

  const clip = style.overflow === 'auto' || style.overflow === 'hidden' || style.overflow === 'scroll' || style.overflowX === 'auto' || style.overflowY === 'auto';
  if (clip) {
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
  }
  for (let i = 0; i < node.childNodes.length; i++) drawNode(g, node.childNodes[i]!, originX, originY);
  if (clip) g.restore();
}
