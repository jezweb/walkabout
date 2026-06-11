/**
 * The Guide — a floating corner button that hosts BOTH ways to learn the app:
 * ask the AI assistant a question, or take the guided voice tour. One corner,
 * one entry point.
 *
 * Every question goes through /api/assist/ask and is logged server-side —
 * the question log (Questions page) is the roadmap: what users ask is what
 * the next tour script and the next feature should cover.
 *
 * z-[1090/1100]: must clear Leaflet's panes (z up to 1000) on the Map page —
 * see rules/leaflet-shadcn-zindex.md.
 */
import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass, HelpCircle, Send, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api';

interface Exchange {
  question: string;
  answer: string | null; // null while pending
  error?: string;
}

const SUGGESTIONS = [
  'How do operators sign in?',
  'What happens when a photo is flagged?',
  'How do I plan a run for a crew of two?',
  'How does the client get their report?',
];

export function AssistWidget({ onStartTour, hidden }: { onStartTour: () => void; hidden: boolean }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [thread, setThread] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const threadRef = useRef<HTMLDivElement | null>(null);

  if (hidden) return null;

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    setThread((t) => [...t, { question: q, answer: null }]);
    // Keep the newest exchange in view once it renders.
    setTimeout(() => threadRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
    try {
      const res = await api.askAssist(q, location.pathname);
      setThread((t) =>
        t.map((e, i) => (i === t.length - 1 ? { ...e, answer: res.answer } : e))
      );
    } catch {
      setThread((t) =>
        t.map((e, i) =>
          i === t.length - 1
            ? { ...e, answer: null, error: 'The guide could not answer just now — try again in a moment.' }
            : e
        )
      );
    } finally {
      setBusy(false);
      setTimeout(() => threadRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the guide — ask a question or take the tour"
        className="fixed bottom-5 right-5 z-[1090] w-12 h-12 rounded-full bg-primary hover:bg-primary-dark text-white shadow-lg flex items-center justify-center transition-colors"
      >
        <HelpCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[1100] brand-card w-[360px] max-w-[calc(100vw-2.5rem)] shadow-xl border-t-4 !border-t-primary flex flex-col max-h-[min(560px,calc(100vh-6rem))]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="text-[11px] font-display font-semibold uppercase tracking-widest text-primary-dark flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> FieldProof guide
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close the guide"
          className="p-1.5 -mr-1 rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Thread / empty state */}
      <div ref={threadRef} className="flex-1 overflow-y-auto px-4 pb-2 space-y-3 min-h-[120px]">
        {thread.length === 0 ? (
          <div>
            <p className="text-sm text-muted-foreground">
              Ask anything about how FieldProof works — runs, verification, exports, the field
              app — and I'll answer from the app's own guide.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="text-xs rounded-full border border-border px-2.5 py-1 hover:bg-muted text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          thread.map((e, i) => (
            <div key={i}>
              <p className="text-sm font-semibold">{e.question}</p>
              {e.answer ? (
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{e.answer}</p>
              ) : e.error ? (
                <p className="text-sm text-warning mt-1">{e.error}</p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1 animate-pulse">Thinking…</p>
              )}
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void ask(input);
        }}
        className="px-4 pb-2"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            placeholder="Ask a question…"
            maxLength={500}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send question"
            className="rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-40 text-white px-3 py-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>

      {/* Footer: the tour + the question log */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onStartTour();
          }}
          className="inline-flex items-center gap-1.5 text-sm font-semibold font-display text-primary-dark hover:underline"
        >
          <Compass className="w-4 h-4" /> Take the tour
        </button>
        <Link
          to="/questions"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Question log
        </Link>
      </div>
    </div>
  );
}
