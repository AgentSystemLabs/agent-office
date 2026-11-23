// Translates the office's DOM in place. Most of the app builds its UI with `h()` and textContent, so
// catching nodes as they're added covers the 3D office, /lite, the sign-in pages and server toasts
// without threading a translator through every module. Text is remembered before it is translated so
// switching language puts the original words back and translates them again.

import { initLanguage, onLanguageChange } from './language';
import { t } from './t';

const ATTRS = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt'] as const;
// Options are translated too: static labels ("No floors yet", "Member", "Default") need it, and
// dynamic ones (project and model names) stay as they are because t() falls back to the source.
const SKIP = 'script,style,textarea,code,pre,.xterm,[data-i18n-skip],[contenteditable="true"]';

const texts = new Map<Text, string>();
const attrs = new Map<Element, Map<string, string>>();
let observer: MutationObserver | null = null;
let titleSource: string | null = null;
let installed = false;

function translated(source: string): string {
  return source ? t(source) : source;
}

function skip(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return !!el?.closest(SKIP);
}

// HTML like `<button>📌 Issues <span></span></button>` leaves a trailing space in the text node,
// while the catalogue keys are trimmed. Translate the words and keep the surrounding whitespace.
function renderText(source: string): string {
  const core = source.trim();
  return core ? source.replace(core, translated(core)) : source;
}

function handleText(node: Text) {
  if (skip(node)) return;
  let source = texts.get(node);
  if (source === undefined) {
    source = node.data;
    texts.set(node, source);
  }
  const out = renderText(source);
  if (node.data !== out) node.data = out;
}

function handleAttr(el: Element, name: string) {
  if (!(ATTRS as readonly string[]).includes(name) || skip(el)) return;
  const value = el.getAttribute(name);
  if (value === null) return;
  let saved = attrs.get(el);
  if (!saved) {
    saved = new Map();
    attrs.set(el, saved);
  }
  let source = saved.get(name);
  if (source === undefined) {
    source = value;
    saved.set(name, source);
  }
  const out = translated(source);
  if (value !== out) el.setAttribute(name, out);
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    handleText(root as Text);
    return;
  }
  // TreeWalker.nextNode() skips the root, so check the added element's own attributes first:
  // h('button', { 'aria-label': 'Menu' }) is appended with its labels already set.
  if (root instanceof Element) for (const name of ATTRS) if (root.hasAttribute(name)) handleAttr(root, name);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) handleText(node as Text);
    else for (const name of ATTRS) if ((node as Element).hasAttribute(name)) handleAttr(node as Element, name);
  }
}

function applyAll() {
  observer?.disconnect();
  walk(document.documentElement);
  for (const [node, source] of texts) if (node.isConnected) {
    const out = renderText(source);
    if (node.data !== out) node.data = out;
  }
  for (const [el, saved] of attrs) if (el.isConnected) for (const [name, source] of saved) {
    const out = translated(source);
    if (el.getAttribute(name) !== out) el.setAttribute(name, out);
  }
  if (titleSource !== null) document.title = translated(titleSource);
  observe();
}

function observe() {
  if (!observer) observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}

function onMutations(records: MutationRecord[]) {
  observer?.disconnect();
  for (const record of records) {
    if (record.type === 'childList') for (const node of record.addedNodes) walk(node);
    else if (record.type === 'characterData') handleText(record.target as Text);
    else if (record.type === 'attributes' && record.target instanceof Element) handleAttr(record.target, record.attributeName ?? '');
  }
  observe();
}

/** Starts translating the page. Safe to call from several entry points; only the first one installs. */
export function installI18n() {
  if (installed || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  installed = true;
  initLanguage();
  titleSource = document.title;
  applyAll();
  onLanguageChange(applyAll);
}
