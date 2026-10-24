// Putting a reel together with ffmpeg: each scene's image slowly zooming for as long as its words
// take, one after another, the captions burned in, the voice over the top and the music under it,
// as a 1080×1920 MP4 the platforms take. ffmpeg (and ffprobe) must be on the office's PATH, or named
// by REELS_FFMPEG / REELS_FFPROBE.

import { execFile } from 'node:child_process';

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;

/** One scene for ffmpeg: its image's file name in the work folder, or a color, and how long it's up. */
export interface Shot {
  image?: string;
  color?: string;
  seconds: number;
}

export interface RenderPlan {
  shots: Shot[];
  /** The voice's file name in the work folder; silence when there's none. */
  voice?: string;
  /** The music, a full path; it loops under the voice. */
  music?: string;
  /** The captions' file name in the work folder. */
  captions: string;
  /** How long the reel runs, in seconds. */
  total: number;
  /** Where the finished video goes, a full path. */
  out: string;
}

/**
 * The slow push in (or, on every other scene, out) over a scene's image: the zoompan filter's
 * settings for `frames` frames.
 */
export function kenBurns(frames: number, zoomOut: boolean): string {
  const step = (0.12 / Math.max(1, frames)).toFixed(5);
  const z = zoomOut ? `if(eq(on,0),1.12,max(zoom-${step},1))` : `min(zoom+${step},1.12)`;
  return `zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${WIDTH}x${HEIGHT}:fps=${FPS}`;
}

/**
 * ffmpeg's arguments for a plan, run in the work folder (so the captions' file needs no escaping in
 * the filter graph, which on Windows it otherwise would).
 */
export function ffmpegArgs(plan: RenderPlan): string[] {
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters: string[] = [];
  plan.shots.forEach((shot, i) => {
    const frames = Math.max(1, Math.round(shot.seconds * FPS));
    if (shot.image) {
      args.push('-i', shot.image);
      // Big enough first that the zoom stays sharp, and cropped to the frame's shape.
      filters.push(`[${i}:v]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,setsar=1,${kenBurns(frames, i % 2 === 1)},trim=end_frame=${frames}[v${i}]`);
    } else {
      args.push('-f', 'lavfi', '-i', `color=c=${shot.color ?? 'black'}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${(frames / FPS).toFixed(3)}`);
      filters.push(`[${i}:v]setsar=1[v${i}]`);
    }
  });
  const n = plan.shots.length;
  filters.push(`${plan.shots.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,format=yuv420p,ass=${plan.captions}[v]`);

  const voice = n;
  if (plan.voice) args.push('-i', plan.voice);
  else args.push('-f', 'lavfi', '-t', plan.total.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo');
  if (plan.music) {
    args.push('-stream_loop', '-1', '-i', plan.music);
    // amix halves both, so the voice is put back where it was and the music sits well under it.
    filters.push(`[${n + 1}:a]volume=0.14[m]`, `[${voice}:a][m]amix=inputs=2:duration=first:dropout_transition=0,volume=2[a]`);
  } else filters.push(`[${voice}:a]anull[a]`);

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-t', plan.total.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-movflags', '+faststart',
    plan.out,
  );
  return args;
}

const ffmpegBin = () => process.env.REELS_FFMPEG || 'ffmpeg';
const ffprobeBin = () => process.env.REELS_FFPROBE || 'ffprobe';

function run(cmd: string, args: string[], cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      reject(new Error(missing ? `${cmd} isn't installed on the office's machine (or set REELS_FFMPEG / REELS_FFPROBE)` : `${cmd} failed: ${(stderr || err.message).trim().split('\n').slice(-4).join(' ')}`));
    });
  });
}

/** How long a media file plays, in seconds. */
export async function probeDuration(file: string, cwd: string): Promise<number> {
  const out = await run(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], cwd, 30_000);
  const s = Number(out.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error(`ffprobe couldn't tell how long ${file} is`);
  return s;
}

/** Renders the plan in the work folder `cwd`. */
export async function render(plan: RenderPlan, cwd: string): Promise<void> {
  await run(ffmpegBin(), ffmpegArgs(plan), cwd, 10 * 60_000);
}
