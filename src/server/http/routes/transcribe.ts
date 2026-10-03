/**
 * POST /api/transcribe: audio from a VR (or other) dictation session → text via OpenAI Whisper.
 * Needs OPENAI_API_KEY on the office; without it, answers 501 so the client can say so.
 */
import { readBytes, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

/** Cap on uploaded audio (bytes). About a minute of webm/opus. */
const MAX_BYTES = 4 * 1024 * 1024;

export const transcribeRoutes = {
  transcribe: {
    path: '/api/transcribe',
    method: 'POST',
    auth: 'session',
    async handle(ctx, { req, res }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const key = process.env.OPENAI_API_KEY?.trim();
      if (!key) {
        return send(res, 501, {
          error: 'Dictation on this browser needs OPENAI_API_KEY on the office server (the browser has no built-in speech recognition).',
        });
      }
      if (Number(req.headers['content-length']) > MAX_BYTES) {
        return send(res, 413, { error: `That recording is too long (${MAX_BYTES / 1024 / 1024} MB at most)` });
      }
      let body: Buffer;
      try {
        body = await readBytes(req, MAX_BYTES);
      } catch (err) {
        return (err as Error).message === 'too large'
          ? send(res, 413, { error: `That recording is too long (${MAX_BYTES / 1024 / 1024} MB at most)` })
          : send(res, 400, { error: 'Bad request' });
      }
      if (body.length < 256) return send(res, 400, { error: 'Nothing to transcribe' });
      const type = String(req.headers['content-type'] || 'audio/webm').split(';')[0]!.trim() || 'audio/webm';
      const ext = type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
      try {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(body)], { type }), `speech.${ext}`);
        form.append('model', 'whisper-1');
        const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
        const data = (await r.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
        if (!r.ok) {
          console.warn('whisper:', r.status, data);
          return send(res, 502, { error: data.error?.message || 'The speech service didn’t answer' });
        }
        return send(res, 200, { text: typeof data.text === 'string' ? data.text : '' });
      } catch (err) {
        console.warn('whisper failed', err);
        return send(res, 502, { error: 'The speech service didn’t answer' });
      }
    },
  } satisfies Route,
};
