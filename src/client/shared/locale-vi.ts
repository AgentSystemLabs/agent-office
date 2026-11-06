import { vietnameseLabel } from './vi-labels';

// UI-only adapter: never translate terminal buffers, documents, code, chat or entered values.
const RAW = '.xterm,.term-host,pre,code,textarea,input,[contenteditable],script,style,[data-no-translate],.worker-name,.worker-task,.task-summary,.chat-log,.chat-text,.markdown,.doc-body';
const attrs = ['title', 'aria-label', 'placeholder', 'data-drop'];

function ignored(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return !!el?.closest(RAW);
}

function translateText(node: Node) {
  if (node.nodeType !== Node.TEXT_NODE || ignored(node) || !node.nodeValue?.trim()) return;
  const next = vietnameseLabel(node.nodeValue);
  if (next !== node.nodeValue) node.nodeValue = next;
}

function translateElement(el: Element) {
  // Input placeholders are UI; their current values and child text are not.
  if (el.closest('.xterm,.term-host,pre,code,textarea,[contenteditable],[data-no-translate]')) {
    if (!(el instanceof HTMLTextAreaElement)) return;
  }
  for (const attr of attrs) {
    const value = el.getAttribute(attr);
    if (value) {
      const next = vietnameseLabel(value);
      if (next !== value) el.setAttribute(attr, next);
    }
  }
}

function translateTree(node: Node) {
  if (node instanceof Element) translateElement(node);
  if (ignored(node)) return;
  if (node.nodeType === Node.TEXT_NODE) return translateText(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const child = walker.currentNode;
    if (child instanceof Element) translateElement(child);
    else translateText(child);
  }
}

function install() {
  if (new URLSearchParams(location.search).get('lang') === 'en') return;
  document.documentElement.lang = 'vi';
  translateTree(document.body);
  const pending = new Set<Node>();
  let scheduled = false;
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(node => pending.add(node));
      else pending.add(record.target);
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const node of pending) if (node.isConnected) translateTree(node);
      pending.clear();
      document.title = document.title.replace(/Agent Office/g, 'Văn phòng AI').replace('Sign in', 'Đăng nhập');
    });
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attrs });
  document.title = document.title.replace(/Agent Office/g, 'Văn phòng AI').replace('Sign in', 'Đăng nhập');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
