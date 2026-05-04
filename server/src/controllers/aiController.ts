import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import AIBrief from '../models/AIBrief';
import { generateMorningBrief, todayKey } from '../services/aiService';

/**
 * GET /api/ai/morning-brief
 *
 * The classic "cache-aside" pattern:
 *   1. Look up today's brief in Mongo
 *   2. If found → return it (fast, free)
 *   3. If not → call Claude, store the result, return it
 *
 * `?refresh=1` bypasses the cache (admin/debug knob, useful when iterating
 * on prompts in development).
 */
export async function getMorningBrief(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const dateKey = todayKey();
    const refresh = req.query.refresh === '1';

    // 1) Cache lookup
    if (!refresh) {
      const cached = await AIBrief.findOne({ userId, kind: 'morning_brief', dateKey }).lean();
      if (cached) {
        res.json({ content: cached.content, dateKey, cached: true });
        return;
      }
    }

    // 2) Generate fresh
    const { content, inputTokens, outputTokens } = await generateMorningBrief(userId);

    // 3) Store. The unique index guards against parallel writes — if two
    //    tabs race here, the loser catches the duplicate-key error and
    //    we just re-read the row.
    try {
      await AIBrief.create({
        userId,
        kind: 'morning_brief',
        dateKey,
        content,
        model: 'claude-haiku-4-5',
        inputTokens,
        outputTokens,
      });
    } catch (e: any) {
      if (e?.code !== 11000) throw e; // 11000 = duplicate key, ignore
    }

    res.json({ content, dateKey, cached: false });
  } catch (err) {
    const msg = (err as Error).message || 'AI generation failed';
    // Detect missing-key explicitly so the UI can show a clear message
    // instead of "AI generation failed" with no clue what to do.
    if (msg.includes('ANTHROPIC_API_KEY')) {
      res.status(503).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
}
