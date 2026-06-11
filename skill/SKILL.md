---
name: walkabout
description: Add a Walkabout to an app — a guided voice tour that walks the real pages with a narration-synced moving spotlight, an ask-the-app AI guide that logs every question, and one-command narrated demo videos. Use when adding onboarding tours, in-app help, or demo/training videos to any app.
---

# Walkabout — the app demos itself

You're giving an app three connected capabilities, built in this order:

1. **The tour** — a floating guide card walks the REAL app page by page with
   ElevenLabs narration; the spotlight scrolls to each section as the voice
   reaches it; auto-advance makes it hands-free. No library — the bundled
   `Tour.tsx` is the whole thing.
2. **The Guide (ask-the-app AI)** — a corner button hosting the tour AND a
   question box answered by an LLM grounded in a hand-written app guide.
   Every question is logged: the log IS the product roadmap.
3. **Demo videos** — headless recorders that turn the tour (or any scripted
   click-path) into narrated MP4s. Three content tiers from one engine:
   quick highlights (socials), promo tour (2–3 min), training demos
   (30–60s per feature, with real typing/clicking on narration cue).

The goal: the owner never gives a demo again. The app onboards, explains,
and records itself.

All templates in `templates/` are FieldProof's REAL working files — worked
examples, not scaffolds. Read them, transplant them, adapt names/paths/
styling to the host app. The deep reference (design rationale, full gotcha
list, adopter notes) is `docs/pattern.md` in the Walkabout repo
(github.com/jezweb/walkabout) — update it when you learn something new, and
add the app to its Adopters list.

## Phase 1 — the tour

Copy `Tour.tsx`, `steps.ts`, `halo.css` (append to the app's global CSS;
swap the two colour vars to the app's tokens). Then:

**Restyle for the host first — the templates carry the source app's classes.**
`Tour.tsx` and `Assist.tsx` use `brand-card`, `font-display`, `primary-dark`,
`bg-surface`, `text-warning`. On a shadcn host (the common case) map them once:
`brand-card` → `rounded-lg border bg-card`, `font-display` → drop, `primary-dark`
→ `primary`, `text-white` → `text-primary-foreground`, `bg-surface` →
`bg-background`, `text-warning` → `text-amber-600 dark:text-amber-400`.
`halo.css`'s `outline: var(--token)` works even when the token is a full `hsl()`
value (shadcn) — no `color-mix` needed.

- Write 5–8 steps, one per page. Card `body` = 2 lines. Narration = 2–5
  `(selector, text)` segments per step in `gen-tour-audio.py`'s SCRIPTS dict
  — each segment describes ONE page section, top to bottom, like you're
  showing a mate. End the last step with "that's the tour".
- Add a `data-tour="…"` attribute to every element a segment describes.
- Run the generator (`ELEVENLABS_API_KEY` env var; voice Charlie
  `IKne3meq5aSn9XLyUdCD` is a warm Australian male; `eleven_turbo_v2_5` for
  drafts, a richer model for final renders). It writes `public/tour/*.mp3`
  AND `tour/cues.gen.ts` — commit both.
- Wire `useTour()` into the app shell; offer once on first sign-in
  (localStorage), restartable from a footer/menu, `?tour=N` deep links.

**Verification is wandering, not watching**: start the tour, then click
around mid-step. The guide must pause itself when you leave the step's page
("Paused while you explore"), resume where it left off, and NEVER replay
audio or yank you back when you click things. Run it on the page with the
highest z-index content (maps!) — the card is `z-[1100]` for a reason.

Traps that WILL bite if you deviate from the template (full list in the
knowledge doc):

- The narrate effect's deps are `[i]` ONLY. Adding `navigate` (identity
  changes per location) replays audio on every click — or hard-HANGS on
  self-redirecting index routes.
- Autoplay needs a gesture: the Start click is it. Deep-linked starts have
  none — catch the blocked `play()` and open paused.
- `arrivedRef` is what stops the wander-detector from pausing the tour
  during its own step navigation. Don't simplify it away.

## Phase 2 — the Guide (ask-the-app AI)

Copy `Assist.tsx`, `assist-routes.ts`, `assist-knowledge.ts`, `questions.sql`.

- **Rewrite `knowledge.ts` entirely** — it's the assistant's ONLY truth
  source. Plain prose: what the app is, every page, every flow, limits, who
  to contact. Facts from the code, never imagination (no invented pricing,
  stats, contacts). Leave a header comment: *update this file in the same
  commit as any feature change* — and add that rule to the app's CLAUDE.md.
- System prompt shape: answer only from the guide; defer to the human
  contact for anything else; plain text, under ~120 words. Use a cheap fast
  model with **thinking OFF** (reasoning models burn the budget and return
  null content on structured tasks).
- Log EVERY question (asker, page path, latency, answer/error) and surface
  the log on a page linked from the widget. Never skip the logging — the
  questions are the roadmap.
- The FAB hides while the tour or its offer occupies the corner: one corner,
  one entry point.

Verify live with three questions: one the guide covers (expect a grounded,
specific answer), one it doesn't — pricing works well — (expect a plain
"the guide doesn't cover this" + contact, NOT an invention), and one from a
specific page (the page path is sent as context).

## Phase 3 — demo videos

Copy `record-tour.mjs` and `record-demo.mjs` into the app's scripts dir.
Needs: `playwright` devDependency, `ffmpeg`/`ffprobe` on PATH, seeded data
that looks good on camera, and a headless-friendly sign-in.

**Headless auth is the real blocker, not a one-liner — solve it first.** The
templates' `localStorage.setItem('<app>:api_key', …)` bootstrap ONLY works for
API-key auth. Cookie/OAuth apps (better-auth and most modern stacks) can't do
that — and you do NOT add an API-key feature just to record. Two real options:
- **Playwright `storageState` (default, any auth, zero app change):** sign in
  once by hand, `await context.storageState({ path: 'auth-state.json' })`,
  gitignore that file (it holds a live session cookie), then the recorder uses
  `newContext({ storageState: 'auth-state.json' })` and skips sign-in entirely.
  Re-capture when the session TTL lapses.
- **An existing test-auth / dev-login endpoint:** if the app already mints a
  session behind a secret (common in starter kits), drive that headlessly.
  Fully automated — but never reassign real data to a test user if its cleanup
  cascades; read-only / shared views are safe.

Also set `STEPS` in `record-tour.mjs` to the app's step count (it's hardcoded).

- `record-tour.mjs` — records the tour headless and muxes the ORIGINAL MP3s
  at offsets measured by patching `Audio.play` in-page. Do NOT attempt
  getDisplayMedia tab-capture instead: it needs a human picking the tab and
  fails in flag combinations — the mux approach is hands-free and cleaner.
- `record-demo.mjs` — feature demos: segments of `{ say, do?, delayMs? }`.
  Narration cached by text-hash (iterating on actions is free); each
  action fires at its narration offset — the voice says "type the
  address…" while the harness types. Write actions with ROLE-BASED
  locators (`getByRole('button', { name: … })`, not CSS) — the demo then
  only renders when the markup carries real roles and names, making every
  demo an accessibility regression test for free. Other viewports are one line
  (390×844 → 9:16 Shorts). The same specs yield GIF slices and
  reproducible screenshots for written guides.

Verify by inspection, not by exit code: extract frames at known offsets
(`ffmpeg -ss N -frames:v 1`) and LOOK at them — right page, spotlight/action
visible; `volumedetect` a narration window to confirm audio landed. Then
ship the promo MP4 in the app's static assets with a `<video controls>`
player on its how-it-works page.

## When you're done

- Add the app to the Adopters list in `docs/pattern.md`, with anything new
  you learned (gotchas earned there compound across every future adopter).
- Tell the owner the one-command re-record story: app changed → re-run the
  script → fresh video. Stale demos are now a choice.
