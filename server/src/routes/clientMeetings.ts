import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/roleMiddleware';
import {
  createClientMeeting, listMyClientMeetings, endClientMeeting, extendClientMeeting,
  getHostToken, publicMeetingInfo, getGuestToken,
} from '../controllers/clientMeetingsController';

/** Two routers: public (no auth) and authed. Mounted separately in index. */

export const publicClientMeetingsRouter = Router();
publicClientMeetingsRouter.get('/meet/:slug',                publicMeetingInfo);
publicClientMeetingsRouter.post('/meet/:slug/guest-token',   getGuestToken);

export const authedClientMeetingsRouter = Router();
authedClientMeetingsRouter.use(authMiddleware);
const internal = requireRole('admin', 'employee', 'sales');

authedClientMeetingsRouter.post('/',                       internal, createClientMeeting);
authedClientMeetingsRouter.get('/mine',                    internal, listMyClientMeetings);
authedClientMeetingsRouter.put('/:slug/end',               internal, endClientMeeting);
authedClientMeetingsRouter.put('/:slug/extend',            internal, extendClientMeeting);
authedClientMeetingsRouter.post('/:slug/host-token',       internal, getHostToken);

export default authedClientMeetingsRouter;
