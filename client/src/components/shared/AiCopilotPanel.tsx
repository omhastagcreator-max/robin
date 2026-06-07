import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Sparkles, Send, X, MessageCircleQuestion, ChevronRight, Wand2 } from 'lucide-react';
import * as api from '@/api';

/**
 * AiCopilotPanel — always-accessible AI assistant.
 *
 * Visual model:
 *   - Floating button bottom-right (gradient pill, sparkly icon).
 *   - Click → slides up a panel from the bottom-right corner.
 *   - Panel has: suggested question chips, history scroll, input.
 *
 * Persistence:
 *   - History is kept in sessionStorage so it survives page nav within
 *     a session but doesn't pollute future sessions.
 *
 * Calls /api/copilot/ask. Renders the AI's prose answer plus any
 * referenced entities as clickable chips that deep-link into the
 * relevant brand workspace / task list / etc.
 *
 * Wide accessibility:
 *   - Tab through input, Enter submits.
 *   - Esc closes panel.
 *   - Reduced motion respected via plain CSS transitions.
 */

const SUGGESTIONS = [
  'Which clients are at risk?',
  'Who is overloaded right now?',
  'Show me all delayed projects',
  'What should I focus on today?',
];

interface Entity {
  kind: 'brand' | 'task' | 'employee';
  id: string;
  name: string;
  link: string;
}
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  entities?: Entity[];
  at: number;
}

const STORAGE_KEY = 'robin.copilot.history';

export function AiCopilotPanel() {
  // IMPORTANT — Rules of Hooks: ALL hooks must run on every render in
  // the same order. We compute the `onWorkroom` skip flag from
  // useLocation but defer the actual return-null check until AFTER all
  // hooks have run. A prior version returned null between useState
  // and useEffect calls, which produced React error #310 and turned
  // every subsequent navigation into a blank screen.
  const location = useLocation();
  const onWorkroom = location.pathname === '/workroom-home';
  const [open, setOpen]       = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft]     = useState('');
  const [busy, setBusy]       = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-20))); }
    catch { /* private mode */ }
  }, [messages]);
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, open]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // SAFE to bail out now — all hooks above have already executed.
  if (onWorkroom) return null;

  const ask = async (text?: string) => {
    const q = (text ?? draft).trim();
    if (!q || busy) return;
    setMessages(prev => [...prev, { role: 'user', content: q, at: Date.now() }]);
    setDraft('');
    setBusy(true);
    try {
      const resp = await api.copilotAsk(q);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: resp.answer || 'No answer.',
        entities: resp.entities || [],
        at: Date.now(),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I couldn't reach the AI service. Try again.",
        at: Date.now(),
      }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-full shadow-lg text-white text-[12.5px] font-bold transition-transform hover:scale-[1.03]"
          style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
          aria-label="Ask Robin Copilot"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Ask Robin
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[360px] max-w-[calc(100vw-2.5rem)] rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col"
             style={{ maxHeight: 'min(540px, calc(100vh - 4rem))' }}>
          {/* Header — same gradient as launcher */}
          <div className="px-3.5 py-2.5 flex items-center justify-between text-white"
               style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}>
            <div className="flex items-center gap-2">
              <Wand2 className="h-3.5 w-3.5" />
              <div>
                <p className="text-[11.5px] font-bold leading-tight">Robin Copilot</p>
                <p className="text-[10px] text-white/85 leading-tight">Ask anything about the agency.</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-white/80 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-[11.5px] text-muted-foreground">
                  Ask in plain English. Robin answers from your live agency data — brands, tasks, team, deadlines.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="px-2 py-1 rounded-full bg-muted/60 hover:bg-muted text-[10.5px] text-foreground/80 hover:text-foreground inline-flex items-center gap-1"
                    >
                      <MessageCircleQuestion className="h-2.5 w-2.5 text-primary" /> {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} onAsk={ask} />
            ))}
            {busy && (
              <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 animate-pulse text-primary" /> Thinking…
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={e => { e.preventDefault(); ask(); }}
            className="border-t border-border flex items-center gap-1.5 px-2 py-2"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Ask Robin…"
              className="flex-1 px-2 h-8 rounded-md border border-input bg-background text-[12px] focus:ring-2 focus:ring-ring focus:outline-none"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              className="h-8 px-2.5 rounded-md text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--accent)) 100%)' }}
            >
              <Send className="h-3 w-3" /> Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function MessageBubble({ message, onAsk }: { message: ChatMessage; onAsk: (q: string) => void }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-1.5 text-[12px] leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-muted/60 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
        {message.content}
      </div>
      {message.entities && message.entities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-1">
          {message.entities.slice(0, 5).map(e => (
            <Link
              key={e.kind + e.id}
              to={e.link}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background border border-border text-[10.5px] hover:border-primary/40"
            >
              <span className="text-muted-foreground capitalize">{e.kind}</span>
              <span className="font-semibold">{e.name}</span>
              <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
      {/* Use the avoid-lint void to acknowledge onAsk is part of the
          contract even when this branch doesn't currently use it. */}
      {void onAsk}
    </div>
  );
}
