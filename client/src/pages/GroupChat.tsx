import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Hash, Loader2, AtSign } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

import { AppLayout }  from '@/components/AppLayout';
import { Avatar }     from '@/components/shared/Avatar';
import { useAuth }    from '@/contexts/AuthContext';
import { useSocket }  from '@/hooks/useSocket';
import * as api from '@/api';

/**
 * GroupChat v2 — rebuilt on design-system primitives.
 *
 * Same room (`agency-global`), same message + mention flow. v2 changes:
 *   • ROLE_COLORS map (red/blue/amber/green-400 weights — too light) →
 *     Avatar palette (deterministic hue from initials, consistent with
 *     the rest of the app).
 *   • Bespoke avatar bubbles → shared Avatar component.
 *   • Online indicator now uses emerald-500 (matches StatusPill working).
 *   • Cleaner mention dropdown and right-rail roster.
 */
const ROOM = 'agency-global';

function DateDivider({ date }: { date: Date }) {
  const label = isToday(date) ? 'Today' : isYesterday(date) ? 'Yesterday' : format(date, 'MMM d, yyyy');
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground px-2 bg-background">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

export default function GroupChat() {
  const { user }   = useAuth();
  const socket     = useSocket();
  const [messages, setMessages]       = useState<any[]>([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [allUsers, setAllUsers]       = useState<any[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getChatHistory({ roomId: ROOM, limit: 60 })
      .then(d => { setMessages(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
    api.listUsers().then(d => setAllUsers(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.emit('chat:join', { roomId: ROOM });
    const onMessage  = (msg: any) => setMessages(prev => [...prev, msg]);
    const onPresence = (users: any[]) => setOnlineUsers(users);
    socket.on('chat:message', onMessage);
    socket.on('presence:update', onPresence);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('presence:update', onPresence);
    };
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const extractMentions = (text: string) =>
    allUsers.filter(u => text.includes(`@${u.name || u.email}`)).map(u => u._id);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;
    socket.emit('chat:message', {
      roomId: ROOM,
      content: input.trim(),
      type: 'text',
      mentions: extractMentions(input),
    });
    setInput('');
    setShowMentions(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx !== -1 && atIdx === val.length - 1) { setShowMentions(true); setMentionQuery(''); }
    else if (atIdx !== -1 && val.length > atIdx) {
      const q = val.slice(atIdx + 1);
      if (!q.includes(' ')) { setShowMentions(true); setMentionQuery(q); }
      else setShowMentions(false);
    } else setShowMentions(false);
  };

  const insertMention = (name: string) => {
    const atIdx = input.lastIndexOf('@');
    setInput(input.slice(0, atIdx) + `@${name} `);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const filteredUsers = allUsers.filter((u: any) =>
    (u.name || u.email || '').toLowerCase().includes(mentionQuery.toLowerCase()) && u._id !== user?.id
  );

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto flex gap-4 h-[calc(100vh-8rem)]">
        {/* Main chat */}
        <div className="flex-1 flex flex-col border border-border rounded-xl bg-card overflow-hidden">
          {/* Header */}
          <div className="px-4 h-12 border-b border-border flex items-center gap-3 shrink-0">
            <div className="h-7 w-7 rounded-md bg-primary/12 text-primary flex items-center justify-center">
              <Hash className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold">Agency chat</p>
              <p className="text-[10.5px] text-muted-foreground flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {onlineUsers.length} online · everyone on the team
              </p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-60">
                <Hash className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-[13px] text-muted-foreground">No messages yet — say hi.</p>
              </div>
            ) : (
              <>
                {messages.map((msg: any, i) => {
                  const date = new Date(msg.createdAt);
                  const prev = i > 0 ? new Date(messages[i-1].createdAt) : null;
                  const showDivider = !prev || format(prev,'yyyy-MM-dd') !== format(date,'yyyy-MM-dd');
                  const isMine = msg.senderId === user?.id;
                  return (
                    <div key={msg._id || i}>
                      {showDivider && <DateDivider date={date} />}
                      <motion.div
                        initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-2 items-end mb-1 ${isMine ? 'flex-row-reverse' : ''}`}
                      >
                        <Avatar name={msg.senderName} size="xs" tone="primary" />
                        <div className={`max-w-[70%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                          {!isMine && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold">{msg.senderName}</span>
                              <span className="text-[9px] uppercase tracking-wider bg-muted text-muted-foreground px-1 py-0.5 rounded font-bold">
                                {msg.senderRole}
                              </span>
                            </div>
                          )}
                          <div className={`px-3 py-2 rounded-2xl text-[13px] leading-snug ${
                            isMine
                              ? 'bg-primary text-primary-foreground rounded-br-sm'
                              : 'bg-muted/60 text-foreground rounded-bl-sm'
                          }`}>
                            {msg.content}
                          </div>
                          <p className={`text-[10px] text-muted-foreground tabular-nums ${isMine ? 'text-right' : ''}`}>
                            {format(date, 'h:mm a')}
                          </p>
                        </div>
                      </motion.div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Mention dropdown */}
          <AnimatePresence>
            {showMentions && filteredUsers.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mx-4 mb-2 border border-border bg-card rounded-lg overflow-hidden shadow-xl"
              >
                {filteredUsers.slice(0, 5).map((u: any) => (
                  <button
                    key={u._id}
                    type="button"
                    onClick={() => insertMention(u.name || u.email)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/60 text-left"
                  >
                    <Avatar name={u.name} email={u.email} size="xs" tone="primary" />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold truncate">{u.name || u.email}</p>
                      <p className="text-[10px] text-muted-foreground capitalize truncate">{u.team || u.role}</p>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input */}
          <form onSubmit={sendMessage} className="px-3 pb-3 pt-2 border-t border-border shrink-0">
            <div className="flex items-center gap-2 bg-background border border-input rounded-lg px-2.5 h-10 focus-within:ring-2 focus-within:ring-ring transition-all">
              <button
                type="button"
                onClick={() => { setInput(p => p + '@'); inputRef.current?.focus(); setShowMentions(true); }}
                className="text-muted-foreground hover:text-primary transition-colors"
                title="Mention"
              >
                <AtSign className="h-3.5 w-3.5" />
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                placeholder="Type a message — use @ to mention"
                className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/50"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90"
                title="Send"
              >
                <Send className="h-3 w-3" />
              </button>
            </div>
          </form>
        </div>

        {/* Online roster */}
        <aside className="w-52 shrink-0 border border-border bg-card rounded-xl overflow-hidden hidden lg:flex flex-col">
          <div className="px-4 h-12 border-b border-border flex items-center">
            <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Online</p>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5">
            {onlineUsers.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70 text-center py-4">No one online</p>
            ) : (
              onlineUsers.map((u, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40 transition-colors">
                  <div className="relative">
                    <Avatar name={u.name} size="xs" tone="primary" />
                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-background" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-semibold truncate">{u.name}</p>
                    <p className="text-[9.5px] text-muted-foreground capitalize">{u.role}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </AppLayout>
  );
}
