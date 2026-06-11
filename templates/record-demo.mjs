#!/usr/bin/env node
/**
 * Record a narrated FEATURE DEMO video — the harness performs real actions
 * (typing, filtering, clicking) on cue with the narration. Fully headless.
 *
 * This is the engine for the demo tiers beyond the overview tour:
 *   - training clips ("here's how filtering works", 30-60s each)
 *   - quick highlight cuts for socials / home pages
 *
 * Each demo = ordered segments of { say, do?, delayMs? }. The narration is
 * generated ONCE via ElevenLabs /with-timestamps (cached by text hash), so
 * we know the exact second each segment starts — actions fire on those
 * offsets while Playwright records, then ffmpeg muxes the MP3 on at the
 * measured position. Same trick as record-tour.mjs, minus the in-page tour.
 *
 * Usage:
 *   node scripts/record-demo.mjs [demo-name]      record (default: all)
 *   node scripts/record-demo.mjs --check [name]   run actions only — no
 *     narration, no video, fail loudly. The demo suite as a smoke test:
 *     every action uses role-based locators, so this also catches
 *     accessibility regressions (missing roles/names) and dead journeys.
 * Output: media/demo-<name>.mp4
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT_DIR = path.join(ROOT, 'media');
const CACHE_DIR = path.join(OUT_DIR, 'demo-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
// ADAPT: your app's headless sign-in (this example: an API key into localStorage).
const API_KEY = process.env.APP_API_KEY ?? '';
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY; // https://elevenlabs.io
const VOICE = 'IKne3meq5aSn9XLyUdCD'; // Charlie — Australian, conversational

// ---------------------------------------------------------------------------
// Demo definitions. say = narration; do = action fired when that line starts
// (optional delayMs shifts the action later into the line).
// ---------------------------------------------------------------------------
const DEMOS = {
  'find-and-filter': {
    start: '/visits',
    segments: [
      {
        say: 'Finding things in FieldProof is quick. This is the visit record — every capture from the field, the moment it syncs.',
      },
      {
        say: 'Say you only want what the AI flagged for review. One filter, and the list narrows.',
        delayMs: 1800,
        do: (page) =>
          page.getByRole('combobox', { name: 'Filter by AI verdict' }).selectOption('review'),
      },
      {
        say: 'Tick priority only, and it is just the exceptions that block the job.',
        delayMs: 1200,
        do: (page) => page.getByRole('checkbox', { name: 'Priority only' }).check(),
      },
      {
        say: 'Now the other direction. A resident calls, asking about their delivery — head to Properties.',
        delayMs: 1500,
        do: (page) => page.getByRole('link', { name: 'Properties' }).click(),
      },
      {
        say: 'Type any part of their address…',
        do: async (page) => {
          const input = page.locator('[data-tour="lookup"] input');
          await input.scrollIntoViewIfNeeded();
          await input.click();
          await input.pressSequentially('Lurline', { delay: 140 });
        },
      },
      {
        say: '…search, and the whole visit history for that property is right there — photos included.',
        delayMs: 600,
        do: (page) => page.getByRole('button', { name: 'Search' }).click(),
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Narration: generate once per text-hash via /with-timestamps, cache mp3+cues.
// ---------------------------------------------------------------------------
async function narrationFor(name, segments) {
  const texts = segments.map((s) => s.say);
  const fullText = texts.join(' ');
  const hash = crypto.createHash('sha256').update(fullText).digest('hex').slice(0, 12);
  const mp3Path = path.join(CACHE_DIR, `${name}.mp3`);
  const cuesPath = path.join(CACHE_DIR, `${name}.cues.json`);
  if (fs.existsSync(cuesPath)) {
    const cached = JSON.parse(fs.readFileSync(cuesPath, 'utf8'));
    if (cached.hash === hash && fs.existsSync(mp3Path)) return { mp3Path, ...cached };
  }
  console.log(`  generating narration (${fullText.length} chars)…`);
  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: fullText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${await resp.text()}`);
  const payload = await resp.json();
  fs.writeFileSync(mp3Path, Buffer.from(payload.audio_base64, 'base64'));

  const align = payload.alignment;
  const starts = align.character_start_times_seconds;
  const durationS = align.character_end_times_seconds.at(-1);
  // Char offset of each segment in the joined text → its start second.
  const offsets = [];
  let pos = 0;
  for (const t of texts) {
    offsets.push(
      align.characters.length === fullText.length
        ? starts[Math.min(pos, starts.length - 1)]
        : (durationS * pos) / fullText.length
    );
    pos += t.length + 1;
  }
  const cues = { hash, offsets, durationS };
  fs.writeFileSync(cuesPath, JSON.stringify(cues, null, 2));
  return { mp3Path, ...cues };
}

// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordDemo(browser, name, demo) {
  console.log(`recording ${name}…`);
  const narration = await narrationFor(name, demo.segments);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });
  const setup = await context.newPage();
  await setup.goto('https://fieldproof.au/operations');
  await setup.evaluate(
    ([key]) => {
      localStorage.setItem('app:api_key', key);
      localStorage.setItem('app:tour', 'done');
    },
    [API_KEY]
  );
  const junk = setup.video();
  await setup.close();

  const page = await context.newPage();
  const videoStart = Date.now(); // ≈ first video frame
  await page.goto(`https://fieldproof.au${demo.start}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(800); // let the page settle before the voice starts

  const audioStartMs = Date.now() - videoStart; // where the MP3 lands in the video
  for (let k = 0; k < demo.segments.length; k++) {
    const seg = demo.segments[k];
    const fireAt = audioStartMs + narration.offsets[k] * 1000 + (seg.delayMs ?? 0);
    const wait = videoStart + fireAt - Date.now();
    if (wait > 0) await sleep(wait);
    if (seg.do) {
      try {
        await seg.do(page);
      } catch (err) {
        console.warn(`  segment ${k + 1} action failed: ${String(err).slice(0, 120)}`);
      }
    }
  }
  // Let the narration finish + a breath.
  const endAt = videoStart + audioStartMs + narration.durationS * 1000 + 2000;
  const tail = endAt - Date.now();
  if (tail > 0) await sleep(tail);

  const video = page.video();
  await page.close();
  const webm = await video.path();
  await context.close();
  if (junk) fs.rmSync(await junk.path(), { force: true });

  const out = path.join(OUT_DIR, `demo-${name}.mp4`);
  execFileSync(
    'ffmpeg',
    [
      '-y', '-i', webm, '-i', narration.mp3Path,
      '-filter_complex', `[1:a]adelay=${audioStartMs}|${audioStartMs}[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '128k', '-shortest',
      out,
    ],
    { stdio: 'pipe' }
  );
  fs.rmSync(webm, { force: true });
  console.log(`  wrote ${out} (${Math.round(fs.statSync(out).size / 1024 / 1024)}MB)`);
}

// --check: actions only, fast, throw on any failure (the demo suite as a
// smoke + a11y regression test — recording mode tolerates a missed action
// to save the take; check mode must not).
async function checkDemo(browser, name, demo) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('https://fieldproof.au/operations');
  await page.evaluate(
    ([key]) => {
      localStorage.setItem('app:api_key', key);
      localStorage.setItem('app:tour', 'done');
    },
    [API_KEY]
  );
  await page.goto(`https://fieldproof.au${demo.start}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const failures = [];
  for (let k = 0; k < demo.segments.length; k++) {
    const seg = demo.segments[k];
    if (!seg.do) continue;
    try {
      await seg.do(page);
      await sleep(300);
    } catch (err) {
      failures.push(`segment ${k + 1} ("${seg.say.slice(0, 50)}…"): ${String(err).slice(0, 200)}`);
    }
  }
  await context.close();
  if (failures.length) {
    console.error(`✗ ${name}\n  ${failures.join('\n  ')}`);
    return false;
  }
  console.log(`✓ ${name} — all ${demo.segments.length} segments actionable`);
  return true;
}

const args = process.argv.slice(2);
const checkMode = args.includes('--check');
const pick = args.find((a) => !a.startsWith('--'));
const names = pick ? [pick] : Object.keys(DEMOS);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let ok = true;
for (const name of names) {
  if (!DEMOS[name]) throw new Error(`unknown demo: ${name}`);
  if (checkMode) ok = (await checkDemo(browser, name, DEMOS[name])) && ok;
  else await recordDemo(browser, name, DEMOS[name]);
}
await browser.close();
if (!ok) process.exit(1);
