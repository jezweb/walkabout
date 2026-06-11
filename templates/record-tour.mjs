#!/usr/bin/env node
/**
 * Record the guided tour as a video WITH narration audio — fully headless,
 * no popups, no manual steps, repeatable.
 *
 * Capture: LOSSLESS PNG frames straight from Chrome's screencast API
 * (CDP Page.startScreencast), assembled by ffmpeg at constant quality.
 * Playwright's built-in recordVideo is NOT used — its adaptive VP8 encoder
 * oscillates compression quality frame-to-frame, which reads as the whole
 * page blinking/flashing ("it's the capture, the whole view" — Jez,
 * 2026-06-11). PNG source makes quality flutter impossible.
 *
 * Audio: the page's Audio.play is patched to log each narration's start
 * (performance.now), mapped to epoch via performance.timeOrigin, aligned
 * against the first frame's epoch timestamp — then ffmpeg muxes the
 * ORIGINAL MP3s at those offsets. Source-quality audio, sync by construction.
 *
 * Usage:
 *   WALKABOUT_URL=https://your-app  WALKABOUT_AUTH_STATE=media/auth-state.json \
 *   WALKABOUT_STEPS=7  node scripts/record-tour.mjs
 * Output: media/tour-demo.mp4
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT_DIR = path.join(ROOT, 'media');
const FRAMES_DIR = path.join(OUT_DIR, 'frames-tmp');
fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });
const MP4 = path.join(OUT_DIR, 'tour-demo.mp4');

const BASE = process.env.WALKABOUT_URL || 'http://localhost:5173';
const START = process.env.WALKABOUT_START || '/'; // page where the tour mounts
const STEPS = Number(process.env.WALKABOUT_STEPS || 7);
// AUTH (default — any cookie/OAuth app): a Playwright storageState file holding a
// live session cookie. Sign in once by hand → `context.storageState({ path })`, or
// mint one headlessly via a test-auth/dev-login endpoint. gitignore it (live cookie).
// API-key apps can instead localStorage-set a key on a setup page before recording.
const AUTH_STATE = process.env.WALKABOUT_AUTH_STATE || path.join(ROOT, 'media/auth-state.json');
if (!fs.existsSync(AUTH_STATE)) {
  console.error(`No auth state at ${AUTH_STATE}. See the AUTH note in this file's header.`);
  process.exit(1);
}

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
  storageState: AUTH_STATE,
});

// The take: deep-link straight into the tour; auto-advance does the rest.
console.log('recording the tour (lossless screencast)…');
const page = await context.newPage();
await page.addInitScript(() => {
  window.__audioLog = [];
  const origPlay = Audio.prototype.play;
  Audio.prototype.play = function (...args) {
    window.__audioLog.push({ src: this.src, t: performance.now() });
    return origPlay.apply(this, args);
  };
});

// Lossless frame capture — write each frame to disk as it arrives, with its
// epoch timestamp. Screencast only sends frames on change, so still moments
// produce few frames; per-frame durations reconstruct real time.
const cdp = await context.newCDPSession(page);
const frameMeta = []; // { file, ts }
let frameN = 0;
cdp.on('Page.screencastFrame', (ev) => {
  const file = path.join(FRAMES_DIR, `f-${String(frameN++).padStart(5, '0')}.png`);
  fs.writeFileSync(file, Buffer.from(ev.data, 'base64'));
  frameMeta.push({ file, ts: ev.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
});
await cdp.send('Page.startScreencast', {
  format: 'png',
  maxWidth: 1440,
  maxHeight: 900,
  everyNthFrame: 1,
});

await page.goto(`${BASE}${START}?tour=1`);
const timeOrigin = await page.evaluate(() => performance.timeOrigin);

await page.waitForFunction(
  (n) => new Set(window.__audioLog.map((e) => e.src)).size >= n,
  STEPS,
  { timeout: 300_000, polling: 500 }
);
console.log(`last step narrating — letting it finish (${Math.ceil(lastDuration)}s)…`);
await page.waitForTimeout((lastDuration + 2.5) * 1000);

const audioLog = await page.evaluate(() => window.__audioLog);
await cdp.send('Page.stopScreencast').catch(() => undefined);
const endEpochS = Date.now() / 1000;
await page.close();
await browser.close();

if (frameMeta.length < 10) throw new Error(`only ${frameMeta.length} frames captured`);
console.log(`${frameMeta.length} lossless frames captured`);

// Audio offsets relative to the first frame, in ms.
const videoStartS = frameMeta[0].ts;
const offsets = [];
for (let n = 1; n <= STEPS; n++) {
  const hit = audioLog.find((e) => e.src.endsWith(`/tour/step-${n}.mp3`));
  if (!hit) throw new Error(`no play event for step ${n}`);
  const epochS = (timeOrigin + hit.t) / 1000;
  offsets.push(Math.max(0, Math.round((epochS - videoStartS) * 1000)));
}
console.log('step offsets (ms):', offsets.join(', '));

// Concat demuxer with real per-frame durations; last frame holds to the end.
const lines = ["ffconcat version 1.0"];
for (let i = 0; i < frameMeta.length; i++) {
  const dur =
    i < frameMeta.length - 1
      ? frameMeta[i + 1].ts - frameMeta[i].ts
      : Math.max(0.04, endEpochS - frameMeta[i].ts);
  lines.push(`file '${frameMeta[i].file}'`);
  lines.push(`duration ${dur.toFixed(4)}`);
}
lines.push(`file '${frameMeta.at(-1).file}'`); // concat quirk: repeat last file
const listFile = path.join(FRAMES_DIR, 'list.txt');
fs.writeFileSync(listFile, lines.join('\n'));

console.log('encoding + muxing…');
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
    '-y',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    ...inputs,
    '-filter_complex', `${delays.join(';')};${mixIn}amix=inputs=${STEPS}:normalize=0[aout]`,
    '-map', '0:v', '-map', '[aout]',
    '-fps_mode', 'cfr', '-r', '30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest',
    MP4,
  ],
  { stdio: 'pipe' }
);
fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
console.log(`wrote ${MP4} (${Math.round(fs.statSync(MP4).size / 1024 / 1024)}MB)`);
execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'csv', MP4], { stdio: 'inherit' });
