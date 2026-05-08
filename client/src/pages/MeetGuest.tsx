import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Mic, MicOff, Monitor, MonitorOff, PhoneOff, Loader2, AlertCircle,
  Users as UsersIcon, Bird,
} from 'lucide-react';
import {
  Room, RoomEvent, Track, RemoteParticipant, RemoteTrackPublication, ConnectionState,
} from 'livekit-client';
import * as api from '@/api';

/**
 * MeetGuest — public read-only page that lets an external prospect join
 * a Robin huddle via a shared link. No login, no sidebar, no Robin nav.
 *
 * Flow:
 *   1. Fetch /meet/:slug → agency label + status
 *   2. User types their name → "Join meeting"
 *   3. Mint guest LiveKit token → connect to the unique room
 *   4. Mic + Screen-share controls only (no chat data, no admin)
 *
 * Branding: agency name on top ("Hastag Agency"), small "Powered by Robin"
 * footer. Designed so the prospect never sees Robin's app surface — they
 * see your agency's tool.
 */

interface MeetingInfo {
  slug: string;
  agencyLabel: string;
  clientName?: string;
  status: 'scheduled' | 'active' | 'ended' | 'expired';
  expiresAt: string;
}

interface RemotePeer {
  identity: string;
  name: string;
  role: 'host' | 'guest';
  audioOn: boolean;
  screenOn: boolean;
  audioStream?: MediaStream;
  screenStream?: MediaStream;
}

export default function MeetGuest() {
  const { slug } = useParams();
  const [info, setInfo] = useState<MeetingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const [peers, setPeers] = useState<Record<string, RemotePeer>>({});
  const [audioOn, setAudioOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);

  // Load meeting info on mount
  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const data = await api.clientMeetingsPublicInfo(slug);
        setInfo(data);
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Could not load meeting');
        setErrorCode(e?.response?.status || null);
      }
    })();
  }, [slug]);

  const buildPeerView = (p: RemoteParticipant): RemotePeer => {
    const audio = new MediaStream();
    const screen = new MediaStream();
    let audioOn = false;
    let screenOn = false;
    p.audioTrackPublications.forEach(pub => {
      if (pub.track && pub.isSubscribed) {
        if (pub.track.mediaStreamTrack) audio.addTrack(pub.track.mediaStreamTrack);
        if (!pub.isMuted) audioOn = true;
      }
    });
    p.videoTrackPublications.forEach(pub => {
      if (pub.source === Track.Source.ScreenShare && pub.track && pub.isSubscribed) {
        if (pub.track.mediaStreamTrack) screen.addTrack(pub.track.mediaStreamTrack);
        screenOn = true;
      }
    });
    let role: 'host' | 'guest' = 'guest';
    try {
      if (p.metadata) role = JSON.parse(p.metadata).role || 'guest';
    } catch {}
    return {
      identity: p.identity,
      name: p.name || 'Teammate',
      role,
      audioOn,
      screenOn,
      audioStream: audio.getAudioTracks().length ? audio : undefined,
      screenStream: screen.getVideoTracks().length ? screen : undefined,
    };
  };

  const refreshPeer = (p: RemoteParticipant) => {
    setPeers(prev => ({ ...prev, [p.identity]: buildPeerView(p) }));
  };
  const dropPeer = (identity: string) => {
    setPeers(prev => { const n = { ...prev }; delete n[identity]; return n; });
  };

  const join = async () => {
    if (!slug || !name.trim()) return;
    setJoining(true);
    try {
      const t = await api.clientMeetingsGuestToken(slug, name.trim());
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room
        .on(RoomEvent.ParticipantConnected,    refreshPeer)
        .on(RoomEvent.ParticipantDisconnected, p => dropPeer(p.identity))
        .on(RoomEvent.TrackSubscribed,         (_t, _pub, p) => refreshPeer(p))
        .on(RoomEvent.TrackUnsubscribed,       (_t, _pub, p) => refreshPeer(p))
        .on(RoomEvent.TrackMuted,              (_pub, p) => p.isLocal ? null : refreshPeer(p as RemoteParticipant))
        .on(RoomEvent.TrackUnmuted,            (_pub, p) => p.isLocal ? null : refreshPeer(p as RemoteParticipant))
        .on(RoomEvent.Disconnected,            () => { setJoined(false); setPeers({}); });

      await room.connect(t.url, t.token);
      // Default mic on
      await room.localParticipant.setMicrophoneEnabled(true);
      setAudioOn(true);
      // Hydrate existing remote participants
      room.remoteParticipants.forEach(refreshPeer);
      setJoined(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not join the meeting');
    } finally {
      setJoining(false);
    }
  };

  const toggleMic = async () => {
    const room = roomRef.current; if (!room) return;
    const next = !audioOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setAudioOn(next);
  };
  const toggleScreen = async () => {
    const room = roomRef.current; if (!room) return;
    const next = !screenOn;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenOn(next);
    } catch { /* user cancelled the picker */ }
  };
  const leave = () => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    setJoined(false);
    setPeers({});
  };

  // ── Render states ──────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-amber-500 mx-auto" />
          <h1 className="text-lg font-bold">{errorCode === 410 ? 'Meeting unavailable' : 'Cannot load meeting'}</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-[11px] text-muted-foreground">Ask the host to send a fresh link.</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  // Pre-join screen
  if (!joined) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header agencyLabel={info.agencyLabel} />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 space-y-4 shadow-xl">
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-primary">{info.agencyLabel} invites you to a meeting</p>
              <h2 className="text-xl font-bold mt-1">{info.clientName || 'Live meeting'}</h2>
              <p className="text-xs text-muted-foreground mt-1">Voice + screen-share. No app to install.</p>
            </div>
            <div>
              <label className="text-[11px] uppercase font-semibold text-muted-foreground">Your name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Priya from Acme"
                onKeyDown={e => e.key === 'Enter' && join()}
                className="w-full mt-1 px-3 py-2.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>
            <button
              onClick={join}
              disabled={joining || !name.trim()}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50"
            >
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              {joining ? 'Joining…' : 'Join meeting'}
            </button>
            <p className="text-[10px] text-muted-foreground text-center">Your browser may ask for microphone permission. That's expected.</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // In-meeting screen
  const peerArr = Object.values(peers);
  const screenSharers = peerArr.filter(p => p.screenOn && p.screenStream);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header agencyLabel={info.agencyLabel} live participantCount={peerArr.length + 1} />

      <main className="flex-1 max-w-5xl mx-auto w-full p-6 space-y-4">
        {/* Hidden audio elements for each peer */}
        {peerArr.map(p => p.audioStream && <RemoteAudio key={`a-${p.identity}`} stream={p.audioStream} />)}

        {/* Screen shares */}
        {screenSharers.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {screenSharers.map(p => (
              <ScreenView key={p.identity} name={p.name} stream={p.screenStream!} />
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl py-12 text-center">
            <UsersIcon className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-sm font-semibold">{peerArr.length === 0 ? 'Waiting for the host to join…' : `Connected with ${peerArr.length} ${peerArr.length === 1 ? 'person' : 'people'}`}</p>
            <p className="text-xs text-muted-foreground mt-1">Use the controls below to share your screen.</p>
          </div>
        )}

        {/* Participants */}
        <div className="bg-card border border-border rounded-2xl p-3 flex flex-wrap gap-2">
          <ParticipantPill name={`You (${name})`} mic={audioOn} screen={screenOn} self />
          {peerArr.map(p => (
            <ParticipantPill key={p.identity} name={p.name} mic={p.audioOn} screen={p.screenOn} role={p.role} />
          ))}
        </div>
      </main>

      {/* Bottom controls */}
      <div className="border-t border-border bg-card sticky bottom-0">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-center gap-3">
          <Control on={audioOn} OnIcon={Mic} OffIcon={MicOff} onClick={toggleMic} tone={audioOn ? 'good' : 'danger'} label={audioOn ? 'Mute' : 'Unmute'} />
          <Control on={screenOn} OnIcon={MonitorOff} OffIcon={Monitor} onClick={toggleScreen} tone={screenOn ? 'primary' : 'neutral'} label={screenOn ? 'Stop sharing' : 'Share screen'} />
          <button onClick={leave} className="ml-2 h-10 px-4 rounded-xl bg-red-500 text-white font-semibold flex items-center gap-1.5 hover:bg-red-600">
            <PhoneOff className="h-4 w-4" /> Leave
          </button>
        </div>
      </div>

      <Footer />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function Header({ agencyLabel, live, participantCount }: { agencyLabel: string; live?: boolean; participantCount?: number }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-primary/15 flex items-center justify-center">
          <Bird className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase font-semibold tracking-wide text-primary">{agencyLabel}</p>
          <p className="text-sm font-bold leading-tight">Live Meeting</p>
        </div>
        {live && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 text-red-600 text-[11px] font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            LIVE · {participantCount} in
          </span>
        )}
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-2 text-center text-[10px] text-muted-foreground">
      Powered by Robin · Read-only secure meeting link
    </footer>
  );
}

function Control({ on, OnIcon, OffIcon, onClick, tone, label }: { on: boolean; OnIcon: any; OffIcon: any; onClick: () => void; tone: 'good' | 'danger' | 'primary' | 'neutral'; label: string }) {
  const Icon = on ? OnIcon : OffIcon;
  const cls =
    tone === 'good'    ? 'bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/25' :
    tone === 'danger'  ? 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/25'    :
    tone === 'primary' ? 'bg-primary/15 text-primary border-primary/30 hover:bg-primary/25'    :
                         'bg-card text-foreground border-border hover:bg-muted';
  return (
    <button onClick={onClick} className={`h-10 px-4 rounded-xl border flex items-center gap-1.5 text-sm font-semibold ${cls}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function ParticipantPill({ name, mic, screen, self, role }: { name: string; mic?: boolean; screen?: boolean; self?: boolean; role?: 'host' | 'guest' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
      self ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted text-foreground border-border'
    }`}>
      <span className="truncate">{name}</span>
      {role === 'host' && <span className="text-[9px] uppercase text-primary/70">host</span>}
      {mic ? <Mic className="h-3 w-3 text-green-600" /> : <MicOff className="h-3 w-3 text-red-500" />}
      {screen && <Monitor className="h-3 w-3 text-primary" />}
    </span>
  );
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {/* autoplay may be blocked until user gesture */});
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />;
}

function ScreenView({ name, stream }: { name: string; stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className="relative bg-black rounded-xl overflow-hidden aspect-video border border-border">
      <video ref={ref} autoPlay playsInline muted className="w-full h-full object-contain" />
      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-[11px] font-semibold flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
        {name}
      </div>
    </div>
  );
}
