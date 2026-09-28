import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Docs, docTitle } from '../src/server/docs.js';
import { isDocPath, resolveDocLink } from '../src/shared/docs.js';

/** A folder with some Markdown in it, and whatever `git` makes of it. */
function fixture(t: { after(fn: () => void): void }, git: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'proj');
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  put('README.md', '# Agent Office\n\nHello.\n');
  put('docs/setup.markdown', '---\ntitle: "Getting set up"\n---\n\n# Not this one\n');
  put('docs/API.MD', 'Some intro\n\nThe API\n=======\n');
  put('src/index.ts', 'export {};\n');
  put('node_modules/dep/README.md', '# a dependency\n');
  put('.agent-office/meetings/notes.md', '# office notes\n');
  put('ignored/secret.md', '# ignored\n');
  put('pic.png', 'not really a png');
  writeFileSync(path.join(root, 'outside.md'), '# outside\n');
  if (git) {
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    put('.gitignore', 'node_modules\nignored\n.agent-office/\n');
    g('add', 'README.md', 'docs', 'src', '.gitignore');
    g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    // New and not ignored: still the project's.
    put('NOTES.md', 'no heading here\n');
  }
  return { root, dir, docs: new Docs(dir) };
}

test('the shelf is every Markdown file git counts as the project, with its title', async (t) => {
  const { docs } = fixture(t, true);
  const { files, more } = await docs.list();
  assert.equal(more, false);
  assert.deepEqual(
    files.map((f) => [f.path, f.title]),
    [
      ['docs/API.MD', 'The API'],
      ['docs/setup.markdown', 'Getting set up'],
      ['NOTES.md', undefined],
      ['README.md', 'Agent Office'],
    ],
  );
  assert.ok(files.every((f) => f.size > 0 && f.mtime > 0));
});

test('without git, the shelf walks the folder, skipping hidden and dependency folders', async (t) => {
  const { docs } = fixture(t, false);
  const { files } = await docs.list();
  assert.deepEqual(files.map((f) => f.path).sort(), ['docs/API.MD', 'docs/setup.markdown', 'ignored/secret.md', 'README.md'].sort());
});

test('only Markdown inside the project can be read, not through .. or a link out of it', async (t) => {
  const { root, dir, docs } = fixture(t, true);
  const ok = await docs.read('docs/setup.markdown');
  assert.ok('text' in ok && ok.text.includes('Getting set up'));
  for (const bad of ['src/index.ts', '../outside.md', path.join(root, 'outside.md'), 'missing.md', 'docs']) {
    const r = await docs.read(bad);
    assert.ok('error' in r, bad);
  }
  symlinkSync(root, path.join(dir, 'up'), 'junction');
  const r = await docs.read('up/outside.md');
  assert.ok('error' in r && r.status === 404);
  // Pictures the docs show: only pictures, only from the project.
  const pic = await docs.picture('pic.png');
  assert.ok('body' in pic && pic.type === 'image/png');
  assert.ok('error' in (await docs.picture('README.md')));
  assert.ok('error' in (await docs.picture('up/outside.md')));
});

test('a doc is titled by its front matter, else its first heading, whatever the style', () => {
  assert.equal(docTitle('# Hello *world*\n'), 'Hello world');
  assert.equal(docTitle('<p align="center"><img src="x.png"></p>\n<h1 align="center">Office</h1>\n'), 'Office');
  assert.equal(docTitle('```\n# not a heading\n```\n## Real one ##\n'), 'Real one');
  assert.equal(docTitle('Setext\n---\n'), 'Setext');
  assert.equal(docTitle('- a list item\n---\n'), undefined);
  assert.equal(docTitle('## [Linked](http://x) `code`\n'), 'Linked code');
  assert.equal(docTitle('just words\n'), undefined);
});

test('links in a doc resolve to paths in the project, and nowhere else', () => {
  assert.deepEqual(resolveDocLink('docs/a.md', '../README.md#setup'), { path: 'README.md', hash: 'setup' });
  assert.deepEqual(resolveDocLink('docs/a.md', './b.md'), { path: 'docs/b.md', hash: '' });
  assert.deepEqual(resolveDocLink('docs/a.md', '#usage'), { path: 'docs/a.md', hash: 'usage' });
  assert.deepEqual(resolveDocLink('docs/a.md', '/src/x%20y.ts?plain=1'), { path: 'src/x y.ts', hash: '' });
  for (const href of ['https://example.com/a.md', '//cdn/x.png', 'mailto:a@b.c', '../../etc/passwd', '..', '%E0%A4%A']) assert.equal(resolveDocLink('docs/a.md', href), undefined, href);
  assert.ok(isDocPath('a/b.MD') && isDocPath('x.markdown'));
  assert.ok(!isDocPath('a.mdx') && !isDocPath('../a.md') && !isDocPath('a/./b.md') && !isDocPath('md'));
});
