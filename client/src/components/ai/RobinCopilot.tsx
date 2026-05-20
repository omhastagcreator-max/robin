import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Sparkles, Send, Loader2, MessageSquare, X, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { useDrawer } from '@/components/ui/RightDrawer';
import { AIInsight } from '@/components/ai/AIInsight';
import * as api from '@/api';

/**
 * RobinCopilot — context-aware AI drawer.
 *
 * Mounted via `useDrawer().open({ content: <RobinCopilotPanel /> })`. The
 * panel reads `useLocation()` to know which page the user is on and pulls
 * the matching contextual IDs from `useParams()`:
 *
 *   /clients/pipeline/:id  → ship workflowId so the model sees the full
 *                            project + recent activity + risk score
 *   /sales (lead detail)   → ship leadId (when surfaced by the page)
 *   /tasks                 → server pulls user's open tasks
 *   /clients/pipeline      → server pulls at-risk projects
 *   default                → only route + role
 *
 * QUICK PROMPTS — short opinionated prompts the user can fire with one
 * click. They vary per route so the drawer feels like it understands the
 * user's current workflow.
 *
 * UX RULES:
 *   • No streaming — single shot reply, rendered in AIInsight.Summary.
 *   • Latest reply is at the top; prior threads shown below for re-read.
 *   • In-memory only — no server thread storage (yet). Drawer close =
 *     conversation gone. Keeps the surface lightweight.
 *   • Esc closes the drawer.
 *
 * NEVER opens a modal. AI is embedded in the workflow, not the workflow
 * embedded in AI.
 */

interface Turn {
  question: string;
  answer:   string;
  aiUsed:   boolean;
  at:       number;
}

/**
 * Suggested prompts by route. Each prompt is a single click → fires the
 * same backend call with `question = label`. Tuned per route so the AI
 * sees a question matched to what the user is looking at.
 */
function suggestionsFor(pathname: string): string[] {
  if (pathname.startsWith('/clients/pipeline/')) {
    return [
      'Summarize where this project is right now',
      'What\'s the most likely cause of any delay?',
      'Draft a one-paragraph client update I can paste',
      'Who should I ping next, and about what?',
    ];
  }
  if (pathname.startsWith('/clients/pipeline')) {
    return [
      'Which projects are at the highest risk?',
      'Which projects are stalled and why?',
      'What should the team prioritise this week?',
      'Which clients deserve a proactive update today?',
    ];
  }
  if (pathname.startsWith('/tasks')) {
    return [
      'What\'s the single most important task I should do next?',
      'What should I drop or delegate?',
      'Are any of my deadlines unrealistic?',
    ];
  }
  if (pathname.startsWith('/sales')) {
    return [
      'Which lead should I call right now?',
      'Which deals are at risk of ghosting?',
      'Draft a follow-up message for the top hot lead',
    ];
  }
  if (pathname.startsWith('/admin')) {
    return [
      'Where is the team overloaded?',
      'What\'s the single biggest operational risk today?',
      'Which clients should I worry about this week?',
    ];
  }
  return [
    'What\'s the state of the agency today?',
    'What should I focus on next?',
  ];
}

export function RobinCopilotPanel() {
  const location = useLocation();
  const params   = useParams();
  const route    = location.pathname;

  // The :id segment of /clients/pipeline/:id (workflow). Generalised so
  // future detail routes (e.g. /sales/leads/:id) plug in trivially.
  const workflowId = route.startsWith('/clients/pipeline/') ? params.id : undefined;
  const leadId     = undefined; // surface later when sales lead drawer ships

  const [input, setInput]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const inputRef              = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus on mount so the user can just start typing.
  useEffect(() => { inputRef.current?.focus(); }, []);

  const suggestions = useMemo(() => suggestionsFor(route), [route]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const result = await api.aiCopilot({
        question:    q,
        route,
        workflowId,
        leadId,
      });
      setHistory(prev => [{ question: q, answer: result.answer, aiUsed: result.aiUsed, at: Date.now() }, ...prev]);
      setInput('');
    } catch (e: any) {
      if (e?.response?.status === 429) {
        toast.error('AI rate limit — try again in a moment.');
      } else {
        toast.error(e?.response?.data?.error || 'Copilot is unavailable right now.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); ask(input); };
  const onKey    = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd-Enter / Ctrl-Enter to submit. Plain Enter inserts newline.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ask(input);
    }
  };

  // Lightweight route label for the header.
  const routeLabel = (() => {
    if (workflowId)                             return 'this project';
    if (route.startsWith('/clients/pipeline'))  return 'the pipeline';
    if (route.startsWith('/tasks'))             return 'your tasks';
    if (route.startsWith('/sales'))             return 'sales';
    if (route.startsWith('/admin'))             return 'admin operations';
    return 'Robin';
  })();

  return (
    <div className="flex flex-col h-full">
      {/* Header — context badge so the user knows the model has it. */}
      <header className="border-b border-border px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <p className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-primary">Robin Copilot</p>
          <span className="ml-auto text-[10.5px] text-muted-foreground">⌘⏎ to send</span>
        </div>
        <p className="text-[12px] text-muted-foreground leading-snug">
          Asking about <span className="font-semibold text-foreground">{routeLabel}</span>. The model sees your role, the current route, and the operational state of what you're looking at.
        </p>
      </header>

      {/* Input */}
      <form onSubmit={onSubmit} className="border-b border-border p-3 space-y-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask anything operational — “Which projects need a nudge today?”"
          rows={3}
          maxLength={800}
          className="w-full px-3 py-2 bg-background border border-input rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-muted-foreground tabular-nums">{input.length} / 800</span>
          <div className="flex items-center gap-1.5">
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setHistory([])}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Clear conversation"
              >
                <RotateCcw className="h-3 w-3" /> Clear
              </button>
            )}
            <button
              type="submit"
              disabled={busy || input.trim().length < 3}
              className="inline-flex items-center gap-1.5 px-3 h-7 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {busy ? 'Asking…' : 'Ask'}
            </button>
          </div>
        </div>
      </form>

      {/* Suggested prompts (only when no history yet) */}
      {history.length === 0 && (
        <section className="px-3 py-3 space-y-2 border-b border-border">
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Quick prompts</p>
          <div className="space-y-1.5">
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={busy}
                className="w-full text-left px-3 py-2 rounded-lg border border-border bg-card hover:border-primary/30 hover:bg-primary/[0.04] text-[12.5px] leading-snug transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Conversation — latest at top */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {busy && history.length === 0 && <AIInsight.Skeleton lines={3} />}
        {history.map((t, idx) => (
          <article key={t.at} className="space-y-2">
            <div className="flex items-start gap-2">
              <div className="h-5 w-5 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="h-3 w-3" />
              </div>
              <p className="flex-1 text-[12.5px] font-semibold leading-snug">{t.question}</p>
            </div>
            <AIInsight.Summary
              text={t.answer}
              aiUsed={t.aiUsed}
              label={idx === 0 ? 'Answer' : 'Previous answer'}
            />
          </article>
        ))}
      </div>
    </div>
  );
}

/**
 * useRobinCopilot — single hook the rest of the app uses to open the drawer.
 * Encapsulates the drawer.open() call so callers don't have to know the
 * RobinCopilotPanel exists. Returns the open() function.
 *
 *   const openCopilot = useRobinCopilot();
 *   <button onClick={openCopilot}>Ask Robin</button>
 */
export function useRobinCopilot() {
  const drawer = useDrawer();
  return () => {
    drawer.open({
      title: 'Robin Copilot',
      width: 'lg',
      content: <RobinCopilotPanel />,
    });
  };
}

// Re-export so the consuming page only imports one symbol.
export { Sparkles as RobinSparkles, X as RobinCopilotClose };
