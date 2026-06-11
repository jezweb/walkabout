#!/usr/bin/env python3
"""Generate tour narration MP3s + spotlight cue timings via ElevenLabs.

Each step's script is a list of (selector, text) SEGMENTS. The segments are
joined into one narration take, generated through the /with-timestamps
endpoint (character-level alignment), and each segment's start second is
computed from the alignment — so the on-page spotlight moves to the matching
element exactly as the voice reaches it. No hand-timing, survives any
re-record.

Outputs:
  public/tour/step-N.mp3            — the narration
  src/client/tour/cues.gen.ts      — { 'step-N': [{selector, at}, ...] }

Voice: Charlie (IKne3meq5aSn9XLyUdCD) — ElevenLabs' Australian male,
conversational. Re-run after editing scripts; files are overwritten.
"""
import base64
import json
import os
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
KEY = os.environ['ELEVENLABS_API_KEY']  # https://elevenlabs.io → profile → API key
VOICE = 'IKne3meq5aSn9XLyUdCD'  # Charlie — Australian, conversational
OUT = ROOT / 'public/tour'
OUT.mkdir(parents=True, exist_ok=True)
CUES_TS = ROOT / 'src/client/tour/cues.gen.ts'

# (selector | None, text) — selector None narrates without moving the spotlight.
SCRIPTS: dict[str, list[tuple[str | None, str]]] = {
    'step-1': [
        ('[data-tour="progress"]',
         "Welcome to FieldProof! This is Operations — the page you'll live on. "
         "The big counter shows exactly how far through the program you are, "
         "measured against the client's own property list."),
        ('[data-tour="status-breakdown"]',
         "Down here, the status breakdown — what happened at every property, "
         "button by button."),
        ('[data-tour="ai-verification"]',
         "Next to it, what the AI approved automatically, and anything still "
         "waiting for a human decision."),
        ('[data-tour="missed"]',
         "The missed-properties list shows which suburbs still need attention."),
        ('[data-tour="leaderboard"]',
         "And at the bottom, the operator leaderboard — volume and quality, "
         "side by side."),
    ],
    'step-2': [
        ('[data-tour="visits-table"]',
         "This is the visit record. Every time an operator captures a property "
         "in the field, it appears here within seconds — with the photo, the "
         "GPS check, and the AI's verdict."),
        ('[data-tour="visit-filters"]',
         "The filters up top get you to what matters, and the priority box "
         "collects anything that needs human eyes."),
        ('[data-tour="visits-table"]',
         "Click any row to see the photo and the AI's reasoning side by side."),
    ],
    'step-3': [
        ('[data-tour="plan-run"]',
         "Runs are how you plan the day. Pick a program, a date, and a slice "
         "of properties — say, one suburb."),
        ('[data-tour="run-operators"]',
         "Then tick the operators working it. Crews working in pairs? Tick "
         "both, and each phone gets the run."),
        ('[data-tour="runs-list"]',
         "As they capture, the progress bars down here burn down live, so you "
         "always know where the day is at."),
    ],
    'step-4': [
        (None,
         "The coverage map shows every visit exactly where it happened. Green "
         "pins are completed deliveries, red are exceptions like construction "
         "sites or vacant land, and amber means the AI flagged it for review. "
         "Cold spots on the map show you instantly what's been missed."),
    ],
    'step-5': [
        ('[data-tour="import"]',
         "Properties is the registry — the source of truth. Import the "
         "client's spreadsheet exactly as they send it; columns map "
         "automatically. From here you can also print QR label sheets, or pop "
         "a code up on screen for testing."),
        ('[data-tour="lookup"]',
         "And down here — when a resident rings asking about their delivery, "
         "type their address and the whole visit history appears, photos "
         "included."),
    ],
    'step-6': [
        ('[data-tour="add-operator"]',
         "Staff is where you manage the field team. Add an operator and they "
         "get a sign-in code — no passwords, no email setup. The code shows "
         "once, so hand it over straight away."),
        ('[data-tour="staff-list"]',
         "If a phone goes missing, deactivate here and they're locked out "
         "instantly. Lost code? Regenerate kills the old one on the spot."),
    ],
    'step-7': [
        (None,
         "And finally — How it works, the whole story with real screenshots, "
         "including the phone app your operators use in the field. They sign "
         "in at fieldproof dot au slash field with their code. That's the "
         "tour! Have a click around — everything you're seeing is safe demo "
         "data."),
    ],
}


def segment_starts(alignment: dict, full_text: str, offsets: list[int]) -> list[float]:
    """Start second for each segment, from character-level alignment.

    The alignment's characters normally mirror the input text 1:1; if the API
    normalised differently, fall back to a proportional estimate over the
    total duration — close enough for a spotlight.
    """
    chars = alignment['characters']
    starts = alignment['character_start_times_seconds']
    if len(chars) == len(full_text):
        return [starts[min(o, len(starts) - 1)] for o in offsets]
    total = alignment['character_end_times_seconds'][-1]
    return [total * o / len(full_text) for o in offsets]


cues: dict[str, list[dict]] = {}
for name, segments in SCRIPTS.items():
    texts = [t for _, t in segments]
    full_text = ' '.join(texts)
    # Character offset where each segment begins in the joined text.
    offsets, pos = [], 0
    for t in texts:
        offsets.append(pos)
        pos += len(t) + 1  # the joining space

    body = json.dumps({
        'text': full_text,
        'model_id': 'eleven_turbo_v2_5',
        'voice_settings': {'stability': 0.5, 'similarity_boost': 0.75, 'style': 0.3},
    }).encode()
    req = urllib.request.Request(
        f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_64',
        data=body,
        headers={'xi-api-key': KEY, 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())

    audio = base64.b64decode(payload['audio_base64'])
    (OUT / f'{name}.mp3').write_bytes(audio)

    starts = segment_starts(payload['alignment'], full_text, offsets)
    cues[name] = [
        {'selector': sel, 'at': round(at, 2)}
        for (sel, _), at in zip(segments, starts)
        if sel is not None
    ]
    print(f'{name}.mp3 {len(audio)//1024}KB  cues: {[(c["selector"], c["at"]) for c in cues[name]]}')

CUES_TS.write_text(
    '// GENERATED by scripts/gen-tour-audio.py — do not edit by hand.\n'
    '// Spotlight cue timings: each entry moves the halo to `selector` when the\n'
    '// step narration reaches `at` seconds. Regenerate whenever scripts change.\n'
    'export interface TourCue {\n  selector: string;\n  at: number;\n}\n\n'
    'export const TOUR_CUES: Record<string, TourCue[]> = '
    + json.dumps(cues, indent=2)
    + ';\n'
)
print(f'wrote {CUES_TS.relative_to(ROOT)}')
