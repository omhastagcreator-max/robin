import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, AlertTriangle, Sparkles, Loader2, Check, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * HelpBubble — always-on floating button (bottom-right) that opens a panel
 * with two tabs:
 *
 *   1. Report an issue   — captures URL + browser + last few console errors
 *                          + optional screenshot paste, sends to /api/issues.
 *                          Backend (Gemini) classifies + replies with a
 *                          suggested fix, surfaced right in the panel.
 *
 *   2. Ask Robin         — free-form Q&A chat. Stateless on the server;
 *                          we keep the message history in component state.
 *
 * Hidden on public routes (login, share links, guest meeting page). On
 * those the user might not be authenticated anyway, and the API would 401.
 */

type Tab = 'report' | 'ask';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  /** Optional pending action — when set, renders a confirmation card
   *  with Execute/Cancel buttons under the message. */
  pendingAction?: {
    action: string;
    params: Record<string, any>;
    confirm: string;
  };
}

// Tiny shared buffer for recent console errors / failed network calls.
// Installed once when the bubble mounts so we always have context to ship
// alongside an issue report.
const recentErrors: string[]  = [];
const recentNetwork: string[] = [];
let installedTaps = false;
function installContextTaps() {
  if (installedTaps || typeof window === 'undefined') return;
  installedTaps = true;
  const origError = window.onerror;
  window.onerror = (msg, src, line, col, err) => {
    try {
      const entry = `${String(msg).slice(0, 200)} @${src?.split('/').pop() || ''}:${line}:${col}${err?.stack ? ' :: ' + String(err.stack).split('\n').slice(0, 3).join(' | ').slice(0, 300) : ''}`;
      recentErrors.unshift(entry);
      if (recentErrors.length > 8) recentErrors.length = 8;
    } catch { /* ignore */ }
    return origError ? origError(msg, src, line, col, err) : false;
  };
  // capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = (e?.reason && (e.reason.message || String(e.reason))) || 'unhandledrejection';
      recentErrors.unshift(String(reason).slice(0, 300));
      if (recentErrors.length > 8) recentErrors.length = 8;
    } catch { /* ignore */ }
  });
  // tap fetch failures (LiveKit's WebSocket isn't fetch — that's OK, axios already logs)
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    try {
      const r = await origFetch(...args);
      if (!r.ok) {
        recentNetwork.unshift(`${r.status} ${(args[1] as any)?.method || 'GET'} ${url.split('?')[0].slice(-80)}`);
        if (recentNetwork.length > 8) recentNetwork.length = 8;
      }
      return r;
    } catch (err: any) {
      recentNetwork.unshift(`ERR ${(args[1] as any)?.method || 'GET'} ${url.split('?')[0].slice(-80)} :: ${err?.message || ''}`);
      if (recentNetwork.length > 8) recentNetwork.length = 8;
      throw err;
    }
  };
}

const HIDE_ON_PREFIXES = ['/login', '/update-password', '/share/', '/meet/'];

export function HelpBubble() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState<Tab>('report');

  useEffect(() => { installContextTaps(); }, []);

  // Hide on public routes + when there's no logged-in user.
  if (!user) return null;
  if (HIDE_ON_PREFIXES.some(p => location.pathname.startsWith(p))) return null;

  return (
    <>
      {/* Floating Robin AI bubble — bottom-right, BUT stacked ABOVE the
          Start-Meeting FAB so the two don't overlap. The MeetingQuickFab
          sits at bottom-5; we sit at bottom-24 (offset by ~76px including
          its height + a gap). A small "AI" badge on the avatar makes it
          obvious this is the assistant, not a generic help icon. */}
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? 'Close Robin AI' : 'Ask Robin AI / Report an issue'}
        className="fixed bottom-24 right-5 z-[80] h-12 w-12 rounded-full shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform overflow-visible"
        style={{
          background: 'linear-gradient(135deg, hsl(178 65% 26%) 0%, hsl(178 70% 38%) 50%, hsl(40 90% 55%) 100%)',
          boxShadow: '0 8px 28px -8px hsl(178 65% 26% / 0.55), 0 0 0 1px hsl(178 65% 26% / 0.15)',
        }}
        aria-label="Robin AI assistant"
      >
        {open ? (
          <X className="h-5 w-5 text-white" />
        ) : (
          <>
            <Sparkles className="h-5 w-5 text-white drop-shadow-sm" />
            <span className="absolute -top-1 -right-1 px-1 h-3.5 rounded-full bg-rose-500 text-white text-[8px] font-bold flex items-center justify-center shadow-sm">
              AI
            </span>
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-40 right-5 z-[80] w-[min(380px,calc(100vw-2.5rem))] max-h-[min(560px,calc(100vh-12rem))] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(135deg, hsl(178 65% 26%) 0%, hsl(178 70% 38%) 50%, hsl(40 90% 55%) 100%)' }}>
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold">Robin AI</p>
                  <p className="text-[10px] text-muted-foreground -mt-0.5">Tailored to your role</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border bg-muted/15">
              <TabButton active={tab === 'report'} onClick={() => setTab('report')}>
                <AlertTriangle className="h-3.5 w-3.5" /> Report issue
              </TabButton>
              <TabButton active={tab === 'ask'} onClick={() => setTab('ask')}>
                <Sparkles className="h-3.5 w-3.5" /> Ask Robin
              </TabButton>
            </div>

            <div className="flex-1 overflow-y-auto">
              {tab === 'report' && <ReportTab onClose={() => setOpen(false)} />}
              {tab === 'ask'    && <AskTab />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
        active ? 'text-primary border-b-2 border-primary bg-card' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Report-issue tab
// ─────────────────────────────────────────────────────────────────────────
function ReportTab({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot]   = useState<string>('');
  const [submitting, setSubmitting]   = useState(false);
  const [submitted, setSubmitted]     = useState<{ suggestion: string; aiUsed: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickFile = () => fileRef.current?.click();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2_000_000) { toast.error('Screenshot must be under 2 MB. Crop it smaller please.'); return; }
    const reader = new FileReader();
    reader.onload = () => setScreenshot(String(reader.result || ''));
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    const text = description.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      const res = await api.reportIssue({
        description: text,
        screenshotData: screenshot || undefined,
        context: {
          url:           typeof window !== 'undefined' ? window.location.href.slice(0, 500) : '',
          userAgent:     typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : '',
          viewport:      typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
          recentErrors:  recentErrors.slice(0, 8),
          recentNetwork: recentNetwork.slice(0, 8),
        },
      });
      setSubmitted({ suggestion: res.suggestedFix, aiUsed: res.aiUsed });
      setDescription('');
      setScreenshot('');
    } catch { /* axios toasts */ }
    finally { setSubmitting(false); }
  };

  if (submitted) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-emerald-700">
          <Check className="h-4 w-4" /> <p className="text-sm font-semibold">Got it — issue logged.</p>
        </div>
        <div className="rounded-xl border border-border bg-muted/15 p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {submitted.aiUsed ? 'Suggested fix (AI)' : 'Next step'}
          </p>
          <p className="text-[13px] leading-relaxed">{submitted.suggestion}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setSubmitted(null)}
            className="flex-1 h-9 rounded-lg text-xs font-semibold border border-border hover:bg-muted">
            Report another
          </button>
          <button onClick={onClose}
            className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        Tell us what's wrong. We'll auto-include this page + your role + recent errors. You'll get an instant suggestion if it's a known one.
      </p>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="e.g. The Join Huddle button doesn't do anything when I click it on Safari…"
        className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {/* Screenshot */}
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        <button onClick={pickFile}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-border text-[11px] font-semibold hover:bg-muted">
          <ImageIcon className="h-3.5 w-3.5" />
          {screenshot ? 'Replace screenshot' : 'Attach screenshot (optional)'}
        </button>
        {screenshot && (
          <button onClick={() => setScreenshot('')} className="text-[11px] text-muted-foreground hover:text-foreground">
            remove
          </button>
        )}
      </div>
      {screenshot && (
        <img src={screenshot} alt="Screenshot preview" className="max-h-32 rounded-lg border border-border" />
      )}

      <button
        onClick={submit}
        disabled={submitting || description.trim().length < 4}
        className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {submitting ? 'Sending…' : 'Send report'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Ask-Robin tab
// ─────────────────────────────────────────────────────────────────────────
function AskTab() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', text: "Hi! Ask me how to use Robin — or tell me what to do.\n\nTry: \"Create a task: review Velloer Shopify by Friday\" or \"Mark Darpan project done\"." },
  ]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  /**
   * Send pipeline:
   *  1. Add user msg
   *  2. Hit /parse-command — Gemini decides ACTION vs QUESTION.
   *  3a. ACTION → render confirmation card; user clicks Execute.
   *  3b. QUESTION → fall back to the existing /ask endpoint for an answer.
   */
  const send = async () => {
    const q = draft.trim();
    if (!q || sending) return;
    setDraft('');
    setMessages(m => [...m, { role: 'user', text: q }]);
    setSending(true);
    try {
      const parsed = await api.aiParseCommand(q);
      if (parsed.isAction && parsed.action !== 'question' && parsed.action !== 'unsupported') {
        setMessages(m => [...m, {
          role: 'assistant',
          text: parsed.confirm || `I'll do this for you. Confirm?`,
          pendingAction: { action: parsed.action, params: parsed.params || {}, confirm: parsed.confirm || '' },
        }]);
      } else if (parsed.action === 'unsupported') {
        setMessages(m => [...m, { role: 'assistant', text: parsed.userReply || "I can't do that one yet — let me know if you'd like it added." }]);
      } else {
        // Fall through to the regular Ask Robin answer.
        const res = await api.askRobin({
          question: q,
          context: { url: typeof window !== 'undefined' ? window.location.pathname : '' },
        });
        setMessages(m => [...m, { role: 'assistant', text: res.answer }]);
      }
    } catch {
      setMessages(m => [...m, { role: 'assistant', text: "Hmm, I couldn't reach the AI service. Please try again in a moment." }]);
    } finally {
      setSending(false);
    }
  };

  /**
   * Execute a pending action by calling the right backend API. Only the
   * actions in the switch below are wired today; everything else gives a
   * polite "not yet supported" reply.
   */
  const executePending = async (msgIndex: number, action: string, params: Record<string, any>) => {
    setSending(true);
    try {
      // Shared action executor — same logic now runs in the persistent
      // Copilot drawer too, see client/src/lib/robinActions.ts.
      const { executeRobinCommand } = await import('@/lib/robinActions');
      const r = await executeRobinCommand(action as any, params, String(params._originalMessage || ''));
      setMessages(m => {
        const next = [...m];
        next[msgIndex] = { role: 'assistant', text: r.text };
        return next;
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Couldn't execute that action.";
      setMessages(m => [...m, { role: 'assistant', text: msg }]);
    } finally {
      setSending(false);
    }
  };

  const cancelPending = (msgIndex: number) => {
    setMessages(m => {
      const next = [...m];
      next[msgIndex] = { role: 'assistant', text: 'OK, cancelled. Tell me if you want something else.' };
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col h-[440px]">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] space-y-2`}>
              <div className={`px-3 py-2 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-foreground'
              }`}>
                {m.text}
              </div>
              {/* Pending action — render a confirmation card with
                  Execute / Cancel. Robin won't do anything until the user
                  clicks. */}
              {m.pendingAction && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-2.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-primary">
                    <Sparkles className="h-3 w-3" /> AI action
                  </div>
                  <pre className="text-[11px] font-mono bg-background border border-border rounded-lg px-2 py-1 overflow-x-auto leading-snug">
{m.pendingAction.action}({Object.entries(m.pendingAction.params).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})
                  </pre>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => executePending(i, m.pendingAction!.action, m.pendingAction!.params)}
                      disabled={sending}
                      className="px-3 h-7 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Execute
                    </button>
                    <button
                      onClick={() => cancelPending(i)}
                      disabled={sending}
                      className="px-3 h-7 rounded-lg border border-border bg-card text-[11px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-xl bg-muted/40 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> thinking
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border p-2 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={2000}
          placeholder="Ask anything about Robin…"
          className="flex-1 resize-none px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 shrink-0"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
