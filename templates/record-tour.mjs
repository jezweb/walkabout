#!/usr/bin/env node
/**
 * Record the guided tour as a video WITH narration audio — fully headless,
 * no popups, no manual steps, repeatable.
 *
 * How: Playwright records the video (recordVideo has no audio track), the
 * page's `Audio.play` is patched to log the exact ms each step's narration
 * starts, and ffmpeg muxes the ORIGINAL tour MP3s onto the video at those
 * offsets. Source-quality audio, perfect repeatability, works headless —
 * no getDisplayMedia picker (that path needs a human to pick a TAB, and a
 * window/screen pick silently records no audio).
 *
 * Usage: node scripts/record-tour.mjs
 * Output: media/tour-demo.mp4 (+ the raw silent .webm)
 *
 * AUTH: the localStorage API-key bootstrap below is for API-key auth. For a
 * cookie/OAuth app (better-auth etc.) DON'T add an API key — sign in once by
 * hand and save the session:
 *     await context.storageState({ path: 'auth-state.json' });  // gitignore it
 * then create the context with `{ storageState: 'auth-state.json' }` and delete
 * the sign-in page block. (Or mint a session via an existing test-auth
 * endpoint.) Set STEPS to your app's step count.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT_DIR = path.join(ROOT, 'media');
fs.mkdirSync(OUT_DIR, { recursive: true });
const MP4 = path.join(OUT_DIR, 'tour-demo.mp4');
// ADAPT: your app's headless sign-in (this example: an API key into localStorage).
const API_KEY = process.env.APP_API_KEY ?? '';
const STEPS = 7;
/** Nudge if voice runs ahead of (+ms) or behind (-ms) the video. */
const SYNC_OFFSET_MS = 0;

const mp3 = (n) => path.join(ROOT, `public/tour/step-${n}.mp3`);
const durationS = (file) =>
  Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8' }
    ).trim()
  );
const lastDuration = durationS(mp3(STEPS));

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
});

// Page A: sign in + suppress the first-visit offer (localStorage persists
// across pages in the context). Its video file is junk — deleted later.
console.log('signing in…');
const setup = await context.newPage();
await setup.goto('https://fieldproof.au/operations');
await setup.evaluate(
  ([key]) => {
    localStorage.setItem('app:api_key', key);
    localStorage.setItem('app:tour', 'done');
  },
  [API_KEY]
);
const junkVideo = setup.video();
await setup.close();

// Page B: the take. Video t=0 ≈ navigation start ≈ performance.timeOrigin,
// so each Audio.play()'s performance.now() IS its offset in the video.
console.log('recording the tour…');
const page = await context.newPage();
await page.addInitScript(() => {
  window.__audioLog = [];
  const origPlay = Audio.prototype.play;
  Audio.prototype.play = function (...args) {
    window.__audioLog.push({ src: this.src, t: performance.now() });
    return origPlay.apply(this, args);
  };
});
await page.goto('https://fieldproof.au/operations?tour=1');

// Auto-advance walks all steps; wait until the last step's narration starts.
await page.waitForFunction(
  (n) => new Set(window.__audioLog.map((e) => e.src)).size >= n,
  STEPS,
  { timeout: 300_000, polling: 500 }
);
console.log(`last step narrating — letting it finish (${Math.ceil(lastDuration)}s)…`);
await page.waitForTimeout((lastDuration + 2.5) * 1000);

// First play() per src = the step's start offset (replays/resumes ignored).
const audioLog = await page.evaluate(() => window.__audioLog);
const offsets = [];
for (let n = 1; n <= STEPS; n++) {
  const hit = audioLog.find((e) => e.src.endsWith(`/tour/step-${n}.mp3`));
  if (!hit) throw new Error(`no play event for step ${n}`);
  offsets.push(Math.max(0, Math.round(hit.t + SYNC_OFFSET_MS)));
}
console.log('step offsets (ms):', offsets.join(', '));

const video = page.video();
await page.close();
const webm = await video.path();
await browser.close();
if (junkVideo) fs.rmSync(await junkVideo.path(), { force: true });

// Mux: each MP3 delayed to its measured offset, mixed onto the silent video.
console.log('muxing audio…');
const inputs = [];
const delays = [];
for (let n = 1; n <= STEPS; n++) {
  inputs.push('-i', mp3(n));
  delays.push(`[${n}:a]adelay=${offsets[n - 1]}|${offsets[n - 1]}[a${n}]`);
}
const mixIn = Array.from({ length: STEPS }, (_, k) => `[a${k + 1}]`).join('');
execFileSync(
  'ffmpeg',
  [
    '-y', '-i', webm, ...inputs,
    '-filter_complex', `${delays.join(';')};${mixIn}amix=inputs=${STEPS}:normalize=0[aout]`,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '128k', '-shortest',
    MP4,
  ],
  { stdio: 'pipe' }
);
fs.rmSync(webm, { force: true });
console.log(`wrote ${MP4} (${Math.round(fs.statSync(MP4).size / 1024 / 1024)}MB)`);
execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'csv', MP4], { stdio: 'inherit' });
