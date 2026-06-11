# Walkabout

**Your app demos itself.**

Walkabout is a pattern (not a library) for giving any web app three connected
capabilities:

1. **A guided voice tour** — a floating guide card walks the *real* app page
   by page with AI voice narration. The spotlight scrolls to each section as
   the voice reaches it, auto-advance makes it hands-free, and the user can
   wander off mid-step (the guide politely pauses and waits). ~250 owned
   lines of React; no tour library.
2. **An ask-the-app AI guide** — the same corner button hosts a question box
   answered by an LLM grounded in a hand-written app guide. Every question
   is logged: *what users ask is your roadmap.*
3. **One-command demo videos** — headless recorders turn the tour (or any
   scripted click-path) into narrated MP4s. Change the app, re-run the
   script, get a fresh video. Stale demos become a choice.

Born on [FieldProof](https://fieldproof.au) (Jezweb, 2026) because the
founder didn't want to give demos anymore. Now the app gives them.

## Why no tour library?

Tour libraries fight your router and your styles, and none of them do the
thing that matters: **voice synced to a moving spotlight**. The trick that
makes Walkabout work is that nothing is hand-timed — narration is generated
through ElevenLabs' `with-timestamps` endpoint, so the exact second each
sentence starts is known. The spotlight moves on the audio's own clock
(`ontimeupdate`), demo-video actions fire at narration offsets, and
re-recording the voice regenerates every timing. **Sync is correct by
construction, not by validation.**

## What's in this repo

| Path | What |
|---|---|
| `templates/Tour.tsx` | The tour component: navigate → narrate → moving spotlight → auto-advance, pause-on-wander, keyboard, `?tour=N` deep links |
| `templates/steps.ts` | Steps config + localStorage helpers |
| `templates/halo.css` | The spotlight halo (3 rules, incl. reduced-motion) |
| `templates/gen-tour-audio.py` | Segmented scripts → ElevenLabs `with-timestamps` → MP3s + generated cue timings |
| `templates/record-tour.mjs` | Tour → narrated MP4, fully headless (Playwright video + ffmpeg muxes the source MP3s at measured offsets) |
| `templates/record-demo.mjs` | Scripted feature demos: `{say, do}` segments — the harness types/clicks on narration cue |
| `templates/Assist.tsx` + `assist-routes.ts` + `assist-knowledge.ts` + `questions.sql` | The ask-the-app guide: widget, endpoint, app-guide content, question log schema |
| `skill/SKILL.md` | A [Claude Code](https://claude.com/claude-code) skill that walks an AI agent through adopting the whole pattern |
| `docs/pattern.md` | The deep reference: design rationale and every gotcha earned in production |

The templates are **real production files**, not scaffolds — copy them into
your app and adapt names, styling, and the auth bootstrap. The gotchas in
`docs/pattern.md` are the hard-won part: the React effect-dependency trap
that replays audio on every click, the z-index war with Leaflet, why
`getDisplayMedia` tab-capture is the wrong way to record, and a dozen more.

## Prerequisites

- An [ElevenLabs](https://elevenlabs.io) API key (`ELEVENLABS_API_KEY`)
- For videos: Node, [Playwright](https://playwright.dev), `ffmpeg`/`ffprobe`
- Seeded demo data that looks good on camera

## The three content tiers

One engine, three script lengths:

| Tier | Length | Audience |
|---|---|---|
| Quick highlights | 30–45s | socials, home page |
| Promo tour | 2–3 min | first-time users, prospects |
| Training demos | 30–60s each | users learning a feature |

## Using with Claude Code

Copy `skill/` into `~/.claude/skills/walkabout/` (with `templates/` beside
it) and ask Claude Code to "add a walkabout to this app". The skill carries
the build order, the verification gates ("test by wandering, not by
watching"), and the traps.

## License

MIT © [Jezweb](https://www.jezweb.com.au)
