# Guided voice tour — the pattern (from FieldProof, 2026-06-11)

A first-time-user tour that walks the REAL app page by page with a floating
guide card and ElevenLabs voice narration. No library. Born on FieldProof;
designed to be dropped into any app. Jez: "instead of me doing demos" — the
app carries its own demo, narrated consistently, never distracted.

> This doc is the deep reference behind **Walkabout** — design rationale and
> every gotcha earned in production. The working files live in this repo's
> `templates/`; the Claude Code skill is `skill/SKILL.md`.

## Canonical source + prerequisites (cold-start)

The working files are in this repo's `templates/` (lifted from FieldProof,
the first production deployment). Map:

| What | File |
|---|---|
| Tour component (full: spotlight cues, auto-advance, pause-on-wander, keyboard, deep links) | `templates/Tour.tsx` |
| Steps config + localStorage helpers | `templates/steps.ts` (+ generated `cues.gen.ts`) |
| Halo CSS (3 rules: `.tour-spotlight`, `tour-pulse` keyframes, reduced-motion guard) | `templates/halo.css` |
| Audio + cue generator | `templates/gen-tour-audio.py` |
| Tour → video recorder | `templates/record-tour.mjs` |
| Feature-demo recorder (timed actions) | `templates/record-demo.mjs` |
| Ask-the-app: guide content, ask/log routes, widget | `templates/assist-knowledge.ts`, `templates/assist-routes.ts`, `templates/Assist.tsx`, `templates/questions.sql` |

Prerequisites a fresh session must know:

- **ElevenLabs key**: `ELEVENLABS_API_KEY` env var. `eleven_turbo_v2_5`
  for drafts; a richer model (v3 / multilingual v2) for final renders.
- **Recorders need**: Node + `playwright` as a devDependency (browsers are
  usually already cached in `~/Library/Caches/ms-playwright`), `ffmpeg` +
  `ffprobe` (homebrew). Recording runs headless — the user sees nothing.
- **The app needs**: seeded demo data that looks good on camera, a headless-
  friendly sign-in (FieldProof: API key into localStorage), and `data-tour`
  attributes on highlighted elements.

If the FieldProof files are unreachable, the component is rebuildable from
this behavioural spec: a fixed bottom-right card (`z-[1100]`) holding step
title/body/dots/Back/Next/pause/mute; one effect keyed on the step index
ONLY that navigates to `step.path`, plays `new Audio(step.audio)`, drives a
spotlight selector from `ontimeupdate` against the cue list, auto-advances
~1.4s after `onended` (never on the last step); a second effect haloing the
active selector with retries; a wander-detector that pauses when
`location.pathname !== step.path` after first arrival. Every trap you'll
hit doing this is in "Hard-won gotchas" below.

## Why this shape works

- **Real pages, not screenshots.** The tour navigates the live app with live
  (demo) data. The user is already *in* the product when the tour ends.
- **Voice over text.** The card holds two lines; the narration holds the
  detail. People listen while their eyes wander the page — that's the demo
  experience.
- **No library.** Tour libraries (Shepherd, Intro.js…) fight your router and
  your styles. ~200 owned lines beat a dependency here.

## The four pieces (copy these from FieldProof)

| Piece | FieldProof file | What it does |
|---|---|---|
| Steps config | `src/client/tour/steps.ts` | `[{ path, title, body, audio, highlight? }]` + localStorage seen/done helpers |
| Tour component | `src/client/components/Tour.tsx` | `useTour()` hook, `<TourOffer>` (first-visit card), `<Tour>` (guide card: navigate → narrate → moving spotlight → auto-advance; dots, Back/Next, pause/play, mute) |
| Audio generator | `scripts/gen-tour-audio.py` | Segmented scripts → ElevenLabs `/with-timestamps` → `public/tour/step-N.mp3` + generated `tour/cues.gen.ts` |
| Shell wiring | `App.tsx` (~10 lines) | `const tour = useTour()` → render offer + tour when authed; footer "Take the tour" → `tour.start` |

Plus ~6 `data-tour="…"` attributes on the elements steps spotlight, and one
CSS class (`.tour-spotlight` halo + pulse keyframes in `index.css`).

## The recipe for a new app

1. Copy `Tour.tsx`, `tour/steps.ts`, the CSS halo block, the generator script.
2. Rewrite the steps: one per page, 5–8 steps max. Card `body` = 2 lines;
   narration = 2–5 **(selector, text) segments** per step, 3–5 conversational
   sentences total (write like you're showing a mate, end the last step with
   "that's the tour"). Each segment describes ONE section of the page, in
   the order they appear top to bottom.
3. Add a `data-tour` attribute to every element a segment describes
   (~2–3 per page).
4. Run the generator (`ELEVENLABS_API_KEY` env var;
   voice **Charlie** `IKne3meq5aSn9XLyUdCD` = warm Australian male,
   `eleven_turbo_v2_5`, `mp3_44100_64` ≈ 150KB/step). It writes the MP3s AND
   `tour/cues.gen.ts` — commit both.
5. Wire `useTour()` into the app shell + a footer/menu "Take the tour".

## The timing model (choose the easy one)

Timing is the part that LOOKS hard and isn't — IF you keep the model simple:
one audio file per step, nothing synchronised below step level.

- **Auto-advance makes it a hands-free demo**: `audio.onended` → ~1.4s breath
  → next step. The user can sit back and watch the whole thing, or grab
  Back/Next at any point. The LAST step never auto-advances — it waits for an
  explicit Finish so the tour doesn't vanish mid-thought.
- **Pause must cancel a pending advance too** (keep the advance timer in a
  ref so the pause handler can clear it). Resume after the narration already
  ended just replays the step — acceptable semantics, no special case.
- **Pause-on-wander**: when the user navigates off the step's page mid-
  narration, the guide pauses itself with a hint ("Paused while you explore —
  play picks up where it left off"); play navigates back and resumes. The
  subtlety: an `arrivedRef` (set true once `location.pathname === step.path`,
  reset per step) distinguishes the tour's OWN navigation from the user's —
  without it the wander-detector pauses the tour on every step transition.
- **Niceties worth the ~20 lines**: ←/→ keyboard stepping + Esc to close
  (skipped while typing in a field); `?tour=N` deep links for support
  ("click this and listen" — starts at step N; a fresh load has no gesture,
  so catch the blocked `play()` and open paused, play one tap away);
  `prefers-reduced-motion` stops the halo pulse.
- **Narration doesn't wait for the page.** Lazy routes/queries render after
  navigation; the spotlight retry loop absorbs that, and scripts open with an
  intro sentence so the page has a second to land. Don't build a "page ready"
  gate — it's complexity the intro sentence already buys you.

## The moving spotlight (segment-level sync — build this, it's cheap)

A static halo on one element while the voice tours the whole page is
decoration. The upgrade that makes it feel magic: **the spotlight scrolls
down the page WITH the narration**, lighting each section as the voice
reaches it. Jez, watching the static version: "I don't think it serves much
purpose if it's just highlighting the first thing on the page." Correct.

The trick is that you never hand-time anything:

1. Write each step's script as ordered **(selector, text) segments** in the
   generator — one segment per page section the voice describes.
2. Generate via ElevenLabs **`/with-timestamps`** (same price, returns
   `alignment.character_start_times_seconds`). The segment's start second =
   the start time of its first character in the joined text. Emit a
   generated `tour/cues.gen.ts`: `{ 'step-1': [{selector, at}, ...] }`.
3. In the Tour, drive the spotlight off **`audio.ontimeupdate`**: the latest
   cue with `at <= currentTime + 0.3` wins (the 0.3s lookahead moves the halo
   just before the voice lands on it). Pausing the audio pauses the spotlight
   for free; re-records regenerate the cues automatically.

Notes: each cue target needs a `data-tour` attribute (FieldProof has ~12
across 5 pages); a step can revisit a selector (visits-table → filters →
visits-table); steps with no cues (a full-page map) just skip the halo.
`setState` with the same selector string is a React no-op, so the 4Hz
timeupdate costs nothing. Use a ~50ms initial attempt + the 400ms retry loop —
later cues hit instantly because the page is already rendered.

True word-level sync (halo pulses on "this button HERE") is possible with the
same alignment data but adds nothing over segment-level — stop here.

## Hard-won gotchas

- **Autoplay**: browsers block audio without a gesture. The offer card's
  "Start" click IS the gesture — narration flows from there. Never autoplay
  on page load.
- **Leaflet (or any high-z lib) eats the card**: the guide card must be
  `z-[1100]`, not `z-50` — Leaflet panes go to 1000 (see
  `rules/leaflet-shadcn-zindex.md`). Found live when "the tour broke" on the
  map step.
- **Spotlight needs retries**: lazy routes + queries render at their own
  pace. Retry `querySelector` ~10× at 400ms before giving up, and remove the
  halo class on cleanup.
- **The narrate effect's deps must be `[i]` ONLY** (the step index). React
  Router's `navigate` changes identity on every location change, so listing
  it (or anything location-derived) as a dep means any click that navigates
  mid-tour re-runs the effect — audio replays and the user gets yanked back
  to the step's page. Found live on FieldProof (clicking a Visits row
  replayed the narration over and over). A step should fire exactly once;
  exploring the page mid-step is a feature.
  - **The nastier face of this: a hard HANG, not just a replay, when a step's
    path is a self-redirecting index route** (`/dashboard/chat` →
    `/dashboard/chat/{uuid}`, "new X" routes that mint a child on mount).
    With `navigate` in the deps, the step's `navigate(indexPath)` and the
    index's own redirect ping-pong each other forever — the page sits on a
    blank spinner and looks like an unrelated app bug, not a tour bug. The
    `[i]`-only deps fix resolves it (the step navigates once, the index
    redirects once, both settle). Found live on HR Helper 2026-06-11; the
    tell is "this one page hangs but a normal sidebar click to it works"
    (the click is a separate event cycle, so it doesn't re-fire).
- **State**: one localStorage key (`<app>:tour` = done|dismissed). Offer once;
  the footer restarts it regardless.
- **Test by wandering, not by watching.** Every tour bug so far (map z-index
  eating the card, the audio-replay-on-click bug) was found by a human
  clicking around the app WHILE the tour ran — never by replaying it
  passively. Dogfood = start the tour, then go do something else mid-step.

## The companion: ask-the-app AI (built on FieldProof 2026-06-11)

The corner button grew into "the Guide": one FAB hosting BOTH the tour and an
"ask a question" panel. Shape (copy from FieldProof):

- `src/server/modules/assist/knowledge.ts` — a plain-prose APP GUIDE string
  (~150 lines): what the app is, every page, every flow, limits, who to
  contact. The assistant's ONLY truth source; updated in the same commit as
  feature changes. System prompt: answer only from the guide, defer to the
  human contact for anything else, plain text, under 120 words.
- `assist/routes.ts` — POST ask (cheap model, **thinking OFF**, ~1s answers,
  rate-limited) + GET questions. EVERY question logged to D1 with asker,
  page path, latency — success or failure.
- `Assist.tsx` — FAB → panel: suggestion chips, thread, input; footer hosts
  "Take the tour" + a link to the question-log page.
- `/questions` page — the log, newest first. The questions users actually
  ask = the roadmap + the next tour script. This is the point.

Verified live: grounded answers cite real thresholds; off-guide questions
(pricing) defer to Jeremy instead of inventing. Gemma 4 26B with
`chat_template_kwargs: { enable_thinking: false }` answers in ~0.5–1s.

## Auto-generated demo VIDEOS (the tour records itself)

Because the tour auto-advances, a narrated walkthrough VIDEO is one command:
`node scripts/record-tour.mjs` → `tour-demo.mp4`. Fully headless — the
user sees nothing, no manual steps, repeat after every release. Jez: "i wont
have to stress about doing the demo walk through videos anymore."

**The approach that works** (copy `record-tour.mjs` from FieldProof):

1. **Playwright `recordVideo`** captures the video — headless, but it has NO
   audio track, so:
2. **The page logs its own audio timing**: `page.addInitScript` patches
   `Audio.prototype.play` to push `{src, t: performance.now()}` to a window
   array before the app loads.
3. **Record in a SECOND page** of the context (do auth/localStorage setup in
   a throwaway first page — localStorage persists per-origin across the
   context). A page's video starts when the page opens, so video t=0 ≈
   `performance.timeOrigin` ≈ the logged `t` values. Open it straight at the
   `?tour=1` deep link.
4. Launch with `--autoplay-policy=no-user-gesture-required` (a deep-linked
   tour has no gesture; without this the blocked `play()` opens the tour
   paused and nothing advances). Wait until all N step srcs appear in the
   log + the last MP3's duration (ffprobe it locally).
5. **ffmpeg muxes the ORIGINAL MP3s** onto the silent video at the logged
   offsets: per-step `adelay=<ms>|<ms>`, then `amix=inputs=N:normalize=0`,
   `-c:v libx264 -c:a aac`. Source-quality narration, sync within ~150ms.

**The approach that DOESN'T work — don't re-derive it**: capturing real
browser audio via `getDisplayMedia` tab-capture. It needs a headed browser
and a HUMAN approving the picker (and they must pick the TAB — a window/
screen pick records silent video on macOS), and
`--auto-select-tab-capture-source-by-title` conflicts with
`--use-fake-ui-for-media-stream` ("Could not start video source"). The mux
approach is hands-free, headless, and the audio is cleaner anyway.

Verify by inspection: extract frames at known step offsets (`ffmpeg -ss N
-frames:v 1`) and check the right page + spotlight is showing; `volumedetect`
a narration window vs a gap to confirm speech landed.

**Same harness, scripted feature demos — BUILT** (`record-demo.mjs` on
FieldProof): a demo = ordered segments of `{ say, do?, delayMs? }` — the
narration is generated once via `/with-timestamps` (cached by text-hash, so
iterating on actions costs no credits) and each segment's action fires at
its measured offset while Playwright records. The voice says "type any part
of their address…" and the harness `pressSequentially`'s into the lookup on
cue. ~30 lines of spec per demo, 34s narrated clip out. Verified by frame
extraction: filter applied, text typed, results shown — all in sync.

**The three content tiers** (Jez's model, 2026-06-11) — one engine, three
script lengths:

| Tier | Length | Audience | Source |
|---|---|---|---|
| Quick highlights | 30–45s | socials, home page | short segment script, punchy lines |
| Promo tour | 2–3 min | first-time users, prospects | the in-app tour, recorded |
| Training demos | 30–60s each | existing users learning a feature | `record-demo.mjs` specs with actions |

**Other viewports / device frames**: viewport is one option —
`{ width: 390, height: 844 }` (+ `isMobile`, `deviceScaleFactor`) records a
mobile-view take, 9:16 for YouTube Shorts. For the "looks like a real
phone" effect, composite a device bezel over the clip with ffmpeg overlay,
or record a wrapper HTML page that renders the app in an iframe inside a
phone-frame graphic.

**Same harness, stills**: pause the action script anywhere and
`page.screenshot()` — sequenced, reproducible screenshots for written
how-to guides come from the same demo specs. One spec → video + GIF slices
+ screenshot sets.

**Distribution** (Jez's riff, 2026-06-11): ship the MP4 in the app's static
assets with a `<video controls>` player at the top of the how-it-works page
(FieldProof: `/tour/tour-demo.mp4`, ~9MB — fine for CF static assets);
slice GIFs per step for embedded how-tos (`ffmpeg -ss <offset> -t <dur>`
against the cue offsets); for Jezweb-owned apps the videos can go public /
YouTube; record at a 9:16 mobile viewport for YouTube Shorts.

## Lineage — what the predecessors taught

Two earlier Jezweb skills attempted narrated demo videos and were retired in
favour of Walkabout (removed from the skills repos 2026-06-11):

- **walkthrough-video** (Remotion): screenshot slideshows with transitions.
  Heavyweight render pipeline for something worse than the real app moving.
- **product-video** (ClawHQ era): real recordings, two-voice narration, and
  hand-placed timestamped audio that needed an overlap-validation phase and
  2–3 AI critique rounds to stay coherent. Its structural flaw is Walkabout's
  founding principle: timings must come FROM the TTS alignment, so sync is
  correct by construction, not validated after.

Worth keeping from product-video: the **AI critique loop** — feed the
rendered video (or extracted frames) to a vision model and iterate until it
scores well. Walkabout's frame-extraction verification is the lightweight
version; for high-stakes final cuts, a critique round is a sensible optional
polish step. Two-voice narration is also possible later (generate two
timestamped tracks, interleave segments — never overlapping).

## Adopters

- **FieldProof** (1st, 2026-06-11) — the full version: segmented cues, moving
  spotlight, auto-advance, pause-on-wander, keyboard, `?tour=N` deep links,
  the ask-the-app companion.
- **HR Helper** (2nd, 2026-06-11) — the lighter variant: one audio file per
  step, single static `highlight` selector, manual Back/Next (no auto-advance
  or moving spotlight yet). shadcn semantic tokens instead of FieldProof's
  brand classes; restart wired via a `TourProvider` context (`useTourControls`)
  since the app has no footer — exposed as a "Take the guided tour" button on
  its How-it-works page. Confirms the four-piece core transplants cleanly; the
  timing/spotlight upgrades are opt-in on top.
- **RightCover** (3rd, 2026-06-11) — the FULL Phase 1 + 2 on a shadcn host:
  segmented cues + moving spotlight + auto-advance + pause-on-wander + `?tour=N`,
  plus the ask-the-app Guide (cheap model thinking-off, grounded answers, a D1
  question log). No footer, so restart fires via a `START_TOUR_EVENT` window
  event from a How-it-works "Take the tour" button and the Guide FAB. Lessons
  folded back into the skill: the styling transplant is ~6 class mappings on a
  shadcn host (worth a table); `halo.css`'s `outline: var(--token)` works on a
  full-`hsl()` token, no `color-mix`; and the deps-`[i]` replay bug bit for real.
  Phase 3 (videos) deliberately deferred — the app is OAuth-only, so headless
  recording needs `storageState` or an existing test-auth endpoint, not the
  localStorage API-key path. That's what surfaced the Phase-3 auth caveat now
  in the skill.

## Where it's going next

- **Vanilla-JS embed for WordPress / any site** (Jez 2026-06-11: "baking
  this into other apps maybe even wp sites"). Nothing in the pattern needs
  React — it's DOM + `<audio>` + a cues JSON. A single `<script>` tag +
  `tour-config.json` + MP3s would run on any site; the ask-agent half needs
  a backend, which could be ONE multi-tenant Cloudflare Worker serving the
  guide for many client sites. Potential Jezweb product: "your site demos
  itself".
- **Answers that can navigate**: teach the ask-agent to return an optional
  action with its answer (`navigate:/runs` or `tour:3`), rendered as a
  "Show me" button. Conversation-driven navigation without an agent
  free-driving the UI — see the design call below.
- **2 apps now — at the "promote this doc to a skill" threshold.** The next
  adopter is the trigger to turn this doc into a skill.

## Design call: guided tour + grounded Q&A, not a free-driving agent

Considered (Jez, FieldProof 2026-06-11): a chattable agent that converses
AND navigates the app itself, like the jezweb.com site agent. The split that
holds: on a **marketing/demo surface** (jezweb.com, client WP sites),
showmanship IS the job — a conversational agent driving the page is the
product demo. In a **working tool**, users want to do, not watch; an agent
animating their UI gets old after the first wow. The work-tool shape is:
tour (watch mode, hands-free) + ask-agent (answers grounded in the app
guide) + "Show me" actions on answers (the agent can take you somewhere,
once, on request — `?tour=N` and `navigate:` are the primitives). That
keeps the wow for the surfaces where wow converts.
