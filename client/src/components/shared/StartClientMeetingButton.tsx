import { useState, useEffect } from 'react';
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

export function StartClientMeetingButton() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ slug: string; url: string; hostUrl: string; expiresAt: string } | null>(null);
  const [clientName, setClientName] = useState('');
  const [duration, setDuration] = useState(120);

  const reset = () => { setCreated(null); setClientName(''); setDuration(120); };

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
      <button
        onClick={() => setOpen(true)}
        className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shadow-sm"
      >
        <UserPlus className="h-3.5 w-3.5" /> Start client meeting
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setOpen(false); reset(); }}>
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
        </div>
      )}
    </>
  );
}

export default StartClientMeetingButton;
