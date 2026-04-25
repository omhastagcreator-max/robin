import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Video, Monitor, MonitorOff, Users, Loader2 } from 'lucide-react';
import { useWebRTCSender, useWebRTCReceiver } from '@/hooks/useWebRTC';
import * as api from '@/api';

export default function WorkRoom() {
  const { user, role } = useAuth();
  const [screenSessions, setScreenSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [viewingUser, setViewingUser] = useState<string | null>(null);

  // Employee: share their screen
  const { isSharing, startSharing, stopSharing } = useWebRTCSender(user?.id || '');

  // Admin: view others' screens
  const { remoteStream, isConnecting, viewScreen, stopViewing } = useWebRTCReceiver(user?.id || '');

  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && remoteStream) el.srcObject = remoteStream;
  }, [remoteStream]);

  const loadSessions = async () => {
    try {
      const data = await api.listScreenSessions();
      setScreenSessions(Array.isArray(data) ? data : []);
    } finally { setLoadingSessions(false); }
  };

  useEffect(() => {
    if (role === 'admin') { loadSessions(); const i = setInterval(loadSessions, 10000); return () => clearInterval(i); }
    else setLoadingSessions(false);
  }, [role]);

  const handleView = (targetId: string) => {
    if (viewingUser === targetId) { stopViewing(); setViewingUser(null); return; }
    setViewingUser(targetId);
    viewScreen(targetId);
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6 page-transition-enter">
        <div>
          <h1 className="text-2xl font-bold">Work Room</h1>
          <p className="text-sm text-muted-foreground">Screen sharing &amp; real-time collaboration via Socket.io WebRTC</p>
        </div>

        {/* Employee View */}
        {(role === 'employee' || role === 'sales') && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${isSharing ? 'bg-green-500/20' : 'bg-muted'}`}>
                {isSharing ? <Monitor className="h-5 w-5 text-green-400" /> : <MonitorOff className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div>
                <p className="font-semibold text-sm">{isSharing ? 'Screen sharing is active' : 'Screen sharing is off'}</p>
                <p className="text-xs text-muted-foreground">{isSharing ? 'Admin can view your screen in real time' : 'Your screen is private'}</p>
              </div>
            </div>

            {isSharing ? (
              <button onClick={stopSharing}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-500/15 text-red-400 border border-red-500/30 rounded-xl text-sm font-medium hover:bg-red-500/25 transition-all">
                <MonitorOff className="h-4 w-4" /> Stop Sharing
              </button>
            ) : (
              <button onClick={startSharing}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
                <Monitor className="h-4 w-4" /> Start Screen Share
              </button>
            )}
          </div>
        )}

        {/* Admin View — see who's sharing */}
        {role === 'admin' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Active Screen Sessions</h2>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {screenSessions.filter(s => s.status === 'active').length} active
              </span>
            </div>

            {loadingSessions ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : screenSessions.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-16 gap-3">
                <Monitor className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No active screen sessions</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {screenSessions.map(session => (
                  <motion.div key={session._id || session.userId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className={`bg-card border rounded-2xl p-4 space-y-3 transition-all ${session.status === 'active' ? 'border-green-500/30' : 'border-border'}`}>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                        {(session.profile?.name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{session.profile?.name || session.userId}</p>
                        <p className="text-xs text-muted-foreground">{session.profile?.email}</p>
                      </div>
                      <span className={`h-2.5 w-2.5 rounded-full ${session.status === 'active' ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
                    </div>
                    {session.status === 'active' && (
                      <button onClick={() => handleView(session.userId)}
                        className={`w-full py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                          viewingUser === session.userId
                            ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                            : 'bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25'
                        }`}>
                        {isConnecting && viewingUser === session.userId ? (
                          <><Loader2 className="h-3 w-3 animate-spin" /> Connecting…</>
                        ) : viewingUser === session.userId ? (
                          <><MonitorOff className="h-3 w-3" /> Stop Viewing</>
                        ) : (
                          <><Video className="h-3 w-3" /> View Screen</>
                        )}
                      </button>
                    )}
                  </motion.div>
                ))}
              </div>
            )}

            {/* Remote stream viewer */}
            {remoteStream && (
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                className="bg-black rounded-2xl overflow-hidden border border-primary/30 shadow-2xl shadow-primary/10">
                <div className="flex items-center justify-between px-4 py-2.5 bg-card border-b border-primary/20">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                    <p className="text-xs font-medium">Live screen view</p>
                  </div>
                  <button onClick={() => { stopViewing(); setViewingUser(null); }} className="text-xs text-muted-foreground hover:text-red-400">
                    Stop
                  </button>
                </div>
                <video ref={videoRef} autoPlay playsInline className="w-full max-h-[60vh] object-contain bg-black" />
              </motion.div>
            )}
          </div>
        )}

        {/* Jitsi Meet for video calls */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Video className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Team Video Calls (Jitsi)</h2>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">Avoid global static rooms which lock out members. Join an organization-specific room below:</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { name: 'Main Office', id: 'MainOffice' },
                { name: 'Sales Huddle', id: 'SalesHuddle' },
                { name: 'Dev Sync', id: 'DevSync' },
                { name: 'Client Meet', id: 'ClientMeet' }
              ].map(room => (
                <a key={room.id} href={`https://meet.jit.si/RobinAgency_${user?.organizationId || 'HQ'}_${room.id}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3 bg-primary/10 border border-primary/30 rounded-xl text-sm text-primary font-medium hover:bg-primary/20 transition-all">
                  <Video className="h-4 w-4" /> {room.name}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
