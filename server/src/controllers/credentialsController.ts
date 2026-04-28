import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import ClientCredential from '../models/ClientCredential';
import User from '../models/User';
import { encrypt, decrypt } from '../lib/crypto';

async function getOrgId(userId: string) {
  const u = await User.findById(userId).select('organizationId');
  return u?.organizationId;
}

/**
 * Hydrate a credential into the wire shape: drops encrypted blobs and
 * returns a plain `password` field that internal staff can use directly.
 * Clients/external users never hit this controller — the route guard
 * blocks the `client` role.
 */
function hydrate(doc: any) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const password = obj.passwordEnc
    ? decrypt({ enc: obj.passwordEnc, iv: obj.passwordIv, tag: obj.passwordTag })
    : '';
  delete obj.passwordEnc;
  delete obj.passwordIv;
  delete obj.passwordTag;
  return { ...obj, password };
}

// GET /api/credentials?clientId=&projectId=&q=&type=
export async function listCredentials(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const { clientId, projectId, q, type } = req.query as Record<string, string>;

    const filter: any = { organizationId: orgId };
    if (clientId)  filter.clientId  = clientId;
    if (projectId) filter.projectId = projectId;
    if (type)      filter.type      = type;
    if (q && q.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { url: rx }, { username: rx }, { notes: rx }];
    }

    const docs = await ClientCredential.find(filter)
      .populate('clientId',  'name email')
      .populate('projectId', 'name')
      .sort({ updatedAt: -1 })
      .lean();

    res.json(docs.map(hydrate));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// POST /api/credentials
export async function createCredential(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    if (!orgId) { res.status(400).json({ error: 'No organization' }); return; }

    const { title, type, url, username, password, notes, clientId, projectId } = req.body || {};
    if (!title || !String(title).trim()) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const payload: any = {
      organizationId: orgId,
      clientId:       clientId  || undefined,
      projectId:      projectId || undefined,
      title:    String(title).trim(),
      type:     type || 'other',
      url:      url      ? String(url).trim() : undefined,
      username: username ? String(username).trim() : undefined,
      notes:    notes    ? String(notes) : undefined,
      createdBy: req.user!.id,
      updatedBy: req.user!.id,
    };

    if (password) {
      const blob = encrypt(String(password));
      payload.passwordEnc = blob.enc;
      payload.passwordIv  = blob.iv;
      payload.passwordTag = blob.tag;
    }

    const doc = await ClientCredential.create(payload);
    const populated = await ClientCredential.findById(doc._id)
      .populate('clientId',  'name email')
      .populate('projectId', 'name');
    res.status(201).json(hydrate(populated));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// PUT /api/credentials/:id
export async function updateCredential(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const doc = await ClientCredential.findOne({ _id: req.params.id, organizationId: orgId });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }

    const { title, type, url, username, password, notes, clientId, projectId } = req.body || {};

    if (title    !== undefined) doc.title    = String(title).trim();
    if (type     !== undefined) doc.type     = type;
    if (url      !== undefined) doc.url      = String(url).trim();
    if (username !== undefined) doc.username = String(username).trim();
    if (notes    !== undefined) doc.notes    = String(notes);
    if (clientId  !== undefined) (doc as any).clientId  = clientId  || undefined;
    if (projectId !== undefined) (doc as any).projectId = projectId || undefined;

    if (password !== undefined) {
      if (password === '') {
        doc.passwordEnc = undefined as any;
        doc.passwordIv  = undefined as any;
        doc.passwordTag = undefined as any;
      } else {
        const blob = encrypt(String(password));
        doc.passwordEnc = blob.enc;
        doc.passwordIv  = blob.iv;
        doc.passwordTag = blob.tag;
      }
    }

    doc.updatedBy = req.user!.id;
    await doc.save();

    const populated = await ClientCredential.findById(doc._id)
      .populate('clientId',  'name email')
      .populate('projectId', 'name');
    res.json(hydrate(populated));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}

// DELETE /api/credentials/:id
export async function deleteCredential(req: AuthRequest, res: Response): Promise<void> {
  try {
    const orgId = await getOrgId(req.user!.id);
    const doc = await ClientCredential.findOneAndDelete({ _id: req.params.id, organizationId: orgId });
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
}
