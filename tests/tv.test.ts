import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TV_OFF, checkTvUrl, classify, embedUrl, positionAt, startSeconds, tvTitle, youtubeId } from '../src/shared/tv.js';
import { Tv } from '../src/server/tv.js';

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('a link for the TV has to be a web link, and never a page of the office itself', () => {
  assert.deepEqual(checkTvUrl(' https://example.com/clips/talk.mp4 '), { url: 'https://example.com/clips/talk.mp4' });
  for (const bad of ['', 'example.com/clips/talk.mp4', 'ftp://example.com/a.mp4', 'javascript:alert(1)', 'x'.repeat(2049), 42, null]) {
    assert.ok('error' in checkTvUrl(bad), String(bad).slice(0, 24));
  }
  // Framed in its own origin, the page in the TV could reach out and touch the page it's hanging on.
  assert.ok('error' in checkTvUrl('http://office.test/', 'http://office.test'));
  assert.deepEqual(checkTvUrl('http://office.test/', 'http://somewhere.else'), { url: 'http://office.test/' });
});

test('how a link plays is worked out from where it comes from', () => {
  assert.equal(classify(YT), 'youtube');
  assert.equal(classify('https://youtu.be/dQw4w9WgXcQ?t=30'), 'youtube');
  assert.equal(classify('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'youtube');
  assert.equal(classify('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.equal(classify('https://example.com/movie.mp4'), 'media');
  assert.equal(classify('https://example.com/movie.mp4?token=1'), 'media');
  assert.equal(classify('https://example.com/live/playlist.m3u8'), 'media');
  assert.equal(classify('https://example.com/movie.webm#t=30'), 'media');
  assert.equal(classify('https://vimeo.com/76979871'), 'embed');
  assert.equal(classify('https://example.com/watch?v=dQw4w9WgXcQ'), 'embed');
  assert.equal(classify('not a link'), 'embed');
});

test('a YouTube link gives up its video id whatever shape it comes in', () => {
  assert.equal(youtubeId(YT), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=30'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/shorts/abc123'), 'abc123');
  assert.equal(youtubeId('https://www.youtube.com/live/abc123'), 'abc123');
  assert.equal(youtubeId('https://www.youtube.com/embed/abc123'), 'abc123');
  assert.equal(youtubeId('https://www.youtube.com/v/abc123'), 'abc123');
  assert.equal(youtubeId('https://www.youtube.com/playlist?list=PL1'), undefined);
  assert.equal(youtubeId('not a link'), undefined);
});

test('a link’s own timestamp is where everybody starts, in seconds', () => {
  assert.equal(startSeconds(`${YT}&t=1h2m3s`), 3723);
  assert.equal(startSeconds(`${YT}&t=90`), 90);
  assert.equal(startSeconds('https://www.youtube.com/watch?v=x&start=125'), 125);
  assert.equal(startSeconds('https://www.youtube.com/watch?v=x&time_continue=45'), 45);
  assert.equal(startSeconds('https://example.com/?start=02:03'), 123);
  assert.equal(startSeconds(YT), 0);
  assert.equal(startSeconds('https://example.com/movie.mp4'), 0);
  assert.equal(startSeconds('not a link'), 0);
});

test('what each kind of link is loaded as', () => {
  const stamped = `${YT}&t=90`;
  assert.equal(embedUrl(stamped, startSeconds(stamped)), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1&start=90');
  assert.equal(embedUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1');
  assert.match(embedUrl('https://www.youtube.com/playlist?list=PL1'), /^https:\/\/www\.youtube-nocookie\.com\/playlist\?/);
  assert.equal(embedUrl('https://vimeo.com/76979871', 12), 'https://player.vimeo.com/video/76979871?autoplay=1#t=12s');
  assert.equal(embedUrl('https://example.com/movie.mp4', 12), 'https://example.com/movie.mp4');
  assert.equal(embedUrl('https://example.com/movie.mp4', 0), 'https://example.com/movie.mp4');
});

test('where the TV is ticks on while it plays, and stands still when it doesn’t', () => {
  const going = { playing: true, position: 12, at: 1_000 };
  assert.equal(positionAt(going, 1_000), 12);
  assert.equal(positionAt(going, 4_500), 15.5);
  assert.equal(positionAt({ ...going, playing: false }, 4_500), 12);
  assert.equal(positionAt({ ...going, position: 0, at: 1_000 }, 500), 0, 'a clock behind where it started is still the start');
  assert.deepEqual(TV_OFF, { on: false, playing: false, position: 0, at: 0 });
});

test('what the TV is showing, in a line for the hint bar and the toasts', () => {
  assert.equal(tvTitle(YT), 'YouTube');
  assert.equal(tvTitle('https://www.youtube.com/shorts/abc123'), 'YouTube');
  assert.equal(tvTitle('https://youtu.be/dQw4w9WgXcQ'), 'YouTube');
  assert.equal(tvTitle('https://vimeo.com/76979871'), 'Vimeo');
  assert.equal(tvTitle('https://example.com/clips/talk.mp4'), 'example.com · talk.mp4');
  assert.equal(tvTitle('https://example.com/'), 'example.com');
  assert.equal(tvTitle(undefined), 'A video');
});

/** A TV with its state in a folder of its own, as one floor's checkout has. */
function tvFor(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-tv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, tv: new Tv(dir) };
}

test('the TV’s four moves carry a link from one to the next', (t) => {
  const { tv } = tvFor(t);
  // Nothing to play, and nothing that isn't a link to play.
  assert.ok('error' in tv.play({}, 'Ada'));
  assert.ok('error' in tv.play({ url: 'javascript:alert(1)' }, 'Ada'));
  assert.equal(tv.state().on, false);

  // A link with a timestamp of its own starts there, for everyone.
  assert.deepEqual(tv.play({ url: `${YT}&t=90` }, 'Ada'), { changed: true });
  let s = tv.state();
  assert.equal(s.on && s.playing, true);
  assert.equal(s.position, 90);
  assert.equal(s.by, 'Ada');

  // Paused where it had got to; pausing again is nothing to say.
  assert.equal(tv.pause(undefined, 'Grace'), true);
  s = tv.state();
  assert.equal(s.playing, false);
  assert.ok(s.position >= 90 && s.position < 95, `paused at ${s.position}`);
  assert.equal(tv.pause(undefined, 'Grace'), false);
  assert.equal(tv.state().by, 'Grace');

  // Resuming carries on from there, not from the link's timestamp all over again.
  assert.deepEqual(tv.play({}, 'Ken'), { changed: true });
  assert.equal(tv.state().position, s.position);
  assert.equal(tv.state().playing, true);

  // Seeking jumps; being dragged back over where it already is isn't news.
  assert.equal(tv.seek(300, 'Grace'), true);
  assert.equal(tv.state().position, 300);
  assert.equal(tv.seek(300.1, 'Grace'), false);
  assert.equal(tv.seek(-5, 'Grace'), false, 'a position no video can be at is left where it was');
  assert.equal(tv.seek('over there', 'Grace'), false);
  assert.equal(tv.state().position, 300);

  // Off it comes, but the link stays for Play to put straight back on.
  assert.equal(tv.stop('Ken'), true);
  assert.equal(tv.state().on, false);
  assert.equal(tv.stop('Ken'), false);
  assert.equal(tv.state().url, `${YT}&t=90`);
  assert.deepEqual(tv.play({ url: 'https://example.com/movie.mp4' }, 'Ada'), { changed: true });
  assert.equal(tv.state().position, 0, 'a fresh link starts at its own beginning');
  assert.equal(tv.title(), 'example.com · movie.mp4');
});

test('what’s on the TV is still on it after a restart, and only they can read it', (t) => {
  const { dir, tv } = tvFor(t);
  assert.equal(tv.play({ url: `${YT}&t=90` }, 'Ada').changed, true);
  assert.equal(tv.pause(120, 'Grace'), true);
  assert.equal(tv.state().url, `${YT}&t=90`);
  assert.equal(tv.state().position, 120);

  const after = new Tv(dir);
  assert.equal(after.state().on, true);
  assert.equal(after.state().playing, false);
  assert.equal(after.state().position, 120);
  assert.equal(after.state().by, 'Grace');
  assert.equal(after.state().at, tv.state().at);
  // The floor's own file, like the jukebox's, is nobody else's to read.
  assert.equal(statSync(path.join(dir, 'tv.json')).mode & 0o777, 0o600);
});

test('a tv.json nobody would have allowed leaves the screen dark', (t) => {
  const { dir } = tvFor(t);
  writeFileSync(path.join(dir, 'tv.json'), JSON.stringify({ on: true, url: 'javascript:alert(1)', playing: true, position: 5, at: 1 }));
  assert.equal(new Tv(dir).state().on, false, 'a link that would have been turned away is not played');
  writeFileSync(path.join(dir, 'tv.json'), JSON.stringify({ on: true, url: YT, playing: true, position: 'lots', at: 'now', by: 42 }));
  const broken = new Tv(dir);
  assert.equal(broken.state().on, true, 'the link it can read is kept');
  assert.equal(broken.state().position, 0, 'a position that is not a number is the start');
  assert.equal(broken.state().by, undefined, 'a name that is not a name is left out');
  writeFileSync(path.join(dir, 'tv.json'), '{ not json');
  assert.equal(new Tv(dir).state().on, false);
});
