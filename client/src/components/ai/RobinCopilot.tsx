import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Sparkles, Send, Loader2, MessageSquare, X, RotateCcw, Pin, PinOff, Check, Play, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';

import { useDrawer } from '@/components/ui/RightDrawer';
import { AIInsight } from '@/components/ai/AIInsight';
import * as api from '@/api';
import { executeRobinCommand, type RobinAction } from '@/lib/robinActions';
import { useVoiceInput } from '@/hooks/useVoiceInput';

/**
 * RobinCopilot — persistent, Robin-aware, per-employee AI drawer.
 *
 * The drawer now does THREE things the older version didn't:
 *
 *   1. GENERALISED — works on every route. The model always sees the
 *      caller's projects/tasks/leads/focus from buildUserContext() on
 *      the server, regardless of where they opened the drawer.
 *
 *   2. ROBIN-AWARE — the system prompt is fed a compact JSON snapshot
 *      of the user's live state (open projects, tasks, leads, focus,
 *      what they're currently viewing), so it never has to ask "which
 *      project?" and never makes up names.
 *
 *   3. PER-EMPLOYEE DEDICATED — every conversation persists server-side
 *      under (organizationId, ownerId). Re-opening the drawer loads the
 *      thread. "Start fresh" wipes history (keeps the pinned note).
 *      A "pinned note" lets the user write "always remember X" — that
 *      string is injected into every system prompt.
 *
 * Chat layout: oldest at TOP, newest at BOTTOM (standard chat). Input
 * docked at the bottom. Pinned note + reset buttons live in the header.
 */

interface PendingTurn {
  question: string;
  at:       number;
}

interface Turn {
  _id?:   string;
  role:   'user' | 'assistant' | 'system';
  text:   string;
  aiUsed: boolean;
  at:     string | number;
  /** When the AI parsed the user's message as an action, this card sits
   *  inside the assistant turn waiting for Execute / Cancel. Cleared
   *  when the user picks one (the result text replaces it). */
  pendingAction?: {
    action:  RobinAction;
    params:  Record<string, any>;
    confirm: string;
  };
}

/** Route-tuned quick prompts. Still useful even with thread memory — they're
 *  one-tap "kick the conversation off in this direction" buttons. */
function suggestionsFor(pathname: string): string[] {
  if (pathname.startsWith('/clients/pipeline/')) {
    return [
      'Summarize where this project is right now',
      "What's the most likely cause of any delay?",
      'Draft a one-paragraph client update I can paste',
      'Who should I ping next, and about what?',
    ];
  }
  if (pathname.startsWith('/clients/pipeline')) {
    return [
      'Which of my projects are at the highest risk?',
      'Which projects are stalled and why?',
      'What should I prioritise this week?',
      'Which clients deserve a proactive update today?',
    ];
  }
  if (pathname.startsWith('/tasks')) {
    return [
      "What's the single most important task I should do next?",
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
      "What's the single biggest operational risk today?",
      'Which clients should I worry about this week?',
    ];
  }
  return [
    "What's the state of the agency today?",
    'What should I focus on next?',
    'What did we last discuss?',
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

  const [input, setInput]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [loading, setLoading]     = useState(true);
  const [turns, setTurns]         = useState<Turn[]>([]);
  const [pending, setPending]     = useState<PendingTurn | null>(null);
  const [pinnedNote, setPinnedNote] = useState('');
  const [pinEditing, setPinEditing] = useState(false);
  const [pinDraft, setPinDraft]   = useState('');
  const inputRef                  = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef                 = useRef<HTMLDivElement | null>(null);

  // ── Voice input ────────────────────────────────────────────────────
  // Click the mic → live transcript streams into the input → on 1.8s
  // silence, recognition auto-stops AND we INSTANTLY fire ask() with
  // the final transcript. No Send-click, no useEffect dance — direct
  // callback into ask() via a ref so we don't fight React render order.
  //
  // Typed input still requires Send manually — only voice auto-sends.
  //
  // askRef holds the latest ask() function. We can't reference ask
  // directly from onFinal because ask is defined LATER (function
  // hoisting only applies to function declarations, not consts). The
  // ref pattern bridges the lexical gap cleanly.
  const askRef = useRef<((q: string) => Promise<void>) | null>(null);
  const voice = useVoiceInput({
    language: 'en-IN',
    silenceMs: 1800,
    onFinal: (text) => {
      // Show the transcript in the input for the half-second before the
      // user bubble renders + clears it, then fire ask().
      setInput(text);
      const fn = askRef.current;
      if (!fn) return;
      // Defer one microtask so React commits the setInput before ask()
      // takes its setInput('') path.
      Promise.resolve().then(() => { void fn(text); });
    },
  });
  // Mirror the live interim transcript into the input field as the user
  // talks so they see what Robin heard in real time.
  useEffect(() => {
    if (!voice.listening) return;
    setInput(voice.transcript);
  }, [voice.transcript, voice.listening]);

  // Global hotkey ⌘M (Mac) / Ctrl+M (Win) opens the drawer and dispatches
  // this event so we start listening the moment the drawer mounts.
  // See GlobalShortcuts.
  useEffect(() => {
    const onStart = () => { if (voice.supported && !voice.listening) voice.start(); };
    window.addEventListener('robin:voice-start', onStart);
    return () => window.removeEventListener('robin:voice-start', onStart);
  }, [voice.supported, voice.listening, voice.start]);

  const suggestions = useMemo(() => suggestionsFor(route), [route]);

  // ── Load thread on mount ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.aiCopilotThread();
        if (cancelled) return;
        setTurns((data.turns || []).map(t => ({
          _id: t._id, role: t.role, text: t.text, aiUsed: t.aiUsed, at: t.at,
        })));
        setPinnedNote(data.pinnedNote || '');
        setPinDraft(data.pinnedNote || '');
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 404) {
          toast.error('Robin Copilot thread endpoint not deployed yet. Try again in a minute.', { duration: 6000 });
        } else if (status && status !== 401) {
          toast.error('Could not load Robin conversation history.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          // Autofocus after the thread paints so cursor doesn't jump mid-render
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-scroll to bottom on new turn / pending change.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, pending, loading]);

  // ── Ask ───────────────────────────────────────────────────────────
  // Two-stage flow so Robin can DO things, not just talk:
  //   1. parse-command — Gemini decides ACTION vs QUESTION.
  //      - ACTION  → render an Execute / Cancel card inline. The action
  //        only persists to the thread once the user picks one.
  //      - QUESTION → normal /copilot call, both turns persist server-side.
  // Lightweight heuristic skip — if the message obviously isn't an
  // action (very long, ends in '?', begins with question words), we
  // bypass parse-command entirely to save a Gemini hop.
  const looksLikeQuestion = (q: string) => {
    if (q.length > 240) return true;
    if (/[?]\s*$/.test(q)) return true;
    return /^(what|why|how|when|where|who|which|can|could|should|tell|show|explain|summari[sz]e|list|brief|status|help)\b/i.test(q);
  };

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setPending({ question: q, at: Date.now() });
    setInput('');

    // Try parse-command first — unless the message clearly reads as a question.
    if (!looksLikeQuestion(q)) {
      try {
        const parsed = await api.aiParseCommand(q);
        if (parsed.isAction && parsed.action !== 'question' && parsed.action !== 'unsupported') {
          // Action — render confirm card inline. We DO push the user
          // turn into the visible history (so the conversation flows),
          // but we DON'T persist server-side until execute/cancel runs.
          // That keeps the thread free of "I almost did X" noise.
          setTurns(prev => [
            ...prev,
            { role: 'user',      text: q,                              aiUsed: false,         at: new Date().toISOString() },
            { role: 'assistant', text: parsed.confirm || 'Confirm?',    aiUsed: parsed.aiUsed, at: new Date().toISOString(),
              pendingAction: { action: parsed.action as RobinAction, params: parsed.params || {}, confirm: parsed.confirm || '' } },
          ]);
          setPending(null);
          setBusy(false);
          return;
        }
        if (parsed.action === 'unsupported') {
          // Surface the model's polite refusal directly — no /copilot hop.
          setTurns(prev => [
            ...prev,
            { role: 'user',      text: q,                                                                          aiUsed: false,         at: new Date().toISOString() },
            { role: 'assistant', text: parsed.userReply || "I can't do that one yet — let me know if you'd like it added.", aiUsed: parsed.aiUsed, at: new Date().toISOString() },
          ]);
          setPending(null);
          setBusy(false);
          return;
        }
        // Otherwise fall through to the normal /copilot answer path.
      } catch {
        // parse-command unreachable — treat as a question and proceed.
      }
    }

    try {
      const result = await api.aiCopilot({
        question:    q,
        route,
        workflowId,
        leadId,
      });
      // Append both the user turn and the new assistant turn. The server
      // also persisted them — re-opening the drawer rehydrates the same.
      setTurns(prev => [
        ...prev,
        { role: 'user',      text: q,             aiUsed: false,           at: new Date().toISOString() },
        { role: 'assistant', text: result.answer, aiUsed: result.aiUsed,   at: new Date().toISOString() },
      ]);
      setPending(null);
    } catch (e: any) {
      setPending(null);
      const status = e?.response?.status;
      const serverError = e?.response?.data?.error;
      const url = e?.config?.url || '(unknown URL)';
      if (status === 429) {
        toast.error('AI rate limit — try again in a moment.');
      } else if (status === 404) {
        toast.error(
          `Copilot endpoint not reachable: ${url} → 404. The server may be redeploying — try again in ~2 minutes.`,
          { duration: 8000 },
        );
        setTurns(prev => [
          ...prev,
          { role: 'user',      text: q, aiUsed: false, at: new Date().toISOString() },
          { role: 'assistant', text: `I couldn't reach the Copilot endpoint (\`${url}\` returned 404). The server may still be redeploying after the latest push — try again in ~2 minutes.`, aiUsed: false, at: new Date().toISOString() },
        ]);
      } else if (status >= 500) {
        toast.error(`Copilot server error (${status}) — ${serverError || 'try again in a moment.'}`);
      } else {
        toast.error(serverError || `Copilot is unavailable (${status ?? 'no response'}).`);
      }
    } finally {
      setBusy(false);
    }
  };
  // Keep the askRef synced to the latest ask() closure so voice.onFinal
  // can call it directly without a forward reference. Updates every render
  // — cheap (one ref assignment), and guarantees we always call the
  // freshest ask (with the latest route / workflowId / leadId closure).
  askRef.current = ask;

  // Run a pending action. Replaces the confirm card in-place with the
  // result text. Best-effort — if the API rejects we surface the error
  // in the same chat bubble.
  const executePending = async (turnIdx: number) => {
    const t = turns[turnIdx];
    if (!t?.pendingAction || busy) return;
    setBusy(true);
    try {
      // Stitch the user's original message into params so the API audit
      // line can quote it ("via Robin AI: '<message>'"). The user turn
      // sits one before the assistant turn that holds the action card.
      const original = turns[turnIdx - 1]?.text || '';
      const r = await executeRobinCommand(t.pendingAction.action, t.pendingAction.params, original);
      setTurns(prev => {
        const next = [...prev];
        next[turnIdx] = { ...next[turnIdx], text: r.text, pendingAction: undefined };
        return next;
      });
      if (r.ok) toast.success('Done.');
    } finally {
      setBusy(false);
    }
  };

  const cancelPending = (turnIdx: number) => {
    setTurns(prev => {
      const next = [...prev];
      next[turnIdx] = { ...next[turnIdx], text: 'Cancelled. Tell me what you want instead.', pendingAction: undefined };
      return next;
    });
  };

  // ── Reset thread ──────────────────────────────────────────────────
  const resetThread = async () => {
    if (!confirm('Start fresh? Your saved note stays; the chat will be cleared.')) return;
    try {
      await api.aiCopilotReset();
      setTurns([]);
      toast.success('Chat cleared.');
    } catch (e: any) {
      toast.error('Could not clear the chat.');
    }
  };

  // ── Pinned note ───────────────────────────────────────────────────
  const savePin = async () => {
    try {
      const res = await api.aiCopilotPin(pinDraft.trim());
      setPinnedNote(res.pinnedNote);
      setPinEditing(false);
      toast.success(res.pinnedNote ? 'Pinned note updated.' : 'Pinned note cleared.');
    } catch {
      toast.error('Could not save pinned note.');
    }
  };

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); ask(input); };
  const onKey    = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ask(input);
    }
  };

  // Header context label — what the AI is "looking at" right now.
  const routeLabel = (() => {
    if (workflowId)                             return 'this project';
    if (route.startsWith('/clients/pipeline'))  return 'the pipeline';
    if (route.startsWith('/tasks'))             return 'your tasks';
    if (route.startsWith('/sales'))             return 'sales';
    if (route.startsWith('/admin'))             return 'admin operations';
    return 'Robin';
  })();

  const emptyHistory = !loading && turns.length === 0 && !pending;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <p className="text-[10.5px] uppercase tracking-[0.16em] font-bold text-primary">
            Ask Robin
          </p>
          {turns.length > 0 && (
            <span className="text-[10.5px] text-muted-foreground/70 tabular-nums ml-1">
              · {turns.length} message{turns.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="ml-auto text-[10.5px] text-muted-foreground">⌘⏎ to send</span>
        </div>
        <p className="text-[12px] text-muted-foreground leading-snug">
          Your own AI helper. Looking at <span className="font-semibold text-foreground">{routeLabel}</span>.
          Operational stuff (your projects, leads, tasks) or anything else (general questions, writing, code) — it answers both.
          Try <em>"brief me on Vellore"</em>, <em>"mark Oudfy payment task done"</em>, or just ask anything.
          Hit <span className="kbd inline-block px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">⌘M</span> anywhere to talk.
        </p>

        {/* Pinned note — "always remember this" */}
        <div className="rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-2">
          {!pinEditing && (
            <button
              type="button"
              onClick={() => { setPinDraft(pinnedNote); setPinEditing(true); }}
              className="w-full flex items-start gap-1.5 text-left text-[11.5px] leading-snug"
            >
              {pinnedNote ? (
                <Pin className="h-3 w-3 text-amber-600 mt-[2px] shrink-0" />
              ) : (
                <PinOff className="h-3 w-3 text-muted-foreground mt-[2px] shrink-0" />
              )}
              <span className={pinnedNote ? 'text-foreground' : 'text-muted-foreground'}>
                {pinnedNote || 'Add a note Robin should always remember about you (e.g. "I work mostly on Velloer").'}
              </span>
            </button>
          )}
          {pinEditing && (
            <div className="space-y-1.5">
              <textarea
                value={pinDraft}
                onChange={e => setPinDraft(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Always remember this when you talk to me…"
                className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-[11.5px] focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => { setPinEditing(false); setPinDraft(pinnedNote); }}
                  className="px-2 h-6 rounded-md text-[11px] text-muted-foreground hover:bg-muted"
                >Cancel</button>
                <button
                  type="button"
                  onClick={savePin}
                  className="inline-flex items-center gap-1 px-2 h-6 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90"
                >
                  <Check className="h-3 w-3" /> Save
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Conversation ─────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading && (
          <div className="space-y-3">
            <AIInsight.Skeleton lines={3} />
            <AIInsight.Skeleton lines={2} />
          </div>
        )}

        {emptyHistory && (
          <section className="space-y-2">
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
              Try one of these
            </p>
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
            <p className="pt-2 text-[11px] text-muted-foreground italic">
              Tip: I remember our chat the next time you come back. Hit Start fresh when you want a clean slate.
            </p>
          </section>
        )}

        {turns.map((t, idx) => (
          <article key={t._id || `${t.at}-${idx}`} className="space-y-2">
            {t.role === 'user' ? (
              <div className="flex items-start gap-2 justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary/10 text-foreground px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap">
                  {t.text}
                </p>
                <div className="h-5 w-5 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5">
                  <MessageSquare className="h-3 w-3" />
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="h-5 w-5 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="h-3 w-3" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <AIInsight.Summary
                    text={t.text}
                    aiUsed={t.aiUsed}
                    label="Robin"
                  />
                  {/* Action confirm card — only present when AI parsed
                      the user's message as a command. Execute fires the
                      shared executeRobinCommand. */}
                  {t.pendingAction && (
                    <div className="rounded-xl border border-primary/30 bg-primary/[0.05] px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-bold text-primary mb-1.5">
                        <Play className="h-3 w-3" /> Robin can do this
                      </div>
                      <code className="block text-[11px] font-mono text-foreground/80 mb-2 break-all">
                        {t.pendingAction.action}({Object.entries(t.pendingAction.params)
                          .filter(([k]) => !k.startsWith('_'))
                          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})
                      </code>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => executePending(idx)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90 disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Execute
                        </button>
                        <button
                          onClick={() => cancelPending(idx)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-muted-foreground hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </article>
        ))}

        {pending && (
          <article className="space-y-2">
            <div className="flex items-start gap-2 justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary/10 text-foreground px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap">
                {pending.question}
              </p>
              <div className="h-5 w-5 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="h-3 w-3" />
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="h-5 w-5 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="h-3 w-3" />
              </div>
              <div className="flex-1">
                <AIInsight.Skeleton lines={3} />
              </div>
            </div>
          </article>
        )}
      </div>

      {/* ── Input (docked bottom) ─────────────────────────────────── */}
      <form onSubmit={onSubmit} className="border-t border-border p-3 space-y-2 bg-background/50">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder='Type or hit the mic — Robin auto-sends when you pause. Operational or any question.'
          rows={2}
          maxLength={1200}
          className="w-full px-3 py-2 bg-background border border-input rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-muted-foreground tabular-nums flex items-center gap-1.5">
            {input.length} / 1200
            {voice.listening && (
              <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                listening…
              </span>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            {turns.length > 0 && (
              <button
                type="button"
                onClick={resetThread}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Clear chat (your saved note stays)"
              >
                <RotateCcw className="h-3 w-3" /> Start fresh
              </button>
            )}
            {/* Voice mic — click to speak. Live transcript streams into
                the input as you talk; the button stops auto-listening
                ~1.8s after you go quiet. Browsers without Web Speech API
                (Firefox today) hide the button entirely. */}
            {voice.supported && (
              <button
                type="button"
                onClick={() => voice.listening ? voice.stop() : voice.start()}
                disabled={busy}
                title={voice.listening
                  ? 'Stop listening'
                  : 'Click and speak — e.g. "mark Oudfy payment task done"'}
                className={`inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11.5px] font-semibold transition-colors ${
                  voice.listening
                    ? 'bg-rose-500 text-white animate-pulse'
                    : 'bg-card border border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {voice.listening ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                {voice.listening ? 'Stop' : 'Speak'}
              </button>
            )}
            <button
              type="submit"
              disabled={busy || input.trim().length < 2}
              className="inline-flex items-center gap-1.5 px-3 h-7 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {busy ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </div>
      </form>
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
