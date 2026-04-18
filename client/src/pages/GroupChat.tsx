import { useState, useEffect, useRef, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Hash, Circle, Loader2, AtSign } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { format, isToday, isYesterday } from 'date-fns';
import * as api from '@/api';

const ROLE_COLORS: Record<string, string> = {
  admin:    'text-red-400    bg-red-500/10',
  employee: 'text-blue-400   bg-blue-500/10',
  sales:    'text-amber-400  bg-amber-500/10',
  client:   'text-green-400  bg-green-500/10',
};

function DateDivider({ date }: { date: Date }) {
  const label = isToday(date) ? 'Today' : isYesterday(date) ? 'Yesterday' : format(date, 'MMM d, yyyy');
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] text-muted-foreground px-2 bg-background">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

export default function GroupChat() {
  const { user } = useAuth();
  const socket = useSocket();
  const [messages, setMessages]   = useState<any[]>([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [allUsers, setAllUsers]   = useState<any[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const ROOM = 'agency-global';

  // Load history
  useEffect(() => {
    api.getChatHistory({ roomId: ROOM, limit: 60 })
      .then(d => { setMessages(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
    api.listUsers().then(d => setAllUsers(Array.isArray(d) ? d : []));
  }, []);

  // Socket events
  useEffect(() => {
    if (!socket) return;
    socket.emit('chat:join', { roomId: ROOM });
    socket.on('chat:message', (msg: any) => {
      setMessages(prev => [...prev, msg]);
    });
    socket.on('presence:update', (users: any[]) => {
      setOnlineUsers(users);
    });
    return () => {
      socket.off('chat:message');
      socket.off('presence:update');
    };
  }, [socket]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const extractMentions = (text: string) => {
    const names = allUsers.map((u: any) => u.name || u.email);
    return allUsers
      .filter((u: any) => text.includes(`@${u.name || u.email}`))
      .map((u: any) => u._id);
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;
    const mentions = extractMentions(input);
    socket.emit('chat:message', { roomId: ROOM, content: input.trim(), type: 'text', mentions });
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
    } else { setShowMentions(false); }
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

  // Group messages by date
  const grouped: { date: Date; msg: any }[] = messages.map(m => ({
    date: new Date(m.createdAt),
    msg: m,
  }));

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto flex gap-5 h-[calc(100vh-8rem)] page-transition-enter">
        {/* Main chat panel */}
        <div className="flex-1 flex flex-col bg-card border border-border rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-border flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-primary/20 flex items-center justify-center">
              <Hash className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">Agency Chat</p>
              <p className="text-xs text-muted-foreground">{onlineUsers.length} online · All team members</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
                <Hash className="h-10 w-10" />
                <p className="text-sm">No messages yet — say hi! 👋</p>
              </div>
            ) : (
              <>
                {grouped.map(({ date, msg }, i) => {
                  const prev = i > 0 ? new Date(grouped[i-1].date) : null;
                  const showDivider = !prev || format(prev,'yyyy-MM-dd') !== format(date,'yyyy-MM-dd');
                  const isMine = msg.senderId === user?.id;
                  const colorClass = ROLE_COLORS[msg.senderRole] || 'text-muted-foreground bg-muted';
                  return (
                    <div key={msg._id || i}>
                      {showDivider && <DateDivider date={date} />}
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-2.5 items-end mb-1 ${isMine ? 'flex-row-reverse' : ''}`}>
                        {/* Avatar */}
                        <div className={`h-7 w-7 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${colorClass}`}>
                          {(msg.senderName || '?')[0].toUpperCase()}
                        </div>
                        <div className={`max-w-[70%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                          {!isMine && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-semibold">{msg.senderName}</span>
                              <span className={`text-[8px] px-1 py-0.5 rounded font-bold uppercase ${colorClass}`}>{msg.senderRole}</span>
                            </div>
                          )}
                          <div className={`px-3 py-2 rounded-2xl text-sm ${isMine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted/60 text-foreground rounded-bl-sm'}`}>
                            {msg.content}
                          </div>
                          <p className={`text-[9px] text-muted-foreground ${isMine ? 'text-right' : ''}`}>
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
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mx-4 mb-2 bg-popover border border-border rounded-xl overflow-hidden shadow-xl">
                {filteredUsers.slice(0, 5).map((u: any) => (
                  <button key={u._id} type="button" onClick={() => insertMention(u.name || u.email)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-left">
                    <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${ROLE_COLORS[u.role] || 'bg-muted text-muted-foreground'}`}>
                      {(u.name || u.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-medium">{u.name || u.email}</p>
                      <p className="text-[10px] text-muted-foreground capitalize">{u.team || u.role}</p>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input */}
          <form onSubmit={sendMessage} className="px-4 pb-4 pt-2 border-t border-border">
            <div className="flex items-center gap-2 bg-background border border-input rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-ring transition-all">
              <button type="button" onClick={() => { setInput(p => p + '@'); inputRef.current?.focus(); setShowMentions(true); }}
                className="text-muted-foreground hover:text-primary transition-colors">
                <AtSign className="h-4 w-4" />
              </button>
              <input ref={inputRef} value={input} onChange={handleInputChange} placeholder="Type a message… use @ to mention"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50" />
              <button type="submit" disabled={!input.trim()}
                className="h-7 w-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-all">
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        </div>

        {/* Online sidebar */}
        <div className="w-48 shrink-0 bg-card border border-border rounded-2xl overflow-hidden hidden lg:flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Online</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {onlineUsers.map((u, i) => {
              const colorClass = ROLE_COLORS[u.role] || 'text-muted-foreground bg-muted';
              return (
                <div key={i} className="flex items-center gap-2">
                  <div className="relative">
                    <div className={`h-7 w-7 rounded-xl flex items-center justify-center text-[10px] font-bold ${colorClass}`}>
                      {(u.name || '?')[0].toUpperCase()}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 border border-background" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium truncate">{u.name}</p>
                    <p className="text-[9px] text-muted-foreground capitalize">{u.role}</p>
                  </div>
                </div>
              );
            })}
            {onlineUsers.length === 0 && <p className="text-xs text-muted-foreground/40 text-center pt-4">No one online</p>}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
