import assert from 'node:assert/strict';
import test from 'node:test';
import { clampVolume, parseYoutubeLink, parseYoutubeStart } from '../src/client/youtube.js';

test('parseYoutubeLink reads the usual YouTube urls', () => {
  assert.deepEqual(parseYoutubeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { videoId: 'dQw4w9WgXcQ', list: undefined, start: undefined });
  assert.deepEqual(parseYoutubeLink('https://youtu.be/dQw4w9WgXcQ?t=43'), { videoId: 'dQw4w9WgXcQ', list: undefined, start: 43 });
  assert.deepEqual(parseYoutubeLink('https://m.youtube.com/shorts/dQw4w9WgXcQ'), { videoId: 'dQw4w9WgXcQ', list: undefined, start: undefined });
  assert.deepEqual(parseYoutubeLink('youtube.com/embed/dQw4w9WgXcQ?start=12'), { videoId: 'dQw4w9WgXcQ', list: undefined, start: 12 });
  assert.deepEqual(parseYoutubeLink('https://www.youtube.com/live/dQw4w9WgXcQ'), { videoId: 'dQw4w9WgXcQ', list: undefined, start: undefined });
  assert.deepEqual(parseYoutubeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij&t=1m30s'), { videoId: 'dQw4w9WgXcQ', list: 'PLabcdefghij', start: 90 });
  assert.deepEqual(parseYoutubeLink('https://www.youtube.com/playlist?list=PLabcdefghij'), { videoId: undefined, list: 'PLabcdefghij', start: undefined });
  assert.deepEqual(parseYoutubeLink('dQw4w9WgXcQ'), { videoId: 'dQw4w9WgXcQ' });
});

test('parseYoutubeLink rejects anything that is not a video or a playlist', () => {
  assert.equal(parseYoutubeLink(''), null);
  assert.equal(parseYoutubeLink('https://vimeo.com/123456789'), null);
  assert.equal(parseYoutubeLink('https://www.youtube.com/watch?v=short'), null);
  assert.equal(parseYoutubeLink('not a link'), null);
  assert.equal(parseYoutubeLink('https://www.youtube.com/feed/subscriptions'), null);
});

test('parseYoutubeStart reads clock times', () => {
  assert.equal(parseYoutubeStart('90'), 90);
  assert.equal(parseYoutubeStart('1h2m3s'), 3723);
  assert.equal(parseYoutubeStart('2m'), 120);
  assert.equal(parseYoutubeStart('nope'), undefined);
  assert.equal(parseYoutubeStart(null), undefined);
});

test('clampVolume stays in 0 to 100', () => {
  assert.equal(clampVolume(40.6), 41);
  assert.equal(clampVolume(-4), 0);
  assert.equal(clampVolume(140), 100);
  assert.equal(clampVolume(Number.NaN), 100);
});
