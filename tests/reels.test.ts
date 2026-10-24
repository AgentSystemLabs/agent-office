import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TOOLS, UsageError, buildRequest, formatStatus, parseArgs, toolCall } from '../bin/office-reels.js';
import { assCaptions, assTime, captionChunks, estimateTimings, sceneDurations, wordsFromAlignment } from '../src/server/reels/captions.js';
import { crewBrief } from '../src/server/reels/crew.js';
import { POLLINATIONS_GAP_MS, imageBatch, imageExt, imagePrompt, mediaKeys, picture, retryAfter } from '../src/server/reels/media.js';
import { ffmpegArgs } from '../src/server/reels/render.js';
import { nudges, postDue } from '../src/server/reels/schedule.js';
import { makeSeries, postCaption, readScript, readSeries } from '../src/server/reels/store.js';
import { Studio } from '../src/server/reels/studio.js';
import type { CrewMember, Scene } from '../src/server/reels/types.js';

const scenes: Scene[] = [
  { narration: 'In 1872, a ship was found drifting.', visual: 'a ghost ship in fog' },
  { narration: 'Nobody was on board, and the table was set.', visual: 'a dinner table in a ship cabin' },
];

const script = (n = 2) => ({
  title: 'The empty ship',
  scenes: Array.from({ length: n }, (_, i) => ({ narration: `Line ${i} of the story, told well.`, visual: `picture ${i}` })),
  caption: 'Where did they go?',
  hashtags: ['#mystery', 'history', 'bad tag!'],
});

test('timings cover the narration, scene by scene, with no gap', () => {
  const words = estimateTimings(scenes, 10);
  assert.equal(words.length, 16);
  assert.equal(words[0].start, 0);
  assert.ok(Math.abs(words.at(-1)!.end - 10) < 1e-9);
  // A full stop holds longer than a word of the same length without one.
  const drifting = words.find((w) => w.text === 'drifting.')!;
  const nobody = words.find((w) => w.text === 'Nobody')!;
  assert.ok(drifting.end - drifting.start > (nobody.end - nobody.start) * 1.2);
  const d = sceneDurations(words, 2, 10.6);
  assert.ok(Math.abs(d[0] + d[1] - 10.6) < 1e-9);
  assert.equal(d[0], words.find((w) => w.scene === 1)!.start);
});

test('character timings become word timings', () => {
  const s: Scene[] = [{ narration: 'Hi there.', visual: 'x' }, { narration: 'Bye.', visual: 'y' }];
  const text = 'Hi there. Bye.';
  const chars = [...text];
  const starts = chars.map((_, i) => i * 0.1);
  const ends = chars.map((_, i) => i * 0.1 + 0.1);
  const w = wordsFromAlignment(s, chars, starts, ends);
  assert.deepEqual(w.map((x) => [x.text, x.scene]), [['Hi', 0], ['there.', 0], ['Bye.', 1]]);
  assert.ok(Math.abs(w[1].start - 0.3) < 1e-9);
  assert.ok(Math.abs(w[2].end - 1.4) < 1e-9);
});

test('captions come a few words at a time, a sentence never across two', () => {
  const words = estimateTimings(scenes, 10);
  const chunks = captionChunks(words, 3);
  assert.equal(chunks[0].text, 'In 1872,');
  assert.ok(chunks.every((c) => c.text.split(' ').length <= 3));
  assert.ok(chunks.some((c) => c.text.endsWith('drifting.')));
  for (let i = 0; i + 1 < chunks.length; i++) assert.equal(chunks[i].end, chunks[i + 1].start);
  const ass = assCaptions([{ text: 'a {b} \\c', start: 0, end: 1.234, scene: 0 }]);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.23,Caption,,0,0,0,,A B C/);
  assert.equal(assTime(3725.5), '1:02:05.50');
});

test('a series is read carefully, and gets the defaults', () => {
  assert.equal(readSeries({ niche: 'x' }), 'A series needs a name');
  assert.match(String(readSeries({ name: 'a', niche: 'b', platforms: ['tiktok', 'myspace'] })), /myspace/);
  assert.match(String(readSeries({ name: 'a', niche: 'b', postsPerDay: 40 })), /postsPerDay/);
  assert.match(String(readSeries({ name: 'a', niche: 'b', music: '../../etc/passwd' })), /not a path/);
  const fields = readSeries({ name: 'Myths', niche: 'Greek myths', platforms: 'tiktok, youtube', hashtags: '#myth greek', postsPerDay: 2 });
  assert.equal(typeof fields, 'object');
  const s = makeSeries(fields as object, 'Ada', 1);
  assert.deepEqual(s.platforms, ['tiktok', 'youtube']);
  assert.deepEqual(s.hashtags, ['myth', 'greek']);
  assert.equal(s.tiktokPrivacy, 'SELF_ONLY');
  assert.equal(s.youtubePrivacy, 'private');
  assert.equal(readSeries({ name: '' }, s), 'A series keeps a name and a niche');
});

test('a script is checked before it is kept', () => {
  assert.match(String(readScript({})), /scenes/);
  assert.match(String(readScript({ ...script(), scenes: [{ narration: 'x' }] })), /Scene 1/);
  assert.match(String(readScript({ ...script(15) })), /At most/);
  assert.match(String(readScript({ ...script(), caption: '' })), /caption/);
  const long = { ...script(1), scenes: Array.from({ length: 10 }, () => ({ narration: Array(25).fill('word').join(' '), visual: 'v' })) };
  assert.match(String(readScript(long)), /under 190/);
  const ok = readScript(script());
  assert.equal(typeof ok, 'object');
  assert.deepEqual((ok as { hashtags: string[] }).hashtags, ['mystery', 'history']);
});

test('the caption a reel posts with ends with the call to action and hashtags', () => {
  const s = makeSeries({ name: 'M', niche: 'n', cta: 'Follow for part 2', hashtags: ['myth'] }, 'Ada', 1);
  const cap = postCaption({ caption: 'Who did it?', hashtags: ['myth', 'greek'], title: 't' } as never, s);
  assert.equal(cap, 'Who did it?\n\nFollow for part 2\n\n#myth #greek');
  assert.equal(postCaption({ caption: 'x'.repeat(3000), title: 't' } as never, s).length, 2200);
});

test('ffmpeg gets a shot per scene, the captions and the voice under the music', () => {
  const args = ffmpegArgs({ shots: [{ image: 'scene-0.png', seconds: 2 }, { color: '0x112233', seconds: 1.5 }], voice: 'voice.mp3', music: '/m/track.mp3', captions: 'captions.ass', total: 3.5, out: '/o/r.mp4' });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.match(graph, /\[0:v\]scale=1620:2880.*zoompan=.*d=60:/);
  assert.match(graph, /\[v0\]\[v1\]concat=n=2:v=1:a=0,format=yuv420p,ass=captions\.ass\[v\]/);
  assert.match(graph, /\[3:a\]volume=0\.14\[m\];\[2:a\]\[m\]amix/);
  assert.ok(args.includes('color=c=0x112233:s=1080x1920:r=30:d=1.500'));
  assert.equal(args.at(-1), '/o/r.mp4');
  // No voice: silence, as long as the reel.
  const quiet = ffmpegArgs({ shots: [{ color: 'black', seconds: 3 }], captions: 'c.ass', total: 3, out: 'o.mp4' });
  assert.ok(quiet.includes('anullsrc=r=44100:cl=stereo'));
  assert.match(quiet[quiet.indexOf('-filter_complex') + 1], /\[1:a\]anull\[a\]/);
});

test('media is free by default, and paid once a key is there', () => {
  // No Kokoro set up: silence for the voice, and Pollinations' free images.
  const none = { REELS_KOKORO_DIR: path.join(tmpdir(), 'no-kokoro-here') };
  assert.deepEqual(mediaKeys(none), { voice: 'placeholder', images: 'pollinations' });
  assert.deepEqual(mediaKeys({ ...none, OPENAI_API_KEY: 'k' }), { voice: 'openai', images: 'openai' });
  assert.deepEqual(mediaKeys({ ...none, OPENAI_API_KEY: 'k', ELEVENLABS_API_KEY: 'e', FAL_KEY: 'f' }), { voice: 'elevenlabs', images: 'fal' });
  assert.deepEqual(mediaKeys({ ...none, OPENAI_API_KEY: 'k', REELS_MEDIA: 'placeholder' }), { voice: 'placeholder', images: 'placeholder' });
  // Picked outright, whatever keys there are; a name it doesn't know is ignored.
  assert.deepEqual(mediaKeys({ ...none, OPENAI_API_KEY: 'k', REELS_VOICE: 'kokoro', REELS_IMAGES: 'pollinations' }), { voice: 'kokoro', images: 'pollinations' });
  assert.deepEqual(mediaKeys({ ...none, REELS_IMAGES: 'midjourney' }), { voice: 'placeholder', images: 'pollinations' });
  assert.equal(imageBatch({ voice: 'kokoro', images: 'pollinations' }), 1);
  // Pollinations' free tier says how long to wait; without a number, the tier's own gap.
  assert.equal(retryAfter('Free limit reached: 1 image every 45 seconds per IP. Retry after 40s, or get a key', 1), 42_000);
  assert.equal(retryAfter('busy', POLLINATIONS_GAP_MS), POLLINATIONS_GAP_MS);
  assert.equal(imageBatch({ voice: 'openai', images: 'fal' }), 3);
  const s = makeSeries({ name: 'M', niche: 'n', style: 'oil painting' }, 'Ada', 1);
  assert.match(imagePrompt(scenes[0], s), /^a ghost ship in fog\. Style: oil painting\. .*no text/);
});

test('a series posts once its gap has passed', () => {
  const s = makeSeries({ name: 'M', niche: 'n', platforms: ['tiktok'], postsPerDay: 2 }, 'Ada', 1);
  const h = 3600_000;
  assert.equal(postDue(s, undefined, 0), true);
  assert.equal(postDue(s, 0, 11 * h), false);
  assert.equal(postDue(s, 0, 12 * h), true);
  assert.equal(postDue({ ...s, paused: true }, undefined, 0), false);
  assert.equal(postDue({ ...s, platforms: [] }, undefined, 0), false);
});

test('briefs carry the house rules and the role', () => {
  const b = crewBrief('writer', { id: 's-1', name: 'Myths' });
  assert.match(b, /original writing only/);
  assert.match(b, /WRITER/);
  assert.match(b, /office-reels script/);
  assert.match(b, /"Myths" \(s-1\)/);
  assert.match(crewBrief('editor'), /cannot approve a reel you wrote/);
});

function studio() {
  const dir = mkdtempSync(path.join(tmpdir(), 'reels-'));
  const toasts: string[] = [];
  const told: [string, string][] = [];
  const status = new Map<string, string>();
  let clock = 1_000_000;
  const posted: string[] = [];
  const s = new Studio(dir, {
    toast: (t) => toasts.push(t),
    workerStatus: (m) => status.get(m.workerId) as never,
    tell: (m, t) => void told.push([m.name, t]),
    produce: async (r) => ({ video: path.join(dir, `${r.id}.mp4`), duration: 42 }),
    publish: async (p, u) => {
      posted.push(`${p}:${u.caption}`);
      return { at: clock, id: `${p}-1`, url: `https://example.test/${p}` };
    },
    now: () => clock,
  });
  return { s, dir, toasts, told, status, posted, tick: (ms: number) => (clock += ms), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a reel goes from idea to approved, and nobody approves their own', async () => {
  const t = studio();
  try {
    const series = t.s.addSeries({ name: 'Myths', niche: 'Greek myths', platforms: ['tiktok'] }, 'Ada');
    assert.equal(typeof series, 'object');
    const idea = t.s.addIdea('myths', { title: 'The box', hook: 'Never open it.' }, 'Scout');
    assert.equal(typeof idea, 'object');
    const id = (idea as { id: string }).id;
    const r = t.s.script(id, undefined, script(), 'Wren');
    assert.equal((r as { status: string }).status, 'scripted');
    await t.s.tick();
    await new Promise((res) => setTimeout(res, 10));
    assert.equal(t.s.store.reel(id)!.status, 'rendered');
    assert.match(String(t.s.review(id, true, '', 'Wren')), /You wrote it/);
    assert.match(String(t.s.review(id, false, '', 'Ed')), /Say what to fix/);
    t.s.review(id, false, 'The hook is weak', 'Ed');
    assert.equal(t.s.store.reel(id)!.status, 'rejected');
    t.s.script(id, undefined, script(3), 'Wren');
    await t.s.tick();
    await new Promise((res) => setTimeout(res, 10));
    const ok = t.s.review(id, true, '', 'Ed');
    assert.equal((ok as { status: string }).status, 'approved');
    // Nothing is connected: it isn't posted, and that's said once.
    await t.s.tick();
    assert.equal(t.s.store.reel(id)!.status, 'approved');
    assert.equal(t.toasts.filter((x) => x.includes('none of its platforms')).length, 1);
  } finally {
    t.done();
  }
});

test('the crew is asked for what the series needs, not twice in a row', () => {
  const t = studio();
  try {
    t.s.addSeries({ name: 'Myths', niche: 'n', platforms: ['tiktok'], backlog: 2 }, 'Ada');
    const crew = (role: CrewMember['role'], id: string): CrewMember => ({ role, workerId: id, floorId: 'f', name: id, hiredAt: 0 });
    t.s.addCrew(crew('scout', 'sc'));
    t.s.addCrew(crew('writer', 'wr'));
    const st = t.s.store.state;
    const all = () => true;
    // No ideas at all: the scout is asked, the writer has nothing to write.
    assert.deepEqual(nudges(st, 10 ** 9, all).map((n) => n.member.role), ['scout']);
    t.s.addIdea('Myths', { title: 'One' }, 'sc');
    const asked = nudges(st, 10 ** 9, all);
    assert.deepEqual(asked.map((n) => n.member.role), ['writer', 'scout']);
    for (const n of asked) n.member.nudgedAt = 10 ** 9;
    assert.deepEqual(nudges(st, 10 ** 9 + 1000, all), []);
    // A busy worker isn't interrupted.
    assert.deepEqual(nudges(st, 10 ** 10, (m) => m.role !== 'writer').map((n) => n.member.role), ['scout']);
  } finally {
    t.done();
  }
});

test('crew whose workers left are let go, and the rest are nudged on the tick', async () => {
  const t = studio();
  try {
    t.s.addSeries({ name: 'Myths', niche: 'n', platforms: ['tiktok'] }, 'Ada');
    t.s.addCrew({ role: 'scout', workerId: 'sc', floorId: 'f', name: 'Sky', hiredAt: 0 });
    t.s.addCrew({ role: 'writer', workerId: 'gone', floorId: 'f', name: 'Ghost', hiredAt: 0 });
    t.status.set('sc', 'done');
    await t.s.tick();
    assert.deepEqual(t.s.store.state.crew.map((c) => c.name), ['Sky']);
    assert.equal(t.told.length, 1);
    assert.match(t.told[0][1], /^\[office-reels\] "Myths" is down to 0 ideas\. Add ideas/);
  } finally {
    t.done();
  }
});

test('office-reels parses its commands', () => {
  assert.deepEqual(parseArgs([]), { cmd: 'help' });
  assert.deepEqual(parseArgs(['status', '--json']), { cmd: 'status', method: 'GET', path: '', json: true });
  assert.deepEqual(parseArgs(['idea', 's-1', '--title', 'T', '--hook=H']), { cmd: 'idea', method: 'POST', path: '/idea', body: { series: 's-1', title: 'T', hook: 'H', idea: undefined } });
  assert.deepEqual(parseArgs(['script', 'r-1']), { cmd: 'script', method: 'POST', path: '/script', body: { reel: 'r-1' }, stdin: 'json' });
  assert.deepEqual(parseArgs(['script', '--series', 'Myths']).body, { series: 'Myths' });
  assert.deepEqual(parseArgs(['review', 'r-1', '--reject', '--note', 'weak']).body, { reel: 'r-1', approve: false, note: 'weak' });
  assert.deepEqual(parseArgs(['series', 'add', '--name', 'M', '--niche', 'n', '--platforms', 'tiktok,youtube', '--postsPerDay', '2']).body, { name: 'M', niche: 'n', platforms: ['tiktok', 'youtube'], postsPerDay: 2 });
  assert.equal(parseArgs(['series', 'add']).stdin, 'json');
  assert.deepEqual(parseArgs(['series', 'set', 'M', '--pause']).body, { series: 'M', paused: true });
  assert.deepEqual(parseArgs(['note', 'M', 'hooks with a number win']).body, { series: 'M', text: 'hooks with a number win' });
  assert.equal(parseArgs(['note', 'M']).stdin, 'text');
  assert.deepEqual(parseArgs(['crew', 'hire', '--roles', 'writer,editor', '--model', 'sonnet']).body, { roles: ['writer', 'editor'], model: 'sonnet' });
  assert.deepEqual(parseArgs(['crew', 'join', 'analyst', '--series', 'M']).body, { role: 'analyst', series: 'M' });
  assert.throws(() => parseArgs(['review', 'r-1']), UsageError);
  assert.throws(() => parseArgs(['crew', 'hire', '--roles', 'boss']), UsageError);
  assert.throws(() => parseArgs(['idea', 's']), UsageError);
  assert.throws(() => parseArgs(['dance']), UsageError);
});

test('office-reels calls the office as the worker, with long waits for posting', () => {
  const office = { url: 'http://127.0.0.1:4455', worker: 'w1', token: 'tok' };
  const get = buildRequest({ method: 'GET', path: '/reel', query: { id: 'r-1' } }, office);
  assert.equal(get.url, 'http://127.0.0.1:4455/office/reels/reel?worker=w1&id=r-1');
  assert.equal(get.headers.authorization, 'Bearer tok');
  const post = buildRequest({ method: 'POST', path: '/post', body: { reel: 'r-1' } }, office);
  assert.equal(post.body, '{"reel":"r-1"}');
  assert.ok(post.timeout >= 10 * 60_000);
  // Every tool maps to a call.
  for (const t of TOOLS) assert.ok(toolCall(t.name, { series: 's', reel: 'r' }).path !== undefined);
  assert.equal(toolCall('reels_series', {}).path, '/series');
  assert.equal(toolCall('reels_series', { series: 's' }).path, '/series/set');
  const text = formatStatus({ media: { voice: 'openai', images: 'fal' }, connected: [], series: [], reels: [], crew: [] });
  assert.match(text, /No series yet/);
  assert.match(text, /No crew yet/);
});

test('an image keeps the extension its bytes say, and Pollinations is asked for a tall one', async () => {
  assert.equal(imageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'png');
  assert.equal(imageExt(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'webp');
  assert.throws(() => imageExt(Buffer.from('<html>busy</html>')), /isn't an image/);
  const dir = mkdtempSync(path.join(tmpdir(), 'reels-img-'));
  try {
    let asked = '';
    let auth: string | undefined;
    const fake = (async (url: string, init?: RequestInit) => {
      asked = url;
      auth = (init?.headers as Record<string, string>)?.authorization;
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    }) as typeof fetch;
    const file = await picture('a ship in fog', path.join(dir, 'scene-0'), { voice: 'kokoro', images: 'pollinations' }, { POLLINATIONS_TOKEN: 'tok' }, fake);
    assert.equal(file, 'scene-0.jpg');
    assert.ok(existsSync(path.join(dir, 'scene-0.jpg')));
    assert.ok(asked.startsWith('https://image.pollinations.ai/prompt/a%20ship%20in%20fog?width=1080&height=1920&'), asked);
    assert.match(asked, /nologo=true/);
    assert.equal(auth, 'Bearer tok');
    assert.equal(await picture('x', path.join(dir, 'scene-1'), { voice: 'placeholder', images: 'placeholder' }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
