import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { connectDB } from './config/db';
import { errorHandler } from './middleware/errorHandler';
import ChatMessage from './models/ChatMessage';

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
  // Custom production domain
  if (/^https?:\/\/(robin\.)?hastagcreator\.com$/.test(origin)) return cb(null, true);
  if (/\.hastagcreator\.com$/.test(origin)) return cb(null, true);
  // Explicit FRONTEND_URL env var
  if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) return cb(null, true);
  cb(new Error(`CORS: origin ${origin} not allowed`));
};

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '50mb' }));


// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new SocketServer(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
});

// Online users tracker
const onlineUsers = new Map<string, { userId: string; name: string; role: string }>();

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

  if (userId) {
    socket.join(`user:${userId}`);
    onlineUsers.set(socket.id, { userId, name: userName || 'Unknown', role: userRole || 'employee' });
    io.emit('presence:update', Array.from(onlineUsers.values()));
  }

  // ── WebRTC Screen Share ──────────────────────────────────────────────────
  socket.on('webrtc:offer',  ({ target, offer, senderId })     => io.to(`user:${target}`).emit('webrtc:offer',  { offer, senderId }));
  socket.on('webrtc:answer', ({ target, answer, adminId })     => io.to(`user:${target}`).emit('webrtc:answer', { answer, adminId }));
  socket.on('webrtc:ice',    ({ target, candidate, senderId }) => io.to(`user:${target}`).emit('webrtc:ice',    { candidate, senderId }));
  socket.on('screen:start',  ({ userId: uid })                 => socket.broadcast.emit('screen:started', { userId: uid }));
  socket.on('screen:stop',   ({ userId: uid })                 => socket.broadcast.emit('screen:stopped', { userId: uid }));
  socket.on('view:request',  ({ targetId, adminId })           => io.to(`user:${targetId}`).emit('view:request', { adminId }));

  // ── Group Chat ───────────────────────────────────────────────────────────
  socket.on('chat:join', ({ roomId = 'agency-global' }) => {
    socket.join(`room:${roomId}`);
  });

  socket.on('chat:message', async ({ roomId = 'agency-global', content, type = 'text', mentions = [] }) => {
    if (!content?.trim() || !userId) return;
    try {
      const msg = await ChatMessage.create({
        roomId, content: content.trim(), type, mentions,
        senderId: userId,
        senderName: userName || 'Unknown',
        senderRole: userRole || 'employee',
      });
      // Broadcast to everyone in the room
      io.to(`room:${roomId}`).emit('chat:message', msg);
      // Send targeted notifications for mentions
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

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('presence:update', Array.from(onlineUsers.values()));

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
app.use('/api/seed',            seedRoutes);

// ── 404 + Error handler ───────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`[Robin] 🐦 API running on http://localhost:${PORT}`);
    console.log(`[Robin] 💬 Group Chat + WebRTC Socket.io ready`);
  });
});

export default app;
