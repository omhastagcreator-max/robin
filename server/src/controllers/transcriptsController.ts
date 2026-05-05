import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Transcript from '../models/Transcript';
import User from '../models/User';

/**
 * Same IST day-key helper as aiService — keep them in sync. (When this
 * grows, we'll extract to a shared dates.ts util.)
 */
function todayKey(d = new Date()): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

/**
 * POST /api/transcripts/lines
 *
 * Client batches a few seconds of speech into an array of lines and posts
 * them in one go (cheaper than one request per line). Each entry is the
 * smallest meaningful unit — a sentence or short utterance.
 *
 * Body shape: { roomId: string, lines: [{ text, confidence, startedAt, endedAt? }] }
 *
 * We tag every line with the SERVER's view of "who is this user" — never
 * trust the client to claim someone else's identity. The req.user.id from
 * the JWT is the only userId we record.
 */
export async function postLines(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { roomId, lines, language } = req.body as {
      roomId?: string;
      lines?: Array<{ text: string; confidence?: number; startedAt: string; endedAt?: string }>;
      language?: string;
    };

    if (!roomId || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: 'roomId and lines[] required' });
      return;
    }

    // Look up the user once for speakerName + organizationId — saves a
    // join later when summarising.
    const user = await User.findById(userId).select('name email organizationId').lean();
    const speakerName = user?.name || user?.email || 'Unknown';
    const organizationId = user?.organizationId;

    const dateKey = todayKey();

    // Build one Mongo document per line, filtering anything obviously
    // junk (empty, super-short, or extremely low confidence).
    const docs = lines
      .filter(l => l && typeof l.text === 'string')
      .map(l => ({
        organizationId,
        userId,
        speakerName,
        roomId,
        dateKey,
        text: l.text.trim(),
        confidence: typeof l.confidence === 'number' ? l.confidence : undefined,
        startedAt: new Date(l.startedAt || Date.now()),
        endedAt:   l.endedAt ? new Date(l.endedAt) : undefined,
        source:    'web-speech',
        language:  language || 'en-IN',
      }))
      .filter(d => d.text.length >= 2);

    if (docs.length === 0) {
      res.json({ ok: true, inserted: 0 });
      return;
    }

    const inserted = await Transcript.insertMany(docs, { ordered: false });
    res.json({ ok: true, inserted: inserted.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * GET /api/transcripts?date=YYYY-MM-DD&userId=...
 *
 * Pulls transcript lines for review/debug. Defaults to today + the
 * caller's own lines.
 *
 * Admin can pass userId to see anyone's lines (in their org); other
 * roles can only see their own.
 */
export async function listTranscripts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const role = req.user!.role;
    const dateKey = (req.query.date as string) || todayKey();
    const requestedUserId = req.query.userId as string | undefined;

    const userId = role === 'admin' && requestedUserId
      ? requestedUserId
      : req.user!.id;

    const lines = await Transcript.find({ userId, dateKey })
      .sort({ startedAt: 1 })
      .limit(2000)
      .lean();

    res.json({ dateKey, userId, count: lines.length, lines });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
