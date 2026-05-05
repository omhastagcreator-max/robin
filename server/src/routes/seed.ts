import { Router } from 'express';
import { Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import bcrypt from 'bcryptjs';

// Inline all models
import User from '../models/User';
import Organization from '../models/Organization';
import Project from '../models/Project';
import ProjectTask from '../models/ProjectTask';
import Lead from '../models/Lead';
import Deal from '../models/Deal';
import Metric from '../models/Metric';
import ClientTransaction from '../models/ClientTransaction';
import ProjectUpdate from '../models/ProjectUpdate';
import Session from '../models/Session';
import LeadNote from '../models/LeadNote';
import Influencer from '../models/Influencer';
import ProjectGoal from '../models/ProjectGoal';
import ScreenSession from '../models/ScreenSession';
import ClientAlert from '../models/ClientAlert';
import ClientQuery from '../models/ClientQuery';
import AdReport from '../models/AdReport';
import ActivityLog from '../models/ActivityLog';
import Notification from '../models/Notification';
import ChatMessage from '../models/ChatMessage';
import ClientCredential from '../models/ClientCredential';
import LeaveApplication from '../models/LeaveApplication';
import Reminder from '../models/Reminder';
import AIBrief from '../models/AIBrief';

const router = Router();
const hash = (p: string) => bcrypt.hash(p, 10);

/**
 * POST /api/seed/clear
 *
 * Wipes all OPERATIONAL data (tasks, projects, leads, sessions, vault,
 * leaves, reminders, AI briefs, ad reports, etc.) so the workspace is
 * fresh — but keeps the user accounts, the organisation, and any
 * profile/role settings intact. Login keeps working, employees stay
 * listed; their data just resets.
 *
 * Use after seeding demo data, or before handing the app over to a
 * real client team. Admin-only.
 */
router.post('/clear', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  try {
    // Models we deliberately KEEP: User, Organization, UserProfile, UserRole
    // (they hold identity, auth, and org membership we don't want to lose).
    const results = await Promise.all([
      Project.deleteMany({}),
      ProjectTask.deleteMany({}),
      ProjectGoal.deleteMany({}),
      ProjectUpdate.deleteMany({}),
      Lead.deleteMany({}),
      LeadNote.deleteMany({}),
      Deal.deleteMany({}),
      Metric.deleteMany({}),
      ClientTransaction.deleteMany({}),
      ClientAlert.deleteMany({}),
      ClientQuery.deleteMany({}),
      AdReport.deleteMany({}),
      Session.deleteMany({}),
      ScreenSession.deleteMany({}),
      Influencer.deleteMany({}),
      ActivityLog.deleteMany({}),
      Notification.deleteMany({}),
      ChatMessage.deleteMany({}),
      ClientCredential.deleteMany({}),
      LeaveApplication.deleteMany({}),
      Reminder.deleteMany({}),
      AIBrief.deleteMany({}),
    ]);

    // Map back to a friendly summary so the caller can see what was wiped.
    const counts = {
      projects:           results[0].deletedCount,
      tasks:              results[1].deletedCount,
      goals:              results[2].deletedCount,
      projectUpdates:     results[3].deletedCount,
      leads:              results[4].deletedCount,
      leadNotes:          results[5].deletedCount,
      deals:              results[6].deletedCount,
      metrics:            results[7].deletedCount,
      clientTransactions: results[8].deletedCount,
      clientAlerts:       results[9].deletedCount,
      clientQueries:      results[10].deletedCount,
      adReports:          results[11].deletedCount,
      sessions:           results[12].deletedCount,
      screenSessions:     results[13].deletedCount,
      influencers:        results[14].deletedCount,
      activityLogs:       results[15].deletedCount,
      notifications:      results[16].deletedCount,
      chatMessages:       results[17].deletedCount,
      vaultCredentials:   results[18].deletedCount,
      leaveApplications:  results[19].deletedCount,
      reminders:          results[20].deletedCount,
      aiBriefs:           results[21].deletedCount,
    };

    const totalCleared = Object.values(counts).reduce((sum, n) => sum + (n || 0), 0);
    const remainingUsers = await User.countDocuments();

    res.json({
      ok: true,
      message: 'Operational data cleared. Users + organisation preserved.',
      cleared: counts,
      totalCleared,
      preserved: { users: remainingUsers },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Only admin can call this — full reseed of the connected database
router.post('/reseed', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  try {
    // Clear everything
    await Promise.all([
      User.deleteMany({}), Organization.deleteMany({}), Project.deleteMany({}),
      ProjectTask.deleteMany({}), Lead.deleteMany({}), Deal.deleteMany({}),
      Metric.deleteMany({}), ClientTransaction.deleteMany({}),
      ProjectUpdate.deleteMany({}), Session.deleteMany({}), LeadNote.deleteMany({}),
      Influencer.deleteMany({}),
    ]);

    const org = await Organization.create({ name: 'Hastag Agency', plan: 'pro' });

    const [rahul, rishi, sakshi, priyanka, om, adminDemo, empDemo, clientUser, salesDemo] = await Promise.all([
      User.create({ email: 'rahul@hastag.in',    passwordHash: await hash('Rahul@1234'),    name: 'Rahul',    role: 'admin',    team: 'management', department: 'Management',      organizationId: org._id }),
      User.create({ email: 'rishi@hastag.in',    passwordHash: await hash('Rishi@1234'),    name: 'Rishi',    role: 'sales',    team: 'sales',      department: 'Sales',           organizationId: org._id }),
      User.create({ email: 'sakshi@hastag.in',   passwordHash: await hash('Sakshi@1234'),   name: 'Sakshi',   role: 'employee', team: 'ads',        department: 'Meta Ads',        organizationId: org._id }),
      User.create({ email: 'priyanka@hastag.in', passwordHash: await hash('Priyanka@1234'), name: 'Priyanka', role: 'employee', team: 'influencer', department: 'Influencer Mktg', organizationId: org._id }),
      User.create({ email: 'om@hastag.in',       passwordHash: await hash('Om@1234'),       name: 'Om',       role: 'employee', team: 'dev',        department: 'Web Development', organizationId: org._id }),
      User.create({ email: 'admin@robin.app',    passwordHash: await hash('Admin1234!'),    name: 'Admin User',   role: 'admin',    team: '', organizationId: org._id }),
      User.create({ email: 'employee@robin.app', passwordHash: await hash('Employee1234!'), name: 'Alex Employee',role: 'employee', team: 'dev', organizationId: org._id }),
      User.create({ email: 'client@robin.app',   passwordHash: await hash('Client1234!'),   name: 'Acme Corp',    role: 'client',   team: '', organizationId: org._id }),
      User.create({ email: 'sales@robin.app',    passwordHash: await hash('Sales1234!'),    name: 'Sam Sales',    role: 'sales',    team: 'sales', organizationId: org._id }),
    ]);

    const clientId = String(clientUser._id);
    const [proj1, proj2, proj3] = await Promise.all([
      Project.create({ organizationId: org._id, name: 'Client Website Revamp',       clientId, projectLeadId: String(om._id),       projectType: 'website', status: 'active', deadline: new Date(Date.now() + 30 * 86400000) }),
      Project.create({ organizationId: org._id, name: 'Meta Ads — Q2 Campaign',       clientId, projectLeadId: String(sakshi._id),    projectType: 'ads',     status: 'active', deadline: new Date(Date.now() + 15 * 86400000) }),
      Project.create({ organizationId: org._id, name: 'Influencer Campaign — Summer', clientId, projectLeadId: String(priyanka._id), projectType: 'combined',status: 'active', deadline: new Date(Date.now() + 45 * 86400000) }),
    ]);

    const mkTask = (projectId: any, assignedTo: string, title: string, taskType: string, status: string, priority: string, daysFromNow: number) =>
      ({ projectId, organizationId: org._id, assignedTo, assignedBy: String(rahul._id), title, taskType, status, priority, dueDate: new Date(Date.now() + daysFromNow * 86400000) });

    await ProjectTask.insertMany([
      mkTask(proj1._id, String(om._id),       'Setup Next.js + Tailwind',         'dev',        'done',    'high',   -10),
      mkTask(proj1._id, String(om._id),       'Home page hero + nav',             'dev',        'done',    'high',    -8),
      mkTask(proj1._id, String(om._id),       'Services section UI',              'dev',        'ongoing', 'urgent',   3),
      mkTask(proj1._id, String(om._id),       'Contact form + email integration', 'dev',        'pending', 'medium',   5),
      mkTask(proj1._id, String(om._id),       'Mobile responsiveness QA',         'dev',        'pending', 'high',    -2),
      mkTask(proj1._id, String(om._id),       'Deploy to Vercel production',      'dev',        'pending', 'urgent',  12),
      mkTask(proj2._id, String(sakshi._id),   'Audience research & pixel setup',  'ads',        'done',    'high',    -5),
      mkTask(proj2._id, String(sakshi._id),   'Ad creatives — 3 variations',      'ads',        'done',    'high',    -3),
      mkTask(proj2._id, String(sakshi._id),   'A/B test ad copy',                 'ads',        'ongoing', 'urgent',   1),
      mkTask(proj2._id, String(sakshi._id),   'Retargeting campaign setup',       'ads',        'pending', 'high',     4),
      mkTask(proj2._id, String(sakshi._id),   'Weekly ROAS report',               'admin_task', 'pending', 'medium',   6),
      mkTask(proj3._id, String(priyanka._id), 'Influencer shortlist (50)',         'content',    'done',    'high',   -12),
      mkTask(proj3._id, String(priyanka._id), 'Outreach DMs — batch 1',           'content',    'done',    'high',    -9),
      mkTask(proj3._id, String(priyanka._id), 'Brief & content kit sent',         'content',    'ongoing', 'urgent',   2),
      mkTask(proj3._id, String(priyanka._id), 'UGC collection & approval',        'content',    'pending', 'high',     7),
      mkTask(proj3._id, String(priyanka._id), 'Monthly engagement report',        'content',    'pending', 'medium',  14),
    ]);

    for (const p of [proj1, proj2, proj3]) {
      const all = await ProjectTask.find({ projectId: p._id });
      const now = new Date();
      await Project.findByIdAndUpdate(p._id, {
        totalTasks: all.length,
        completedTasks: all.filter(t => t.status === 'done').length,
        overdueTasks: all.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < now).length,
      });
    }

    const leads = await Lead.insertMany([
      { organizationId: org._id, name: 'Ratan Industries',   contact: '+91 98100 11111', company: 'Ratan Industries', source: 'referral',  stage: 'connected',    status: 'connected',    assignedTo: String(rishi._id), estimatedValue: 150000 },
      { organizationId: org._id, name: 'Priya Startup',      contact: '+91 98765 43210', company: 'Priya Tech',       source: 'website',   stage: 'demo_booked',  status: 'demo_booked',  assignedTo: String(rishi._id), estimatedValue: 75000  },
      { organizationId: org._id, name: 'MegaCorp India',     contact: 'bd@megacorp.in',  company: 'MegaCorp',         source: 'cold_call', stage: 'demo_done',    status: 'demo_done',    assignedTo: String(rishi._id), estimatedValue: 300000 },
      { organizationId: org._id, name: 'GreenLeaf Organics', contact: 'info@greenleaf.in',company:'GreenLeaf',        source: 'social',    stage: 'won',          status: 'won',          assignedTo: String(rishi._id), estimatedValue: 90000, wonAmount: 90000, closedAt: new Date(Date.now() - 5 * 86400000) },
      { organizationId: org._id, name: 'XYZ Retail',         contact: 'contact@xyz.in',  company: 'XYZ Retail',       source: 'other',     stage: 'lost',         status: 'lost',         assignedTo: String(rishi._id), estimatedValue: 50000  },
      { organizationId: org._id, name: 'FreshBake Mumbai',   contact: '+91 97000 22222', company: 'FreshBake',        source: 'inbound',   stage: 'hot_follow_up',status: 'hot_follow_up',assignedTo: String(rishi._id), estimatedValue: 60000  },
      { organizationId: org._id, name: 'StyleKart',          contact: '+91 97000 33333', company: 'StyleKart',        source: 'website',   stage: 'follow_up',    status: 'follow_up',    assignedTo: String(rishi._id), estimatedValue: 45000  },
    ]);

    await Deal.insertMany([
      { organizationId: org._id, clientId, leadId: leads[3]._id, dealValue: 90000,  currency: 'INR', serviceType: 'ads',      status: 'won',  closedAt: new Date(Date.now() -  5 * 86400000) },
      { organizationId: org._id, clientId, leadId: leads[2]._id, dealValue: 300000, currency: 'INR', serviceType: 'combined', status: 'open' },
      { organizationId: org._id, clientId, leadId: leads[4]._id, dealValue: 50000,  currency: 'INR', serviceType: 'website',  status: 'lost', closedAt: new Date(Date.now() - 10 * 86400000) },
    ]);

    await ClientTransaction.insertMany([
      { organizationId: org._id, clientId, amount: 45000, currency: 'INR', status: 'paid',    description: 'Website — milestone 1',   date: new Date(Date.now() - 20 * 86400000) },
      { organizationId: org._id, clientId, amount: 30000, currency: 'INR', status: 'pending', description: 'Ads management — Month 1', date: new Date() },
      { organizationId: org._id, clientId, amount: 90000, currency: 'INR', status: 'overdue', description: 'Brand identity — payment',  date: new Date(Date.now() - 30 * 86400000) },
    ]);

    await Influencer.insertMany([
      { organizationId: org._id, addedBy: priyanka._id, name: 'Sneha Arora',    handle: 'sneha.arora',   platform: 'instagram', category: 'fashion',       followers: 285000, engagementRate: 4.2, ratePerPost: 18000, email: 'sneha@snehaworld.in',  city: 'Mumbai',    status: 'active',      notes: 'Great for festive launches.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Kavya Menon',    handle: 'kavya.m',       platform: 'instagram', category: 'fashion',       followers: 95000,  engagementRate: 6.1, ratePerPost: 8000,  email: 'kavya@gmail.com',      city: 'Bangalore', status: 'approached',  notes: 'Trial reel at ₹8K.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Ayesha Khan',    handle: 'brishti_ay',    platform: 'instagram', category: 'beauty',        followers: 510000, engagementRate: 3.8, ratePerPost: 32000, email: 'collabs@ayeshak.in',   city: 'Delhi',     status: 'active',      notes: 'Skincare niche. Top performer.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Ritika Singh',   handle: 'ritika.glows',  platform: 'instagram', category: 'beauty',        followers: 68000,  engagementRate: 5.5, ratePerPost: 5500,  email: 'ritikabeauty@gmail.com',city: 'Jaipur',   status: 'prospect',    notes: 'Nail & makeup.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Rohit Shetty',   handle: 'rohitkitchen',  platform: 'youtube',   category: 'food',          followers: 1200000,engagementRate: 2.1, ratePerPost: 75000, email: 'biz@rohitkitchen.in',  city: 'Pune',      status: 'approached',  notes: 'Food review channel.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Deepika Nair',   handle: 'deepika_bites', platform: 'instagram', category: 'food',          followers: 145000, engagementRate: 4.9, ratePerPost: 12000, email: 'deepika@tastefully.in',city: 'Kochi',      status: 'active',      notes: 'Kerala cuisine.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Arjun Mehta',    handle: 'fitarjun',      platform: 'instagram', category: 'fitness',       followers: 320000, engagementRate: 5.2, ratePerPost: 20000, email: 'arjunfit@gmail.com',   city: 'Ahmedabad', status: 'active',      notes: 'Gym + nutrition.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Prerna Verma',   handle: 'prerna.yoga',   platform: 'instagram', category: 'fitness',       followers: 88000,  engagementRate: 7.3, ratePerPost: 7000,  email: 'prenrayoga@outlook.com',city: 'Lucknow',  status: 'prospect',    notes: 'Yoga & wellness.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Samar Khan',     handle: 'samartravels',  platform: 'youtube',   category: 'travel',        followers: 890000, engagementRate: 3.0, ratePerPost: 55000, email: 'collab@samartravels.in',city: 'Hyderabad', status: 'active',      notes: 'Budget travel vlogs.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Nidhi Kapoor',   handle: 'wanderlust_ni', platform: 'instagram', category: 'travel',        followers: 175000, engagementRate: 4.4, ratePerPost: 14000, email: 'nidhi@wanderstories.in',city: 'Delhi',     status: 'approached',  notes: 'Luxury travel.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Harsh Patel',    handle: 'harshtechie',   platform: 'youtube',   category: 'tech',          followers: 430000, engagementRate: 2.8, ratePerPost: 28000, email: 'collab@harshtech.in',  city: 'Surat',     status: 'prospect',    notes: 'Gadget reviews.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Tanvi Desai',    handle: 'tanvi.techlife', platform: 'instagram',category: 'tech',          followers: 62000,  engagementRate: 3.9, ratePerPost: 6000,  email: 'tanvidesai@gmail.com', city: 'Nashik',    status: 'prospect',    notes: 'Female tech influencer.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Meera Iyer',     handle: 'meera.life',    platform: 'instagram', category: 'lifestyle',     followers: 220000, engagementRate: 4.7, ratePerPost: 16000, email: 'pr@meeralives.in',     city: 'Chennai',   status: 'active',      notes: 'Home decor + lifestyle.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Jay Sharma',     handle: 'jay.everyday',  platform: 'instagram', category: 'lifestyle',     followers: 78000,  engagementRate: 5.8, ratePerPost: 7500,  email: 'jaysharma@gmail.com',  city: 'Indore',    status: 'approached',  notes: "Men's lifestyle." },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Ananya Bhatt',   handle: 'ananya.comedy', platform: 'instagram', category: 'entertainment', followers: 650000, engagementRate: 6.5, ratePerPost: 45000, email: 'booking@ananyab.com',  city: 'Mumbai',    status: 'active',      notes: 'Meme reels. Youth products.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Rohan Das',      handle: 'rohancomedy',   platform: 'youtube',   category: 'entertainment', followers: 980000, engagementRate: 2.4, ratePerPost: 60000, email: 'collab@rohandas.in',   city: 'Kolkata',   status: 'prospect',    notes: 'Bengali comedy.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Pooja Rathore',  handle: 'pooja.parenting',platform: 'instagram',category: 'parenting',    followers: 115000, engagementRate: 5.1, ratePerPost: 9000,  email: 'pooja.r@gmail.com',    city: 'Bhopal',    status: 'active',      notes: 'Mommy blogger.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Vishal Sood',    handle: 'educatevsood',  platform: 'youtube',   category: 'education',     followers: 760000, engagementRate: 3.3, ratePerPost: 40000, email: 'biz@vishalsood.com',   city: 'Chandigarh',status: 'approached',  notes: 'Career + UPSC content.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Bhavna Joshi',   handle: 'bhavna.snaps',  platform: 'instagram', category: 'photography',   followers: 48000,  engagementRate: 6.9, ratePerPost: 4500,  email: 'bhavna.clicks@gmail.com',city: 'Ahmedabad',status: 'prospect',    notes: 'Product photography.' },
      { organizationId: org._id, addedBy: priyanka._id, name: 'Karan Malhotra', handle: 'karanshots',    platform: 'instagram', category: 'photography',   followers: 92000,  engagementRate: 4.0, ratePerPost: 8500,  email: 'karan@karanshots.in',  city: 'Gurgaon',   status: 'blacklisted', notes: 'Posted without disclosure. Do not rebook.' },
    ]);

    res.json({
      ok: true,
      message: 'Production database reseeded successfully',
      summary: { org: org.name, users: 9, influencers: 20, leads: 7, projects: 3 },
      credentials: {
        real: ['rahul@hastag.in / Rahul@1234', 'rishi@hastag.in / Rishi@1234', 'sakshi@hastag.in / Sakshi@1234', 'priyanka@hastag.in / Priyanka@1234', 'om@hastag.in / Om@1234'],
        demo: ['admin@robin.app / Admin1234!', 'employee@robin.app / Employee1234!', 'client@robin.app / Client1234!', 'sales@robin.app / Sales1234!'],
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
