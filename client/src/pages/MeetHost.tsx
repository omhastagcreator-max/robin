import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import {
  Mic, MicOff, Monitor, MonitorOff, PhoneOff, Loader2, AlertCircle,
  Users as UsersIcon, Copy, MessageCircle, Mail, Plus,
  Maximize2, Minimize2, Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useClientMeeting } from '@/contexts/ClientMeetingContext';

/**
 * MeetHost — thin view that reads the live LiveKit room from
 * ClientMeetingContext. The room itself lives in the provider (mounted
 * at App level) so navigating away from this page no longer kicks the
 * host out of the meeting. Audio elements are rendered via a portal
 * inside the provider, so they keep playing across route changes too.
 */
export default function MeetHost() {
  const { slug } = useParams();
  const {
    meeting, peers, audioOn, screenOn, joined, joining, error, audioBlocked,
    joinAs, toggleMic, toggleScreen, endMeeting, extendMeeting, unblockAudio,
  } = useClientMeeting();

  // Idempotent join — if the user navigates back into MeetHost with a
  // different slug, the provider tears down the old room and connects to
  // the new one. Same slug = no-op, the existing connection is reused.
  useEffect(() => {
    if (!slug) return;
    joinAs(slug);
    // Intentionally no cleanup that calls leave() — that would re-create
    // the original bug. Leaving the meeting is an explicit user action
    // (End meeting button), not a side effect of navigation.
  }, [slug, joinAs]);

  const guestUrl = meeting ? `${window.location.origin}/meet/${meeting.slug}` : '';
  const copyLink = async () => {
    if (!guestUrl) return;
    try { await navigator.clipboard.writeText(guestUrl); toast.success('Link copied'); }
    catch { toast.error('Could not copy'); }
  };
  const shareWhatsApp = () => {
    if (!guestUrl) return;
    const msg = `Hi! Join my live meeting: ${guestUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };
  const shareEmail = () => {
    if (!guestUrl) return;
    const subject = `Live meeting link`;
    const body = `Hi,%0D%0A%0D%0AHere's the link to join the meeting: ${encodeURIComponent(guestUrl)}%0D%0A%0D%0AThanks.`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${body}`, '_blank');
  };

  if (error) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto py-12 text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-amber-500 mx-auto" />
          <p className="text-sm font-semibold">Cannot start meeting</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Link to="/dashboard" className="text-xs text-primary hover:underline">Back to dashboard</Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4 page-transition-enter">
        {/* Audio-blocked banner — Chrome refused to autoplay the guest's
            voice until a user gesture is provided. One click unlocks it. */}
        {audioBlocked && joined && (
          <button onClick={unblockAudio}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 px-4 py-2.5 text-sm font-semibold hover:bg-amber-500/20">
            <Volume2 className="h-4 w-4" /> Click to enable audio (browser blocked autoplay)
          </button>
        )}

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Client meeting</h1>
            <p className="text-sm text-muted-foreground">
              {meeting?.clientName ? `with ${meeting.clientName}` : 'Live meeting room'}
              {meeting?.maxDurationMinutes && <span> · cap {meeting.maxDurationMinutes} min</span>}
            </p>
          </div>
          {joined && (
            <div className="flex items-center gap-2">
              <button onClick={extendMeeting} className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-semibold">
                <Plus className="h-3.5 w-3.5" /> +30 min
              </button>
              <button onClick={endMeeting} className="h-9 px-3 flex items-center gap-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600">
                <PhoneOff className="h-3.5 w-3.5" /> End meeting
              </button>
            </div>
          )}
        </div>

        {/* Share link panel */}
        {guestUrl && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <UsersIcon className="h-3.5 w-3.5 text-primary" /> Share this link with your client
            </p>
            <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-lg p-2">
              <code className="flex-1 text-xs truncate">{guestUrl}</code>
              <button onClick={copyLink} className="h-7 px-2 flex items-center gap-1 rounded bg-primary/15 text-primary hover:bg-primary/25 text-xs font-semibold">
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={shareWhatsApp} className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg bg-green-500/15 text-green-700 border border-green-500/30 hover:bg-green-500/25 text-xs font-semibold">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </button>
              <button onClick={shareEmail} className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg bg-blue-500/15 text-blue-700 border border-blue-500/30 hover:bg-blue-500/25 text-xs font-semibold">
                <Mail className="h-3.5 w-3.5" /> Email
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              You can switch to any other page in Robin without disconnecting — the meeting keeps running in the background.
            </p>
          </div>
        )}

        {/* Status / connecting */}
        {joining && !joined && (
          <div className="bg-card border border-border rounded-2xl py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
            <p className="text-sm font-semibold mt-2">Connecting…</p>
          </div>
        )}

        {/* In-meeting view */}
        {joined && (
          <>
            {/* Audio elements are rendered by the provider via portal —
                they survive route changes. No <RemoteAudio> here. */}

            {/* Screen shares */}
            {Object.values(peers).filter((p: any) => p.screenOn && p.screenStream).length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {Object.values(peers).filter((p: any) => p.screenOn && p.screenStream).map((p: any) => (
                  <ScreenTile key={p.identity} name={p.name} stream={p.screenStream} />
                ))}
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl py-10 text-center">
                <p className="text-sm font-semibold">{Object.keys(peers).length === 0 ? 'Waiting for the client to join…' : 'In meeting'}</p>
                <p className="text-xs text-muted-foreground mt-1">Share the link above so your client can join.</p>
              </div>
            )}

            {/* Participants */}
            <div className="bg-card border border-border rounded-2xl p-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/30">
                You · {audioOn ? <Mic className="h-3 w-3 text-green-600" /> : <MicOff className="h-3 w-3 text-red-500" />}
                {screenOn && <Monitor className="h-3 w-3 text-primary" />}
              </span>
              {Object.values(peers).map((p: any) => (
                <span key={p.identity} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-muted text-foreground border border-border">
                  {p.name}
                  {p.audioOn ? <Mic className="h-3 w-3 text-green-600" /> : <MicOff className="h-3 w-3 text-red-500" />}
                  {p.screenOn && <Monitor className="h-3 w-3 text-primary" />}
                </span>
              ))}
            </div>

            {/* Controls */}
            <div className="bg-card border border-border rounded-2xl p-3 flex items-center justify-center gap-3">
              <button onClick={toggleMic} className={`h-10 px-4 rounded-xl border flex items-center gap-1.5 text-sm font-semibold ${audioOn ? 'bg-green-500/15 text-green-700 border-green-500/30' : 'bg-red-500/15 text-red-600 border-red-500/30'}`}>
                {audioOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />} {audioOn ? 'Mute' : 'Unmute'}
              </button>
              <button onClick={toggleScreen} className={`h-10 px-4 rounded-xl border flex items-center gap-1.5 text-sm font-semibold ${screenOn ? 'bg-primary/15 text-primary border-primary/30' : 'bg-card border-border'}`}>
                {screenOn ? <MonitorOff className="h-4 w-4" /> : <Monitor className="h-4 w-4" />} {screenOn ? 'Stop sharing' : 'Share screen'}
              </button>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function ScreenTile({ name, stream }: { name: string; stream: MediaStream }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  useEffect(() => {
    const onChange = () => setIsFs(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFs = async () => {
    const el = wrapRef.current; if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* user gesture / unsupported */ }
  };
  return (
    <div ref={wrapRef} className={`relative bg-black rounded-xl overflow-hidden border border-border group ${isFs ? '' : 'aspect-video'}`}>
      <video ref={ref} autoPlay playsInline muted className="w-full h-full object-contain" />
      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-[11px] font-semibold">{name}</div>
      <button
        onClick={toggleFs}
        title={isFs ? 'Exit full screen' : 'Full screen'}
        className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        {isFs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
