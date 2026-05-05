import { useEffect, useRef, useState } from 'react';
import { Send, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { useAuth } from '@/contexts/AuthContext';
import * as api from '@/api';

/**
 * HuddlePingChat
 *
 * Lightweight chat strip that sits inside the huddle. Reuses the EXISTING
 * chat backend (the 'agency-global' room) so messages typed here also show
 * up in the full /chat page, and vice versa. No new tables, no duplicate
 * state — just a compact UI on top of the same data stream.
 *
 * Why "ping" framing instead of full chat:
 *   - The huddle is voice-first. Chat is for quick async pings ("on it",
 *     a link, a number) without interrupting the speaker.
 *   - We show only the last few messages with a one-line input, so it
 *     never dominates the layout.
 *
 * Collapsible — click the header to fold it down to a single line so you
 * can keep more screen real estate for shared screens.
 */

const ROOM = 'agency-global';
const HISTORY_LIMIT = 8;

export function HuddlePingChat() {
  const socket = useSocket();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Load last few messages on mount.
  useEffect(() => {
    api.getChatHistory({ roomId: ROOM, limit: HISTORY_LIMIT })
      .then(d => setMessages(Array.isArray(d) ? d : []))
      .catch(() => {/* ignore */});
  }, []);

  // Live updates via socket.
  useEffect(() => {
    if (!socket) return;
    socket.emit('chat:join', { roomId: ROOM });
    const onMsg = (msg: any) => {
      setMessages(prev => [...prev.slice(-(HISTORY_LIMIT * 2)), msg]);
      // Bump unread badge if collapsed and message isn't from me.
      if (collapsed && msg.senderId !== user?.id) {
        setUnread(u => u + 1);
      }
    };
    socket.on('chat:message', onMsg);
    return () => { socket.off('chat:message', onMsg); };
  }, [socket, collapsed, user?.id]);

  // Auto-scroll list to the latest message.
  useEffect(() => {
    if (collapsed || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, collapsed]);

  // Clear unread when expanded.
  useEffect(() => {
    if (!collapsed) setUnread(0);
  }, [collapsed]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !socket) return;
    socket.emit('chat:message', { roomId: ROOM, content: text });
    setInput('');
  };

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-muted/50 transition-colors"
      >
        <MessageSquare className="h-3.5 w-3.5 text-primary" />
        <span>Huddle chat</span>
        {unread > 0 && (
          <span className="bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground font-normal">
          {collapsed ? 'expand' : 'collapse'}
        </span>
        {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {!collapsed && (
        <>
          {/* Message list — short, scrollable */}
          <div ref={listRef} className="max-h-44 overflow-y-auto px-3 py-2 space-y-1.5 text-xs">
            {messages.length === 0 ? (
              <p className="text-muted-foreground text-[11px] py-3 text-center">
                Quick pings during the huddle land here. No one's said anything yet.
              </p>
            ) : (
              messages.map(m => {
                const mine = m.senderId === user?.id;
                return (
                  <div key={m._id || `${m.senderId}-${m.createdAt}`} className="flex gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${mine ? 'text-primary' : 'text-foreground/70'}`}>
                      {(m.senderName || 'Unknown').split(' ')[0]}:
                    </span>
                    <span className="text-foreground/90 break-words">{m.content}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Input */}
          <form onSubmit={send} className="border-t border-border flex items-center gap-2 px-3 py-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Send a quick ping…"
              className="flex-1 bg-muted/40 rounded-md px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              maxLength={500}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default HuddlePingChat;
