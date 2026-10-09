import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import type { Plugin } from 'vite';

// Reuse the installed Chinese edition's reviewed UI literals, including canvas labels.
// Match template text rather than minified variable names; preserve current expressions.
const pairs = JSON.parse(readFileSync(new URL('./chinese-literals.json', import.meta.url), 'utf8')) as { before: string; after: string }[];
const expression = (text: string): any => (parse(`(${text})`, { ecmaVersion: 'latest' }) as any).body[0].expression;
const parts = (node: any) => node.quasis.map((quasi: any) => quasi.value.cooked);
const literals = new Map<string, string>();
const templates = new Map<string, { before: any; after: any; original: string; translated: string }>();
for (const pair of pairs) {
  const before = expression(pair.before), after = expression(pair.after);
  const string = (node: any) => node.type === 'Literal' ? node.value : node.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : undefined;
  // Bare lowercase words can also be CSS values, event names or protocol discriminators.
  // Leave those to the DOM overlay, where displayed text is separate from program values.
  if (typeof string(before) === 'string' && typeof string(after) === 'string' && !/^[a-z_.]+$/.test(string(before))) literals.set(string(before), string(after));
  else if (before.type === 'TemplateLiteral' && after.type === 'TemplateLiteral') {
    templates.set(JSON.stringify(parts(before)), { before, after, original: `(${pair.before})`, translated: `(${pair.after})` });
  }
}
const escaped = (text: string) => JSON.stringify(text).slice(1, -1).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

export function chineseEdition(): Plugin {
  return {
    name: 'chinese-edition', enforce: 'post',
    transformIndexHtml(html) {
      return { html: html.replace('<html lang="en">', '<html lang="zh-CN">'),
        tags: [{ tag: 'script', attrs: { src: '/assets/zh-cn.js', defer: true }, injectTo: 'head' }] };
    },
    renderChunk(code, chunk) {
      if (!Object.keys(chunk.modules).some(id => id.replaceAll('\\', '/').includes('/src/client/'))) return null;
      const source = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
      const edits: { start: number; end: number; text: string }[] = [];
      function visit(node: any) {
        if (!node || typeof node !== 'object') return;
        let text: string | undefined;
        const value = node.type === 'Literal' ? node.value : node.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : undefined;
        if (typeof value === 'string' && literals.has(value)) text = JSON.stringify(literals.get(value));
        else if (node.type === 'TemplateLiteral' && node.expressions.length) {
          const rule = templates.get(JSON.stringify(parts(node)));
          if (rule) {
            const bindings = rule.before.expressions.map((expr: any) => rule.original.slice(expr.start, expr.end));
            const values = rule.after.expressions.map((expr: any) => bindings.indexOf(rule.translated.slice(expr.start, expr.end)));
            if (values.every((index: number) => index >= 0)) {
              text = '`' + escaped(rule.after.quasis[0].value.cooked) + rule.after.expressions.map((_: any, i: number) =>
                '${' + code.slice(node.expressions[values[i]].start, node.expressions[values[i]].end) + '}' + escaped(rule.after.quasis[i + 1].value.cooked)).join('') + '`';
            }
          }
        }
        if (text !== undefined) edits.push({ start: node.start, end: node.end, text });
        else for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === 'object') visit(value);
        }
      }
      visit(source);
      for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
      return edits.length ? { code, map: null } : null;
    },
  };
}
