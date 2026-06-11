/**
 * Guided tour steps — the first-time-user walkthrough. Each step navigates
 * to a real page (live demo data beats screenshots) with a short on-screen
 * blurb and a pre-generated ElevenLabs narration (public/tour/step-N.mp3,
 * regenerate with scripts/gen-tour-audio.py after editing).
 *
 * Pattern note: this component + config pair is deliberately portable —
 * copy tour/ + Tour.tsx into any app and rewrite the steps.
 */
export interface TourStep {
  path: string;
  title: string;
  body: string;
  audio: string;
  /** CSS selector to scroll to + halo while this step is showing. */
  highlight?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    path: '/operations',
    title: 'Operations — your live command view',
    body: 'The counter tracks delivery progress against the client’s own property list. Below: status breakdown, what the AI auto-approved, and which suburbs still have missed properties.',
    audio: '/tour/step-1.mp3',
    highlight: '[data-tour="progress"]',
  },
  {
    path: '/visits',
    title: 'Visits — every capture, seconds later',
    body: 'Field captures land here with photo, GPS check and the AI’s verdict. Filter to what matters; click a row for the full evidence.',
    audio: '/tour/step-2.mp3',
    highlight: '[data-tour="visits-table"]',
  },
  {
    path: '/runs',
    title: 'Runs — plan the day',
    body: 'Pick a slice of properties, tick the operators (pairs welcome — each phone gets the run), and watch the bar burn down live.',
    audio: '/tour/step-3.mp3',
    highlight: '[data-tour="plan-run"]',
  },
  {
    path: '/map',
    title: 'Map — coverage at a glance',
    body: 'Every visit pinned where it happened. Green delivered, red exceptions, amber awaiting review — cold spots show what’s missed.',
    audio: '/tour/step-4.mp3',
  },
  {
    path: '/properties',
    title: 'Properties — the registry',
    body: 'Import the client’s CSV as-is, print QR labels, and look up any property’s full visit history when a resident calls.',
    audio: '/tour/step-5.mp3',
    highlight: '[data-tour="import"]',
  },
  {
    path: '/staff',
    title: 'Staff — codes, not passwords',
    body: 'Add an operator, hand over their sign-in code (shown once). Deactivate locks them out instantly; regenerate replaces a lost code.',
    audio: '/tour/step-6.mp3',
    highlight: '[data-tour="add-operator"]',
  },
  {
    path: '/how-it-works',
    title: 'How it works — the whole story',
    body: 'The full walkthrough with screenshots, including the field app your operators use. That’s the tour — everything here is safe demo data.',
    audio: '/tour/step-7.mp3',
  },
];

const STORAGE_KEY = 'app:tour';

export function tourSeen(): boolean {
  return Boolean(localStorage.getItem(STORAGE_KEY));
}

export function markTour(state: 'done' | 'dismissed'): void {
  localStorage.setItem(STORAGE_KEY, state);
}
