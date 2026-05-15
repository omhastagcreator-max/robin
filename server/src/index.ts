import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { connectDB } from './config/db';
import { errorHandler } from './middleware/errorHandler';
import ChatMessage from './models/ChatMessage';
import User from './models/User';

// Routes
import authRoutes         from './routes/auth';
import dashboardRoutes    from './routes/dashboard';
import usersRoutes        from './routes/users';
import projectsRoutes     from './routes/projects';
import tasksRoutes        from './routes/tasks';
import goalsRoutes        from './routes/goals';
import metricsRoutes      from './routes/metrics';
import updatesRoutes      from './routes/updates';
import sessionsRoutes     from './routes/sessions';
import screenSessionsRoutes from './routes/screenSessions';
import leadsRoutes        from './routes/leads';
import dealsRoutes        from './routes/deals';
import clientFinanceRoutes from './routes/clientFinance';
import notificationsRoutes from './routes/notifications';
import adminRoutes        from './routes/admin';
import chatRoutes         from './routes/chat';
import queriesRoutes      from './routes/queries';
import adReportsRoutes    from './routes/adReports';
import influencerRoutes   from './routes/influencers';
import seedRoutes         from './routes/seed';
import errorLogRoutes     from './routes/errorLogs';
import integrationsRoutes from './routes/integrations';
import { startSheetSyncJob } from './jobs/sheetSyncJob';
import credentialsRoutes  from './routes/credentials';
import leavesRoutes       from './routes/leaves';
import huddleRoutes       from './routes/huddle';
import remindersRoutes    from './routes/reminders';
import clientScheduleRoutes from './routes/clientSchedule';
import aiRoutes           from './routes/ai';
import transcriptsRoutes  from './routes/transcripts';
import metaAdsRoutes      from './routes/metaAds';
import { publicMetaShareRouter } from './routes/metaSharing';
import meetingsRoutes     from './routes/meetings';
import clientMeetingsRoutes, { publicClientMeetingsRouter } from './routes/clientMeetings';
import { startClientMeetingExpiryJob } from './jobs/clientMeetingExpiry';
import { startDailyAutoCloseJob } from './jobs/dailyAutoClose';
import { startIdleAutoCloseJob } from './jobs/idleAutoClose';

const app = express();
const httpServer = createServer(app);
const PORT = parseInt(process.env.PORT || '4002', 10);

// ── CORS ─────────────────────────────────────────────────────────────────────
const corsOrigin = (origin: string | undefined, cb: (e: Error | null, allow?: boolean) => void) => {
  if (!origin) return cb(null, true);
  // Any localhost port (dev)
  if (/^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
  // Vercel preview + production
  if (/\.vercel\.app$/.test(origin)) return cb(null, true);
  // Production domains — robin.hastagcreator.com (employee app) and
  // meeting.hastagcreator.com (white-labeled client meet page).
  if (/^https?:\/\/(robin|meeting)\.hastagcreator\.com$/.test(origin)) return cb(null, true);
  if (/\.hastagcreator\.com$/.test(origin)) return cb(null, true);
  // Explicit env vars
  if (process.env.FRONTEND_URL        && origin === process.env.FRONTEND_URL)        return cb(null, true);
  if (process.env.MEETING_PUBLIC_URL  && origin === process.env.MEETING_PUBLIC_URL)  return cb(null, true);
  cb(new Error(`CORS: origin ${origin} not allowed`));
};

// On Render / Vercel / any reverse proxy, the real client IP is in the
// X-Forwarded-For header. We trust ONE hop (Render's proxy) so
// express-rate-limit sees the real IP and doesn't throttle everyone
// globally because they all appear to come from the load balancer.
app.set('trust proxy', 1);

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// ── Security middleware ─────────────────────────────────────────────────────
//
// helmet sets a sensible default of HTTP security headers — HSTS, no-sniff,
// frame-ancestors, etc. We disable contentSecurityPolicy because we serve
// the API only (the SPA on Vercel sets its own CSP) and the default CSP
// would block legitimate cross-origin XHRs from the React app.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// express-mongo-sanitize strips any keys starting with '$' or containing '.'
// from req.body / req.params / req.query. Defends against NoSQL injection
// payloads like { "email": { "$ne": null } } that could bypass auth checks.
app.use(mongoSanitize({ allowDots: false, replaceWith: '_' }));

// Brute-force protection on auth endpoints. 10 attempts per 15 min per IP —
// lenient enough for legitimate users with autofill mistakes, tight enough
// to make password guessing infeasible.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: true, // a successful login resets your bucket — only failed attempts count
});

// Looser limiter for everything else — guards against accidental loops
// or scrapers without throttling normal use. 300 req/min per IP.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});


// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new SocketServer(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
});

// Online users tracker — keyed by socket.id (raw connections).
// We deduplicate by userId at emit time so multiple tabs / reconnects don't
// show the same user multiple times in the chat sidebar. orgId is included
// so presence can be scoped per-org for the SaaS multi-tenant case.
const onlineUsers = new Map<string, { userId: string; name: string; role: string; orgId: string | null }>();

/**
 * Build the deduplicated online list FOR A GIVEN ORG. One entry per userId
 * regardless of how many tabs / sockets that user has open. Filters out
 * garbage entries that came from clients without proper auth, AND filters
 * to only the requested org so Org A never sees Org B's presence.
 */
function buildOnlinePresenceForOrg(orgId: string) {
  const byUser = new Map<string, { userId: string; name: string; role: string }>();
  for (const info of onlineUsers.values()) {
    if (info.orgId !== orgId) continue;
    if (!info.userId || info.userId === 'undefined' || info.userId === 'null') continue;
    if (!byUser.has(info.userId)) byUser.set(info.userId, { userId: info.userId, name: info.name, role: info.role });
  }
  return Array.from(byUser.values());
}

/**
 * Emit presence:update to one specific org's room only. Was previously a
 * global io.emit which leaked Org A's online list to every tenant on the
 * same SaaS instance.
 */
function emitPresenceForOrg(orgId: string) {
  io.to(`org:${orgId}`).emit('presence:update', buildOnlinePresenceForOrg(orgId));
}

/**
 * Re-emit presence for every org currently represented in the online map.
 * Cheap because most installs have ≤ a handful of orgs at once.
 */
function emitPresenceForAllOrgs() {
  const orgs = new Set<string>();
  for (const info of onlineUsers.values()) {
    if (info.orgId) orgs.add(info.orgId);
  }
  orgs.forEach(emitPresenceForOrg);
}

// Meeting room participant tracker:
//   roomId -> Map<userId, { name, role }>
// We dedupe by userId so a user opening multiple tabs doesn't double-count.
const meetingRooms = new Map<string, Map<string, { name: string; role: string }>>();

function broadcastRoomParticipants(io: SocketServer, roomId: string) {
  const members = Array.from(meetingRooms.get(roomId)?.entries() || []).map(
    ([uid, info]) => ({ userId: uid, ...info })
  );
  io.to(`meeting:${roomId}`).emit('meeting:participants', { roomId, participants: members });
}

io.on('connection', (socket) => {
  const userId   = socket.handshake.query.userId   as string;
  const userName = socket.handshake.query.userName as string;
  const userRole = socket.handshake.query.userRole as string;

  // Ignore sockets that arrive without a real userId (public meet pages,
  // accidental connections, etc.) — they'd otherwise show as "undefined"
  // entries in the online list.
  const validUser = userId && userId !== 'undefined' && userId !== 'null';

  // Look up organizationId once per connection so we can scope rooms.
  // Stored on the socket data, not in any global map — survives reconnects
  // because each new connection re-runs this handler.
  let socketOrgId: string | null = null;

  if (validUser) {
    socket.join(`user:${userId}`);
    onlineUsers.set(socket.id, {
      userId,
      name: userName && userName !== 'undefined' ? userName : 'Unknown',
      role: userRole && userRole !== 'undefined' ? userRole : 'employee',
      orgId: null, // filled in once User lookup resolves
    });
    // Resolve the user's org synchronously-ish so subsequent broadcasts
    // can scope by org. Failures are non-fatal — they just won't be able
    // to send chat messages, but other socket features still work.
    User.findById(userId).select('organizationId').lean()
      .then(u => {
        socketOrgId = u?.organizationId ? String(u.organizationId) : null;
        if (socketOrgId) {
          socket.join(`org:${socketOrgId}`);            // for org-scoped emits
          const cur = onlineUsers.get(socket.id);
          if (cur) cur.orgId = socketOrgId;
          emitPresenceForOrg(socketOrgId);
        }
      })
      .catch(() => {/* ignore */});
  }

  // ── WebRTC Screen Share ──────────────────────────────────────────────────
  // The targeted webrtc:* messages are user-room scoped already (correct).
  // screen:start / screen:stop now fan out only to teammates IN THE SAME
  // ORG instead of every connected socket on the SaaS instance. socket.to
  // with a room only delivers to other sockets in that room (excludes self).
  socket.on('webrtc:offer',  ({ target, offer, senderId })     => io.to(`user:${target}`).emit('webrtc:offer',  { offer, senderId }));
  socket.on('webrtc:answer', ({ target, answer, adminId })     => io.to(`user:${target}`).emit('webrtc:answer', { answer, adminId }));
  socket.on('webrtc:ice',    ({ target, candidate, senderId }) => io.to(`user:${target}`).emit('webrtc:ice',    { candidate, senderId }));
  socket.on('screen:start',  ({ userId: uid }) => {
    if (!socketOrgId) return;
    socket.to(`org:${socketOrgId}`).emit('screen:started', { userId: uid });
  });
  socket.on('screen:stop',   ({ userId: uid }) => {
    if (!socketOrgId) return;
    socket.to(`org:${socketOrgId}`).emit('screen:stopped', { userId: uid });
  });
  socket.on('view:request',  ({ targetId, adminId })           => io.to(`user:${targetId}`).emit('view:request', { adminId }));

  // ── Group Chat (per-org rooms) ────────────────────────────────────────────
  // Room name on the wire is "agency-global", but internally we scope to
  // "{orgId}:agency-global" so two agencies on the same SaaS instance never
  // see each other's messages even if they used the same room name.
  const orgRoom = (roomId: string) => `room:${socketOrgId}:${roomId}`;

  socket.on('chat:join', ({ roomId = 'agency-global' }) => {
    if (!socketOrgId) return;
    socket.join(orgRoom(roomId));
  });

  socket.on('chat:message', async ({ roomId = 'agency-global', content, type = 'text', mentions = [] }) => {
    if (!content?.trim() || !userId || !socketOrgId) return;
    try {
      const msg = await ChatMessage.create({
        organizationId: socketOrgId,
        roomId, content: content.trim(), type, mentions,
        senderId: userId,
        senderName: userName || 'Unknown',
        senderRole: userRole || 'employee',
      });
      // Broadcast only to listeners in THIS org's version of the room.
      io.to(orgRoom(roomId)).emit('chat:message', msg);
      // Send targeted notifications for mentions — user-rooms are already
      // user-id-keyed, so no extra org check needed (uid is unique globally).
      mentions.forEach((uid: string) => {
        io.to(`user:${uid}`).emit('chat:mention', { from: userName, content: content.slice(0, 80), roomId });
      });
    } catch (e) {
      socket.emit('chat:error', { error: 'Failed to save message' });
    }
  });

  // ── Meeting Room (mesh WebRTC presence) ──────────────────────────────────
  // Currently a single org-wide room ("agency-global") but the API takes a
  // roomId so we can scope per-project later.
  socket.on('meeting:join', ({ roomId = 'agency-global' }) => {
    if (!userId) return;
    socket.join(`meeting:${roomId}`);
    let room = meetingRooms.get(roomId);
    if (!room) { room = new Map(); meetingRooms.set(roomId, room); }
    room.set(userId, { name: userName || 'Unknown', role: userRole || 'employee' });

    // Tell the new joiner who's already there (so they can initiate offers)
    socket.emit('meeting:participants', {
      roomId,
      participants: Array.from(room.entries()).map(([uid, info]) => ({ userId: uid, ...info })),
    });
    // Tell existing members someone new joined
    socket.to(`meeting:${roomId}`).emit('meeting:user-joined', { roomId, userId, name: userName, role: userRole });
  });

  socket.on('meeting:leave', ({ roomId = 'agency-global' }) => {
    if (!userId) return;
    socket.leave(`meeting:${roomId}`);
    const room = meetingRooms.get(roomId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) meetingRooms.delete(roomId);
    }
    socket.to(`meeting:${roomId}`).emit('meeting:user-left', { roomId, userId });
    broadcastRoomParticipants(io, roomId);
  });

  // Track-state changes (mic/camera/screen on/off) — small UI-only signal
  socket.on('meeting:track-state', ({ roomId = 'agency-global', state }) => {
    if (!userId) return;
    socket.to(`meeting:${roomId}`).emit('meeting:track-state', { userId, state });
  });

  // ── Real-time task notifications ─────────────────────────────────────────
  socket.on('task:assigned', ({ targetUserId, taskTitle, assignerName }) => {
    io.to(`user:${targetUserId}`).emit('notification:new', {
      title: `New task assigned by ${assignerName}`,
      message: taskTitle,
      type: 'info',
    });
  });

  // ── Deafen broadcast — let the team know who's muted everyone ───────────
  // When a teammate clicks "Mute team audio", others see a badge on their
  // tile so we don't keep shouting at someone who can't hear us.
  // Ephemeral — not persisted; clears when the user disconnects below.
  socket.on('presence:deafen', ({ on }: { on: boolean }) => {
    if (!userId || !socketOrgId) return;
    // Org-scoped broadcast (was a global socket.broadcast.emit which leaked
    // Org A's mute toggles to every other tenant on the SaaS).
    socket.to(`org:${socketOrgId}`).emit('presence:deafened', {
      userId,
      name: userName || 'Unknown',
      on: !!on,
    });
  });

  socket.on('disconnect', () => {
    const cached = onlineUsers.get(socket.id);
    const cachedOrg = cached?.orgId || socketOrgId;
    onlineUsers.delete(socket.id);
    if (cachedOrg) emitPresenceForOrg(cachedOrg);
    // Clear any deafen badge so it doesn't linger after the user leaves.
    if (userId && cachedOrg) {
      const stillConnected = Array.from(onlineUsers.values()).some(u => u.userId === userId);
      if (!stillConnected) {
        socket.to(`org:${cachedOrg}`).emit('presence:deafened', { userId, on: false });
      }
    }

    // Drop user from any meeting rooms they were in (only if no other tabs of
    // theirs are still connected — checked via the presence map by userId).
    if (userId) {
      const stillConnected = Array.from(onlineUsers.values()).some(u => u.userId === userId);
      if (!stillConnected) {
        meetingRooms.forEach((room, roomId) => {
          if (room.has(userId)) {
            room.delete(userId);
            io.to(`meeting:${roomId}`).emit('meeting:user-left', { roomId, userId });
            broadcastRoomParticipants(io, roomId);
            if (room.size === 0) meetingRooms.delete(roomId);
          }
        });
      }
    }
  });
});

// Make io accessible in controllers
app.set('io', io);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Robin', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
// PUBLIC ROUTERS FIRST. Any router mounted at the bare '/api' prefix that has
// global auth middleware would otherwise gate every /api/* request. Mounting
// public routers first means Express finds them before any catch-all auth.
app.use('/api', publicMetaShareRouter);        // GET /api/share/meta/:token
app.use('/api', publicClientMeetingsRouter);   // GET/POST /api/meet/:slug

// Tight brute-force gate on the auth endpoints. Mounted BEFORE authRoutes so
// it intercepts /api/auth/login and /api/auth/register specifically.
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/google',   authLimiter);

// Looser per-IP throttle on everything else — saves us from runaway clients.
app.use('/api', generalLimiter);

app.use('/api/auth',            authRoutes);
app.use('/api/dashboard',       dashboardRoutes);
app.use('/api/users',           usersRoutes);
app.use('/api/projects',        projectsRoutes);
app.use('/api/tasks',           tasksRoutes);
app.use('/api/goals',           goalsRoutes);
app.use('/api/metrics',         metricsRoutes);
app.use('/api/updates',         updatesRoutes);
app.use('/api/sessions',        sessionsRoutes);
app.use('/api/screen-sessions', screenSessionsRoutes);
app.use('/api/leads',           leadsRoutes);
app.use('/api/deals',           dealsRoutes);
app.use('/api',                 clientFinanceRoutes);
app.use('/api/notifications',   notificationsRoutes);
app.use('/api/admin',           adminRoutes);
app.use('/api/chat',            chatRoutes);
app.use('/api/queries',         queriesRoutes);
app.use('/api/ad-reports',      adReportsRoutes);
app.use('/api/influencers',     influencerRoutes);
app.use('/api/credentials',     credentialsRoutes);
app.use('/api/leaves',          leavesRoutes);
app.use('/api/huddle',          huddleRoutes);
app.use('/api/reminders',       remindersRoutes);
app.use('/api/client-schedule', clientScheduleRoutes);
app.use('/api/ai',              aiRoutes);
app.use('/api/transcripts',     transcriptsRoutes);
app.use('/api/ads/meta',        metaAdsRoutes);    // includes /share, /shares (authed)
app.use('/api/meetings',        meetingsRoutes);
app.use('/api/client-meetings', clientMeetingsRoutes);  // host endpoints
app.use('/api/seed',            seedRoutes);
app.use('/api/logs',            errorLogRoutes);
app.use('/api/integrations',    integrationsRoutes);

// ── 404 + Error handler ───────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`[Robin] 🐦 API running on http://localhost:${PORT}`);
    console.log(`[Robin] 💬 Group Chat + WebRTC Socket.io ready`);
    console.log(`[Robin] 🎙️ LiveKit env check:`, {
      LIVEKIT_URL:        process.env.LIVEKIT_URL        ? 'set ✓' : 'MISSING ✗',
      LIVEKIT_API_KEY:    process.env.LIVEKIT_API_KEY    ? 'set ✓' : 'MISSING ✗',
      LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ? 'set ✓' : 'MISSING ✗',
    });

    // Schedule daily auto-close of forgotten sessions (23:59 IST).
    startDailyAutoCloseJob();
    // End-of-business sweep at 18:00 IST — closes any session whose
    // last heartbeat is older than 10 hours.
    startIdleAutoCloseJob();

    // Auto-expire client meetings past their duration / expiresAt.
    startClientMeetingExpiryJob();

    // Poll every connected Google Sheet every 5 min for new leads.
    startSheetSyncJob();
  });
});

export default app;
