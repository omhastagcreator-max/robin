import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import {
  Mic, MicOff, Monitor, MonitorOff, PhoneOff, Loader2, AlertCircle,
  Users as UsersIcon, Copy, MessageCircle, Mail, Clock, Plus,
  Maximize2, Minimize2,
} from 'lucide-react';
import {
  Room, RoomEvent, Track, RemoteParticipant, RemoteTrackPublication,
} from 'livekit-client';
import { toast } from 'sonner';
import * as api from '@/api';

/**
 * MeetHost — host's view of a client meeting. Same room as MeetGuest,
 * but mounted inside Robin (with sidebar) and with a side panel showing
 * the share link, audit (who's joined), and host actions (extend, end).
 */

export default function MeetHost() {
  const { slug } = useParams();
  const [meeting, setMeeting] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const [peers, setPeers] = useState<Record<string, any>>({});
  const [audioOn, setAudioOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);

  // Fetch meeting metadata (must be the host) and join room
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      setJoining(true);
      try {
        // Mint host token (proves ownership server-side)
        const t = await api.clientMeetingsHostToken(slug);
        if (cancelled) return;
        const list = await api.clientMeetingsMine();
        const m = list.find((x: any) => x.slug === slug);
        setMeeting(m);

        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        const buildPeer = (p: RemoteParticipant) => {
          const audio = new MediaStream();
          const screen = new MediaStream();
          let aOn = false; let sOn = false;
          p.audioTrackPublications.forEach(pub => {
            if (pub.track && pub.isSubscribed) {
              if (pub.track.mediaStreamTrack) audio.addTrack(pub.track.mediaStreamTrack);
              if (!pub.isMuted) aOn = true;
            }
          });
          p.videoTrackPublications.forEach(pub => {
            if (pub.source === Track.Source.ScreenShare && pub.track && pub.isSubscribed) {
              if (pub.track.mediaStreamTrack) screen.addTrack(pub.track.mediaStreamTrack);
              sOn = true;
            }
          });
          let role: 'host' | 'guest' = 'guest';
          try { if (p.metadata) role = JSON.parse(p.metadata).role || 'guest'; } catch {}
          return {
            identity: p.identity,
            name: p.name || 'Guest',
            role,
            audioOn: aOn,
            screenOn: sOn,
            audioStream: audio.getAudioTracks().length ? audio : undefined,
            screenStream: screen.getVideoTracks().length ? screen : undefined,
          };
        };
        const refreshPeer = (p: RemoteParticipant) => setPeers(prev => ({ ...prev, [p.identity]: buildPeer(p) }));
        const dropPeer   = (id: string)            => setPeers(prev => { const n = { ...prev }; delete n[id]; return n; });

        room
          .on(RoomEvent.ParticipantConnected,    refreshPeer)
          .on(RoomEvent.ParticipantDisconnected, p => dropPeer(p.identity))
          .on(RoomEvent.TrackSubscribed,         (_t, _pub, p) => refreshPeer(p))
          .on(RoomEvent.TrackUnsubscribed,       (_t, _pub, p) => refreshPeer(p))
          .on(RoomEvent.TrackMuted,              (_pub, p) => p.isLocal ? null : refreshPeer(p as RemoteParticipant))
          .on(RoomEvent.TrackUnmuted,            (_pub, p) => p.isLocal ? null : refreshPeer(p as RemoteParticipant))
          .on(RoomEvent.Disconnected,            () => { setJoined(false); setPeers({}); });

        await room.connect(t.url, t.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        setAudioOn(true);
        room.remoteParticipants.forEach(refreshPeer);
        setJoined(true);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.response?.data?.error || e?.message || 'Could not join the meeting');
      } finally {
        if (!cancelled) setJoining(false);
      }
    })();
    return () => {
      cancelled = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [slug]);

  const toggleMic = async () => {
    const room = roomRef.current; if (!room) return;
    const next = !audioOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setAudioOn(next);
  };
  const toggleScreen = async () => {
    const room = roomRef.current; if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(!screenOn);
      setScreenOn(!screenOn);
    } catch { /* user cancelled the picker */ }
  };
  const endMeeting = async () => {
    if (!slug) return;
    if (!confirm('End this meeting now? Anyone still on the link will be disconnected.')) return;
    try {
      await api.clientMeetingsEnd(slug);
      roomRef.current?.disconnect();
      toast.success('Meeting ended');
      setJoined(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not end meeting');
    }
  };
  const extendMeeting = async () => {
    if (!slug) return;
    try {
      const r = await api.clientMeetingsExtend(slug);
      toast.success(`Extended — duration cap is now ${r.maxDurationMinutes} min`);
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Could not extend'); }
  };

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
            {/* Hidden audio for each peer */}
            {Object.values(peers).map((p: any) => p.audioStream && (
              <RemoteAudio key={`a-${p.identity}`} stream={p.audioStream} />
            ))}

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

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />;
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
