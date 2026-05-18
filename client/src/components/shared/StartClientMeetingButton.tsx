import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Loader2, X, Copy, MessageCircle, Mail, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * StartClientMeetingButton — drop-anywhere button that creates an instant
 * external client meeting and shows the share link in a modal.
 *
 * Two flows from the modal:
 *   - "Open host page" → navigates to /meet/host/:slug (host joins the call)
 *   - "Copy / WhatsApp / Email" → share link with the prospect
 *
 * The link is sharable BEFORE the host joins — so the prospect can wait
 * in the meeting page and the host joins when ready.
 */

interface Props {
  /** When true, render as a compact icon-only button suited for topbars. */
  compact?: boolean;
}

export function StartClientMeetingButton({ compact = false }: Props = {}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [quickStarting, setQuickStarting] = useState(false);
  const [created, setCreated] = useState<{ slug: string; url: string; hostUrl: string; expiresAt: string } | null>(null);
  const [clientName, setClientName] = useState('');
  const [duration, setDuration] = useState(120);

  const reset = () => { setCreated(null); setClientName(''); setDuration(120); };

  /**
   * Quick-start path — one click, no modal. Creates a default 2-hour
   * meeting and jumps straight to the host room. Link is also copied to
   * clipboard so the host can share it as soon as they land in the room.
   *
   * Use case: in a call, need to spin up a meeting room RIGHT NOW. Skip
   * the modal — Robin can recover from a too-long name later via the
   * extend-meeting button in MeetHost.
   */
  const quickStart = async () => {
    setQuickStarting(true);
    try {
      const res = await api.clientMeetingsCreate({ durationMinutes: 120 });
      // Pre-copy the link so the host can paste it in chat immediately.
      try { await navigator.clipboard.writeText(res.url); } catch { /* ignore */ }
      toast.success('Meeting ready — link copied. Opening host room…');
      navigate(`/meet/host/${res.slug}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not create meeting');
    } finally {
      setQuickStarting(false);
    }
  };

  const create = async () => {
    setCreating(true);
    try {
      const res = await api.clientMeetingsCreate({ clientName, durationMinutes: duration });
      setCreated(res);
      toast.success('Meeting created — share the link with your client');
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not create meeting');
    } finally { setCreating(false); }
  };

  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.url); toast.success('Link copied'); }
    catch { toast.error('Could not copy'); }
  };

  const shareWhatsApp = () => {
    if (!created) return;
    const msg = `Hi ${clientName || 'there'} — join my live meeting: ${created.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };
  const shareEmail = () => {
    if (!created) return;
    const subject = `Live meeting link`;
    const body = `Hi,%0D%0A%0D%0AHere's the link to join the meeting: ${encodeURIComponent(created.url)}%0D%0A%0D%0AThanks.`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${body}`, '_blank');
  };

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); reset(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Two-tier button: PRIMARY action is quick-start (one tap → live
          meeting). SECONDARY action (the ⚙ icon) opens the modal for
          when the user wants to pick a duration / pre-fill a client name. */}
      <div className={`inline-flex rounded-lg shadow-sm overflow-hidden ${compact ? '' : 'h-9'}`}>
        <button
          onClick={quickStart}
          disabled={quickStarting}
          title="One-tap: create a 2-hour meeting and open the host room"
          className={`flex items-center gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-semibold ${
            compact ? 'h-8 px-2.5 text-[11px]' : 'h-9 px-3 text-xs'
          }`}
        >
          {quickStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          {compact ? 'Meeting' : 'Start client meeting'}
        </button>
        <button
          onClick={() => setOpen(true)}
          title="Open with options (set client name, duration)"
          className={`bg-primary/80 text-primary-foreground hover:bg-primary/70 border-l border-white/15 px-2 flex items-center justify-center ${
            compact ? 'h-8' : 'h-9'
          }`}
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-90" />
        </button>
      </div>

      {open && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={() => { setOpen(false); reset(); }}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base">Instant client meeting</h3>
                <p className="text-[11px] text-muted-foreground">No app, no signup — share the link, they join.</p>
              </div>
              <button onClick={() => { setOpen(false); reset(); }} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>

            {!created ? (
              <>
                <div>
                  <label className="text-[10px] uppercase font-semibold text-muted-foreground">Client name (optional)</label>
                  <input
                    autoFocus
                    value={clientName}
                    onChange={e => setClientName(e.target.value)}
                    placeholder="e.g., Acme Corp"
                    className="w-full mt-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-semibold text-muted-foreground">Max duration</label>
                  <select
                    value={duration}
                    onChange={e => setDuration(Number(e.target.value))}
                    className="w-full mt-1 px-2.5 py-2 bg-background border border-input rounded-lg text-sm"
                  >
                    <option value={30}>30 min</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours (recommended)</option>
                    <option value={240}>4 hours</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">You can extend by 30 min anytime during the call.</p>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={() => { setOpen(false); reset(); }} className="px-3 py-2 rounded-lg text-sm hover:bg-muted">Cancel</button>
                  <button
                    onClick={create}
                    disabled={creating}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    Create meeting
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-muted/30 p-3 text-[11px] text-muted-foreground">
                  Link expires <strong className="text-foreground">{new Date(created.expiresAt).toLocaleString('en-IN')}</strong>
                </div>
                <div className="flex items-center gap-2 bg-background border border-input rounded-lg p-2">
                  <code className="flex-1 text-[11px] truncate">{created.url}</code>
                  <button onClick={copy} className="h-7 px-2 flex items-center gap-1 rounded bg-primary/15 text-primary hover:bg-primary/25 text-xs font-semibold">
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={shareWhatsApp} className="h-10 flex items-center justify-center gap-1.5 rounded-lg bg-green-500/15 text-green-700 border border-green-500/30 hover:bg-green-500/25 text-sm font-semibold">
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </button>
                  <button onClick={shareEmail} className="h-10 flex items-center justify-center gap-1.5 rounded-lg bg-blue-500/15 text-blue-700 border border-blue-500/30 hover:bg-blue-500/25 text-sm font-semibold">
                    <Mail className="h-4 w-4" /> Email
                  </button>
                </div>
                <button
                  onClick={() => { setOpen(false); navigate(`/meet/host/${created.slug}`); }}
                  className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-primary/90"
                >
                  Open host room <ArrowRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default StartClientMeetingButton;
