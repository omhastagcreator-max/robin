import { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  Video, VideoOff, Monitor, MonitorOff, Mic, MicOff, Users, Loader2,
  PhoneOff, PhoneCall, ScreenShare, ScreenShareOff,
} from 'lucide-react';
import { useScreenShare } from '@/contexts/ScreenShareContext';
import { useWebRTCReceiver } from '@/hooks/useWebRTC';
import { useMeetingRoom, type PeerView } from '@/hooks/useMeetingRoom';
import * as api from '@/api';

/**
 * WorkRoom — fully in-app meeting + screen-monitor.
 *
 *   • Section 1: Live Meeting — multi-party video/audio/screen room.
 *                Anyone (admin/employee/sales) can join, see each other,
 *                toggle camera/mic, and share their screen.
 *
 *   • Section 2: Live Screens — passive monitor list of who's broadcasting
 *                their screen via the legacy 1:1 ScreenShareContext flow.
 *                Any internal staff member can click "View" to peek.
 */
export default function WorkRoom() {
  const { user, role } = useAuth();
  const isInternal = role === 'admin' || role === 'employee' || role === 'sales';

  // ── Live Meeting ─────────────────────────────────────────────────────────
  const meeting = useMeetingRoom({
    userId:   user?.id || '',
    userName: user?.name,
    userRole: role,
    roomId:   'agency-global',
  });

  // Local self-preview
  const localVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && meeting.localStream) el.srcObject = meeting.localStream;
  }, [meeting.localStream]);

  // ── Legacy screen-monitor list (anyone can peek) ─────────────────────────
  const { isSharing, startSharing, stopSharing } = useScreenShare();
  const { remoteStreams, connectingTo, viewScreen, stopViewing } = useWebRTCReceiver(user?.id || '');
  const [screenSessions, setScreenSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [viewingUser, setViewingUser] = useState<string | null>(null);

  const monitorVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && viewingUser && remoteStreams[viewingUser]) el.srcObject = remoteStreams[viewingUser];
  }, [remoteStreams, viewingUser]);

  const loadSessions = async () => {
    try {
      const data = await api.listScreenSessions();
      setScreenSessions(Array.isArray(data) ? data : []);
    } finally { setLoadingSessions(false); }
  };

  useEffect(() => {
    if (!isInternal) { setLoadingSessions(false); return; }
    loadSessions();
    const i = setInterval(loadSessions, 10000);
    return () => clearInterval(i);
  }, [isInternal]);

  const handlePeek = (targetId: string) => {
    if (viewingUser === targetId) { stopViewing(targetId); setViewingUser(null); return; }
    setViewingUser(targetId);
    viewScreen(targetId);
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 page-transition-enter">
        <div>
          <h1 className="text-2xl font-bold">Work Room</h1>
          <p className="text-sm text-muted-foreground">In-app video meetings &amp; live screen monitor — everything in one tab.</p>
        </div>

        {/* ── LIVE MEETING ─────────────────────────────────────────────── */}
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Video className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Live Meeting</h2>
            {meeting.joined && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-green-500">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Live · {meeting.peers.length + 1} participant{meeting.peers.length === 0 ? '' : 's'}
              </span>
            )}
          </div>

          {!meeting.joined ? (
            <div className="p-8 flex flex-col items-center justify-center gap-4 text-center">
              <div className="h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center">
                <PhoneCall className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-base">Join the team meeting</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  Camera, mic and screen-share — all in this tab. Anyone in the agency can join.
                </p>
              </div>
              {meeting.error && (
                <p className="text-xs text-red-400 max-w-sm">{meeting.error}</p>
              )}
              <button
                onClick={meeting.joinMeeting}
                disabled={meeting.joining}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
              >
                {meeting.joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                {meeting.joining ? 'Joining…' : 'Join meeting'}
              </button>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Tile grid: self + peers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Self tile */}
                <div className="relative bg-black rounded-xl overflow-hidden aspect-video border border-border group">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover bg-black"
                  />
                  {!meeting.videoOn && !meeting.screenOn && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                      <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center text-2xl font-bold text-primary">
                        {(user?.name || user?.email || '?')[0].toUpperCase()}
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <span className="text-xs px-2 py-0.5 bg-black/60 backdrop-blur rounded-md text-white font-medium">
                      You {meeting.screenOn && '· sharing screen'}
                    </span>
                    <div className="flex items-center gap-1">
                      {!meeting.audioOn && (
                        <span className="h-5 w-5 rounded-full bg-red-500/80 flex items-center justify-center">
                          <MicOff className="h-3 w-3 text-white" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Peer tiles */}
                {meeting.peers.map(p => <PeerTile key={p.userId} peer={p} />)}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                <ControlButton
                  on={meeting.audioOn}
                  onLabel="Mute"
                  offLabel="Unmute"
                  IconOn={Mic}
                  IconOff={MicOff}
                  onClick={meeting.toggleAudio}
                />
                <ControlButton
                  on={meeting.videoOn}
                  onLabel="Stop video"
                  offLabel="Start video"
                  IconOn={Video}
                  IconOff={VideoOff}
                  onClick={meeting.toggleVideo}
                />
                <ControlButton
                  on={meeting.screenOn}
                  onLabel="Stop sharing"
                  offLabel="Share screen"
                  IconOn={ScreenShareOff}
                  IconOff={ScreenShare}
                  onClick={meeting.toggleScreen}
                  highlight
                />
                <button
                  onClick={meeting.leaveMeeting}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-full text-sm font-medium hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 ml-2"
                >
                  <PhoneOff className="h-4 w-4" /> Leave
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── LIVE SCREENS (passive monitor) ──────────────────────────── */}
        {isInternal && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Live Screens</h2>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {screenSessions.filter(s => s.status === 'active').length} broadcasting
              </span>
            </div>

            {/* Self share toggle (employee/sales/admin) */}
            <div className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3 flex-wrap">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${isSharing ? 'bg-green-500/20' : 'bg-muted'}`}>
                {isSharing
                  ? <Monitor className="h-5 w-5 text-green-400" />
                  : <MonitorOff className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">
                  {isSharing ? 'Your screen is broadcasting' : 'Broadcast your screen'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isSharing
                    ? 'Anyone in the team can peek at your screen from this page'
                    : 'Make your screen visible to teammates without joining a meeting'}
                </p>
              </div>
              {isSharing ? (
                <button onClick={stopSharing}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl text-sm font-medium hover:bg-red-500/25 transition-all">
                  <MonitorOff className="h-4 w-4" /> Stop
                </button>
              ) : (
                <button onClick={startSharing}
                  className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/30 rounded-xl text-sm font-medium hover:bg-primary/20 transition-all">
                  <Monitor className="h-4 w-4" /> Broadcast
                </button>
              )}
            </div>

            {loadingSessions ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : screenSessions.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-12 gap-3">
                <Users className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No teammates are broadcasting their screen right now</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {screenSessions.map(session => (
                  <motion.div
                    key={session._id || session.userId}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className={`bg-card border rounded-2xl p-4 space-y-3 transition-all ${
                      session.status === 'active' ? 'border-green-500/30' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                        {(session.profile?.name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{session.profile?.name || session.userId}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {session.profile?.role && <span className="capitalize">{session.profile.role}</span>}
                          {session.profile?.email && <> · {session.profile.email}</>}
                        </p>
                      </div>
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${session.status === 'active' ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
                    </div>
                    {session.status === 'active' && (
                      <button onClick={() => handlePeek(session.userId)}
                        className={`w-full py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                          viewingUser === session.userId
                            ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                            : 'bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25'
                        }`}>
                        {connectingTo[session.userId] && viewingUser === session.userId ? (
                          <><Loader2 className="h-3 w-3 animate-spin" /> Connecting…</>
                        ) : viewingUser === session.userId ? (
                          <><MonitorOff className="h-3 w-3" /> Stop viewing</>
                        ) : (
                          <><Video className="h-3 w-3" /> View screen</>
                        )}
                      </button>
                    )}
                  </motion.div>
                ))}
              </div>
            )}

            {/* Remote stream viewer */}
            <AnimatePresence>
              {viewingUser && remoteStreams[viewingUser] && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  className="bg-black rounded-2xl overflow-hidden border border-primary/30 shadow-2xl shadow-primary/10"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-primary/20">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                      <p className="text-xs font-medium">
                        Watching {screenSessions.find(s => s.userId === viewingUser)?.profile?.name || 'teammate'}
                      </p>
                    </div>
                    <button
                      onClick={() => { stopViewing(viewingUser); setViewingUser(null); }}
                      className="text-xs text-muted-foreground hover:text-red-400"
                    >
                      Stop
                    </button>
                  </div>
                  <video ref={monitorVideoRef} autoPlay playsInline className="w-full max-h-[60vh] object-contain bg-black" />
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}
      </div>
    </AppLayout>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function PeerTile({ peer }: { peer: PeerView }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && peer.stream) ref.current.srcObject = peer.stream;
  }, [peer.stream]);

  const initial = (peer.name || peer.userId || '?')[0].toUpperCase();
  const showAvatar = !peer.videoOn && !peer.screenOn;

  return (
    <div className="relative bg-black rounded-xl overflow-hidden aspect-video border border-border">
      <video ref={ref} autoPlay playsInline className="w-full h-full object-cover bg-black" />
      {showAvatar && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center text-2xl font-bold text-primary">
            {initial}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <span className="text-xs px-2 py-0.5 bg-black/60 backdrop-blur rounded-md text-white font-medium truncate max-w-[70%]">
          {peer.name || peer.userId} {peer.screenOn && '· sharing'}
        </span>
        <div className="flex items-center gap-1">
          {!peer.audioOn && (
            <span className="h-5 w-5 rounded-full bg-red-500/80 flex items-center justify-center">
              <MicOff className="h-3 w-3 text-white" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  on, onLabel, offLabel, IconOn, IconOff, onClick, highlight = false,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  IconOn: any;
  IconOff: any;
  onClick: () => void;
  highlight?: boolean;
}) {
  const Icon = on ? IconOn : IconOff;
  return (
    <button
      onClick={onClick}
      title={on ? onLabel : offLabel}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
        on
          ? (highlight ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground hover:bg-muted')
          : 'bg-muted/40 border border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{on ? onLabel : offLabel}</span>
    </button>
  );
}
