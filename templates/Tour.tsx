/**
 * Guided tour — a floating guide card that walks the REAL app page by page,
 * with optional voice narration. No library: ~150 portable lines driven by
 * tour/steps.ts. First sign-in offers it once; the footer can always
 * restart it.
 *
 * Audio: browsers block autoplay, so narration starts from the user's
 * explicit Start (a gesture) and then auto-plays as steps advance. The
 * speaker toggle mutes/unmutes for the rest of the tour.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Compass, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { TOUR_STEPS, markTour, tourSeen } from '../tour/steps';
import { TOUR_CUES, type TourCue } from '../tour/cues.gen';

export function useTour() {
  const [active, setActive] = useState(false);
  const [offer, setOffer] = useState(false);
  const [initialStep, setInitialStep] = useState(0);

  useEffect(() => {
    // Deep link: ?tour=N starts the tour at step N — a support tool ("click
    // this link and listen"). Autoplay will be gesture-blocked on a fresh
    // load; the card opens paused and play() is one tap away.
    const n = Number(new URLSearchParams(window.location.search).get('tour'));
    if (Number.isInteger(n) && n >= 1 && n <= TOUR_STEPS.length) {
      setInitialStep(n - 1);
      setActive(true);
      return;
    }
    if (!tourSeen()) setOffer(true);
  }, []);

  const start = useCallback(() => {
    setOffer(false);
    setInitialStep(0);
    setActive(true);
  }, []);
  const dismissOffer = useCallback(() => {
    markTour('dismissed');
    setOffer(false);
  }, []);
  const finish = useCallback((state: 'done' | 'dismissed') => {
    markTour(state);
    setActive(false);
  }, []);

  return { active, offer, start, dismissOffer, finish, initialStep };
}

export function TourOffer({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-5 right-5 z-[1100] brand-card p-4 max-w-xs shadow-xl">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Compass className="w-5 h-5 text-primary-dark" />
        </span>
        <div>
          <p className="font-bold font-display leading-tight">First time here?</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Take the two-minute guided tour — it walks every page with a quick voice explainer.
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={onStart}
          className="flex-1 rounded-lg bg-primary hover:bg-primary-dark text-white px-3 py-2 text-sm font-semibold font-display"
        >
          Start the tour
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/** Breathing room between a step's narration ending and auto-advancing. */
const AUTO_ADVANCE_DELAY_MS = 1400;

/** Move the spotlight slightly BEFORE the voice reaches its subject. */
const CUE_LOOKAHEAD_S = 0.3;

/** Cue list for a step: generated timings, else the static highlight, else none. */
function cuesForStep(step: (typeof TOUR_STEPS)[number]): TourCue[] {
  const key = step.audio.match(/(step-\d+)\.mp3$/)?.[1];
  const generated = key ? TOUR_CUES[key] : undefined;
  if (generated && generated.length > 0) return generated;
  return step.highlight ? [{ selector: step.highlight, at: 0 }] : [];
}

/**
 * A step's page is "current" when the location is that page OR a child of it.
 * PREFIX-match, not exact: a self-redirecting index route (`/dashboard/chat` →
 * `/dashboard/chat/{uuid}`) would never register "arrived" under exact-match,
 * so the wander guard mis-pauses (and with the wrong effect deps, hard-hangs);
 * drilling into a detail within the same section (a list → one row) should also
 * not count as wandering. Router apps only — a tabbed/desktop host compares a
 * `tab` prop with exact equality instead (see the Zoomtrail adopter note).
 */
function onStepPage(pathname: string, stepPath: string): boolean {
  return pathname === stepPath || pathname.startsWith(stepPath + '/');
}

export function Tour({
  onClose,
  initialStep = 0,
}: {
  onClose: (state: 'done' | 'dismissed') => void;
  initialStep?: number;
}) {
  const [i, setI] = useState(initialStep);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  /** Which element the spotlight is on — driven by the narration's clock. */
  const [activeSelector, setActiveSelector] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True once the router has actually landed on this step's page — needed to
      tell the tour's own navigation apart from the user wandering off. */
  const arrivedRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const step = TOUR_STEPS[i]!;

  // Navigate + narrate ONCE per step change. Deps are [i] only: `navigate`
  // changes identity on every location change, so including it replays the
  // audio (and yanks the user back) whenever they click around mid-tour —
  // exploring the page during a step must not re-trigger the step.
  //
  // Auto-advance: when the narration finishes naturally, move on after a
  // breath — the tour demos itself hands-free. Pause stops the audio, so
  // `onended` never fires and the tour holds. The last step always waits
  // for an explicit Finish.
  useEffect(() => {
    arrivedRef.current = false;
    navigate(step.path);
    const cues = cuesForStep(step);
    const audio = new Audio(step.audio);
    audioRef.current = audio;
    audio.muted = muted;
    audio.onended = () => {
      advanceTimerRef.current = setTimeout(() => {
        setI((cur) => (cur < TOUR_STEPS.length - 1 ? cur + 1 : cur));
      }, AUTO_ADVANCE_DELAY_MS);
    };
    // The spotlight follows the narration's own clock: the latest cue at or
    // before currentTime wins. Pausing pauses the spotlight for free, and if
    // playback is blocked entirely we still light the first cue.
    audio.ontimeupdate = () => {
      const t = audio.currentTime + CUE_LOOKAHEAD_S;
      let sel: string | null = null;
      for (const c of cues) if (c.at <= t) sel = c.selector;
      if (sel) setActiveSelector(sel); // setState same-value is a no-op render
    };
    setPaused(false);
    setActiveSelector(cues[0]?.selector ?? null);
    // If the browser blocks autoplay (e.g. a ?tour=N deep link with no
    // gesture yet), show the card paused — play is one tap away.
    void audio.play().catch(() => setPaused(true));
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
      audio.onended = null;
      audio.ontimeupdate = null;
      audio.pause();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the step index may re-trigger
  }, [i]);

  // Spotlight: scroll to + halo whichever element the narration is currently
  // describing (retry briefly — lazy pages and queries land at their own
  // pace; later cues hit instantly because the page is already rendered).
  useEffect(() => {
    if (!activeSelector) return;
    let cancelled = false;
    let lit: Element | null = null;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      const el = document.querySelector(activeSelector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('tour-spotlight');
        lit = el;
      } else if (tries++ < 10) {
        setTimeout(attempt, 400);
      }
    };
    const t = setTimeout(attempt, 50); // near-instant; the retry loop covers slow pages
    return () => {
      cancelled = true;
      clearTimeout(t);
      lit?.classList.remove('tour-spotlight');
    };
  }, [activeSelector]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  // Pause-on-wander: the user clicking away mid-step is welcome — but the
  // guide shouldn't keep talking about a page they've left. Once we've
  // ARRIVED on the step's page (arrivedRef — the tour's own navigation must
  // not look like wandering), any other path holds the tour; play resumes
  // where it left off, back on the step's page.
  useEffect(() => {
    if (onStepPage(location.pathname, step.path)) {
      arrivedRef.current = true;
      return;
    }
    if (!arrivedRef.current || paused) return;
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    audioRef.current?.pause();
    setPaused(true);
    // `i` must be a dep: consecutive steps can share a path/tab, and without
    // it this effect never re-runs to re-mark arrival after the narrate
    // effect reset arrivedRef — wander pause is silently dead for the second
    // step (found on Zoomtrail, steps 4+5 both on the Library tab).
  }, [i, location.pathname, step.path, paused]);

  const wandered = !onStepPage(location.pathname, step.path);
  const last = i === TOUR_STEPS.length - 1;

  const resume = useCallback(() => {
    if (wandered) navigate(step.path);
    const audio = audioRef.current;
    if (audio) void audio.play().catch(() => undefined);
    setPaused(false);
  }, [wandered, navigate, step.path]);

  // Keyboard: ←/→ step, Esc closes. Skipped while typing in a field.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.key === 'ArrowRight') setI((cur) => Math.min(cur + 1, TOUR_STEPS.length - 1));
      else if (ev.key === 'ArrowLeft') setI((cur) => Math.max(cur - 1, 0));
      else if (ev.key === 'Escape') onClose('dismissed');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed bottom-5 right-5 z-[1100] brand-card p-4 w-[330px] max-w-[calc(100vw-2.5rem)] shadow-xl border-t-4 !border-t-primary">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-display font-semibold uppercase tracking-widest text-primary-dark">
          Tour · {i + 1} of {TOUR_STEPS.length}
        </p>
        <div className="flex items-center gap-1 -mt-1 -mr-1">
          <button
            type="button"
            onClick={() => {
              if (paused) {
                resume(); // brings the user back to the step's page if they wandered
              } else {
                // Hold here: stop narration AND cancel any pending advance.
                if (advanceTimerRef.current) {
                  clearTimeout(advanceTimerRef.current);
                  advanceTimerRef.current = null;
                }
                audioRef.current?.pause();
                setPaused(true);
              }
            }}
            aria-label={paused ? 'Resume the tour' : 'Pause the tour'}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted"
          >
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute narration' : 'Mute narration'}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => onClose('dismissed')}
            aria-label="Close tour"
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <h3 className="font-bold font-display mt-1">{step.title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{step.body}</p>
      {paused && (
        <p className="text-xs text-primary-dark mt-2 flex items-center gap-1.5">
          <Play className="w-3 h-3 shrink-0" />
          {wandered
            ? 'Paused while you explore — play picks up where it left off.'
            : 'Paused — play to continue.'}
        </p>
      )}
      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-1">
          {TOUR_STEPS.map((s, d) => (
            <span
              key={s.path}
              className={`w-1.5 h-1.5 rounded-full ${d === i ? 'bg-primary' : 'bg-border'}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          {i > 0 && (
            <button
              type="button"
              onClick={() => setI(i - 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-muted"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? onClose('done') : setI(i + 1))}
            className="inline-flex items-center gap-1 rounded-lg bg-primary hover:bg-primary-dark text-white px-3 py-1.5 text-sm font-semibold font-display"
          >
            {last ? 'Finish' : 'Next'} {!last && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
