import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import User from '../models/User';
import ProcessDoc from '../models/ProcessDoc';
import { ProcessTest, ProcessTestAttempt } from '../models/ProcessTest';

/**
 * Process Updates (SOPs) + Process Tests — org-scoped throughout.
 *
 * Read endpoints are open to every authenticated staff role; anything
 * that publishes, edits or archives is admin-only (enforced at the route
 * layer). Test-taking is open to everyone, so the one rule that matters
 * here is that correct answers never leave the server for a taker —
 * `stripAnswers` is the single choke point for that.
 */

async function getOrgId(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select('organizationId').lean();
  return u?.organizationId ? String(u.organizationId) : null;
}

const isAdmin = (req: AuthRequest) =>
  req.user?.role === 'admin' || (req.user?.roles || []).includes('admin');

/** Remove correctIndex from every question — the taker-safe shape. */
function stripAnswers(test: any) {
  const t = typeof test.toObject === 'function' ? test.toObject() : { ...test };
  t.questions = (t.questions || []).map((q: any) => ({
    question: q.question,
    options:  q.options,
  }));
  return t;
}

/* ════════════════════════ PROCESS DOCS (SOPs) ════════════════════════ */

export async function listProcessDocs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const query: any = { organizationId: orgId };
    if (req.query.includeArchived !== '1') query.archived = { $ne: true };
    if (req.query.department) query.department = req.query.department;

    const docs = await ProcessDoc.find(query).sort({ publishedAt: -1 }).lean();
    const me = req.user!.id;

    // Decorate each doc with just enough for the list UI to render without
    // a second round trip: whether I've acknowledged the CURRENT version,
    // and how many people have.
    res.json(docs.map((d: any) => {
      const acksForCurrent = (d.acks || []).filter((a: any) => a.version === d.version);
      return {
        ...d,
        body: undefined,                  // list view doesn't need full text
        ackCount: acksForCurrent.length,
        acknowledged: acksForCurrent.some((a: any) => a.userId === me),
      };
    }));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function getProcessDoc(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const doc: any = await ProcessDoc.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!doc) { res.status(404).json({ error: 'Process not found' }); return; }

    const acksForCurrent = (doc.acks || []).filter((a: any) => a.version === doc.version);
    res.json({
      ...doc,
      ackCount: acksForCurrent.length,
      acknowledged: acksForCurrent.some((a: any) => a.userId === req.user!.id),
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createProcessDoc(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { title, department, summary, body, requiredFor } = req.body || {};
    if (!title?.trim()) { res.status(400).json({ error: 'Title is required' }); return; }

    const doc = await ProcessDoc.create({
      organizationId: orgId,
      title:      title.trim(),
      department: department || 'general',
      summary:    summary || '',
      body:       body || '',
      version:    1,
      versions: [{
        version: 1,
        body: body || '',
        changeNote: 'Initial version',
        publishedBy: req.user!.id,
        publishedAt: new Date(),
      }],
      requiredFor: Array.isArray(requiredFor) ? requiredFor : [],
      createdBy:   req.user!.id,
      publishedBy: req.user!.id,
      publishedAt: new Date(),
    });
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Publish an update. Metadata-only edits (title, summary, department)
 * leave the version alone; changing `body` cuts a new version, archives
 * the old text into versions[], and CLEARS acknowledgements — the team
 * is asked to read it again, which is the entire point of the module.
 */
export async function updateProcessDoc(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const doc: any = await ProcessDoc.findOne({ _id: req.params.id, organizationId: orgId });
    if (!doc) { res.status(404).json({ error: 'Process not found' }); return; }

    const { title, department, summary, body, changeNote, requiredFor, archived } = req.body || {};
    if (title !== undefined)       doc.title = String(title).trim() || doc.title;
    if (department !== undefined)  doc.department = department;
    if (summary !== undefined)     doc.summary = summary;
    if (requiredFor !== undefined) doc.requiredFor = Array.isArray(requiredFor) ? requiredFor : [];
    if (archived !== undefined)    doc.archived = !!archived;

    const bodyChanged = body !== undefined && String(body) !== String(doc.body);
    if (bodyChanged) {
      doc.version = (doc.version || 1) + 1;
      doc.body = body;
      doc.versions.push({
        version: doc.version,
        body,
        changeNote: (changeNote || '').trim() || 'Updated',
        publishedBy: req.user!.id,
        publishedAt: new Date(),
      });
      doc.acks = [];                      // new version → read it again
      doc.publishedBy = req.user!.id;
      doc.publishedAt = new Date();
    }

    await doc.save();
    res.json({ ...doc.toObject(), versionBumped: bodyChanged });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function acknowledgeProcessDoc(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const doc: any = await ProcessDoc.findOne({ _id: req.params.id, organizationId: orgId });
    if (!doc) { res.status(404).json({ error: 'Process not found' }); return; }

    const already = (doc.acks || []).some(
      (a: any) => a.userId === req.user!.id && a.version === doc.version,
    );
    if (!already) {
      doc.acks.push({
        userId: req.user!.id,
        userName: req.user!.name || '',
        version: doc.version,
        at: new Date(),
      });
      await doc.save();
    }
    const acksForCurrent = doc.acks.filter((a: any) => a.version === doc.version);
    res.json({ ok: true, acknowledged: true, ackCount: acksForCurrent.length });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteProcessDoc(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const doc = await ProcessDoc.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!doc) { res.status(404).json({ error: 'Process not found' }); return; }
    // Tests pointing at a deleted SOP become standalone rather than broken.
    await ProcessTest.updateMany(
      { organizationId: orgId, processDocId: doc._id },
      { $set: { processDocId: null } },
    );
    res.json({ message: 'Process deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/* ══════════════════════════ PROCESS TESTS ════════════════════════════ */

export async function listTests(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const query: any = { organizationId: orgId };
    if (req.query.includeArchived !== '1') query.archived = { $ne: true };

    const tests: any[] = await ProcessTest.find(query).sort({ createdAt: -1 }).lean();
    const me = req.user!.id;

    // My own attempt history, so the list can show "Passed 90%" or "Retake".
    const myAttempts: any[] = await ProcessTestAttempt
      .find({ organizationId: orgId, userId: me, testId: { $in: tests.map(t => t._id) } })
      .sort({ createdAt: -1 })
      .lean();

    // Admins also see how the whole team is doing on each test.
    const teamStats: Record<string, { attempts: number; passed: number }> = {};
    if (isAdmin(req)) {
      const all: any[] = await ProcessTestAttempt
        .find({ organizationId: orgId, testId: { $in: tests.map(t => t._id) } })
        .select('testId userId passed')
        .lean();
      all.forEach(a => {
        const k = String(a.testId);
        teamStats[k] = teamStats[k] || { attempts: 0, passed: 0 };
        teamStats[k].attempts++;
        if (a.passed) teamStats[k].passed++;
      });
    }

    res.json(tests.map(t => {
      const mine = myAttempts.filter(a => String(a.testId) === String(t._id));
      const best = mine.reduce(
        (b, a) => (!b || a.score > b.score ? a : b),
        null as any,
      );
      return {
        ...stripAnswers(t),
        questionCount: (t.questions || []).length,
        questions: undefined,             // list view never ships questions
        myBestScore: best ? best.score : null,
        myPassed:    mine.some(a => a.passed),
        myAttempts:  mine.length,
        teamStats:   teamStats[String(t._id)] || undefined,
      };
    }));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Fetch one test to take it. Answers are stripped for everyone except an
 * admin who explicitly asks to edit (?withAnswers=1) — that's the only
 * path that returns correctIndex.
 */
export async function getTest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const test: any = await ProcessTest.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!test) { res.status(404).json({ error: 'Test not found' }); return; }

    const wantsAnswers = req.query.withAnswers === '1' && isAdmin(req);
    res.json(wantsAnswers ? test : stripAnswers(test));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function createTest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const { title, description, processDocId, department, questions, passMark } = req.body || {};
    if (!title?.trim()) { res.status(400).json({ error: 'Title is required' }); return; }
    const qs = Array.isArray(questions) ? questions : [];
    if (qs.length === 0) { res.status(400).json({ error: 'Add at least one question' }); return; }

    const test = await ProcessTest.create({
      organizationId: orgId,
      title: title.trim(),
      description: description || '',
      processDocId: processDocId || null,
      department: department || 'general',
      questions: qs,
      passMark: Number(passMark) > 0 ? Number(passMark) : 70,
      createdBy: req.user!.id,
    });
    res.status(201).json(test);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function updateTest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const allowed = ['title', 'description', 'processDocId', 'department', 'questions', 'passMark', 'archived'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

    const test = await ProcessTest.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId }, patch, { new: true },
    );
    if (!test) { res.status(404).json({ error: 'Test not found' }); return; }
    res.json(test);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

export async function deleteTest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const test = await ProcessTest.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!test) { res.status(404).json({ error: 'Test not found' }); return; }
    await ProcessTestAttempt.deleteMany({ organizationId: orgId, testId: test._id });
    res.json({ message: 'Test deleted' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Submit an attempt. Scoring happens HERE, never on the client — the
 * client only ever sees the questions, so it couldn't mark itself even
 * if we asked it to. The response includes a per-question breakdown so
 * the taker learns what they got wrong.
 */
export async function submitAttempt(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }
    const test: any = await ProcessTest.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!test) { res.status(404).json({ error: 'Test not found' }); return; }

    const questions: any[] = test.questions || [];
    const answers: number[] = Array.isArray(req.body?.answers) ? req.body.answers : [];

    const review = questions.map((q, i) => {
      const picked = typeof answers[i] === 'number' ? answers[i] : -1;
      return {
        question: q.question,
        options: q.options,
        picked,
        correctIndex: q.correctIndex,
        correct: picked === q.correctIndex,
      };
    });
    const correctCount = review.filter(r => r.correct).length;
    const totalCount   = questions.length;
    const score  = totalCount ? Math.round((correctCount / totalCount) * 100) : 0;
    const passed = score >= (test.passMark || 70);

    await ProcessTestAttempt.create({
      organizationId: orgId,
      testId: test._id,
      userId: req.user!.id,
      userName: req.user!.name || '',
      answers,
      score,
      correctCount,
      totalCount,
      passed,
    });

    res.json({ score, passed, correctCount, totalCount, passMark: test.passMark, review });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

/**
 * Attempt history. Everyone can see their own; admins can see the whole
 * team's (optionally narrowed to one test via ?testId=).
 */
export async function listAttempts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const query: any = { organizationId: orgId };
    if (!isAdmin(req) || req.query.mine === '1') query.userId = req.user!.id;
    if (req.query.testId) query.testId = req.query.testId;

    const attempts = await ProcessTestAttempt.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json(attempts);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
