import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../src/models/User';
import Organization from '../src/models/Organization';
import Project from '../src/models/Project';
import ProjectTask from '../src/models/ProjectTask';
import Lead from '../src/models/Lead';
import Deal from '../src/models/Deal';
import Metric from '../src/models/Metric';
import ClientTransaction from '../src/models/ClientTransaction';
import ProjectUpdate from '../src/models/ProjectUpdate';
import Session from '../src/models/Session';
import LeadNote from '../src/models/LeadNote';

const hash = (p: string) => bcrypt.hash(p, 10);

async function seed() {
  console.log('[Seed] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('[Seed] Connected ✓');

  await Promise.all([
    User.deleteMany({}), Organization.deleteMany({}), Project.deleteMany({}),
    ProjectTask.deleteMany({}), Lead.deleteMany({}), Deal.deleteMany({}),
    Metric.deleteMany({}), ClientTransaction.deleteMany({}),
    ProjectUpdate.deleteMany({}), Session.deleteMany({}), LeadNote.deleteMany({}),
  ]);
  console.log('[Seed] Cleared existing data ✓');

  // ── 1. Organization ───────────────────────────────────────────────────────
  const org = await Organization.create({ name: 'Hastag Agency', plan: 'pro' });

  // ── 2. Real Team + Demo Users ─────────────────────────────────────────────
  const [
    rahul, rishi, sakshi, priyanka, om,
    adminDemo, empDemo, clientUser, salesDemo,
  ] = await Promise.all([
    // ── REAL TEAM ──
    User.create({ email: 'rahul@hastag.in',    passwordHash: await hash('Rahul@1234'),    name: 'Rahul',    role: 'admin',    team: 'management',  department: 'Management',        organizationId: org._id }),
    User.create({ email: 'rishi@hastag.in',    passwordHash: await hash('Rishi@1234'),    name: 'Rishi',    role: 'sales',    team: 'sales',        department: 'Sales',             organizationId: org._id }),
    User.create({ email: 'sakshi@hastag.in',   passwordHash: await hash('Sakshi@1234'),   name: 'Sakshi',   role: 'employee', team: 'ads',           department: 'Meta Ads',          organizationId: org._id }),
    User.create({ email: 'priyanka@hastag.in', passwordHash: await hash('Priyanka@1234'), name: 'Priyanka', role: 'employee', team: 'influencer',    department: 'Influencer Mktg',   organizationId: org._id }),
    User.create({ email: 'om@hastag.in',       passwordHash: await hash('Om@1234'),       name: 'Om',       role: 'employee', team: 'dev',           department: 'Web Development',   organizationId: org._id }),
    // ── DEMO ACCOUNTS ──
    User.create({ email: 'admin@robin.app',    passwordHash: await hash('Admin1234!'),    name: 'Admin User',   role: 'admin',    team: '', organizationId: org._id }),
    User.create({ email: 'employee@robin.app', passwordHash: await hash('Employee1234!'), name: 'Alex Employee',role: 'employee', team: 'dev', organizationId: org._id }),
    User.create({ email: 'client@robin.app',   passwordHash: await hash('Client1234!'),   name: 'Acme Corp',    role: 'client',   team: '', organizationId: org._id }),
    User.create({ email: 'sales@robin.app',    passwordHash: await hash('Sales1234!'),    name: 'Sam Sales',    role: 'sales',    team: 'sales', organizationId: org._id }),
  ]);
  console.log('[Seed] Created 9 users ✓');

  const rahulId   = String(rahul._id);
  const rishiId   = String(rishi._id);
  const sakshiId  = String(sakshi._id);
  const priyankaId= String(priyanka._id);
  const omId      = String(om._id);
  const clientId  = String(clientUser._id);
  const empId     = String(empDemo._id);
  const adminId   = String(rahul._id); // Rahul = Admin

  // ── 3. Projects ───────────────────────────────────────────────────────────
  const [proj1, proj2, proj3, proj4] = await Promise.all([
    Project.create({ organizationId: org._id, name: 'Client Website Revamp',       clientId, projectLeadId: omId,      projectType: 'website',  status: 'active',  deadline: new Date(Date.now() + 30 * 86400000) }),
    Project.create({ organizationId: org._id, name: 'Meta Ads — Q2 Campaign',       clientId, projectLeadId: sakshiId, projectType: 'ads',      status: 'active',  deadline: new Date(Date.now() + 15 * 86400000) }),
    Project.create({ organizationId: org._id, name: 'Influencer Campaign — Summer', clientId, projectLeadId: priyankaId,projectType: 'combined', status: 'active',  deadline: new Date(Date.now() + 45 * 86400000) }),
    Project.create({ organizationId: org._id, name: 'Brand Identity Package',       clientId, projectLeadId: rahulId,  projectType: 'combined', status: 'active',  deadline: new Date(Date.now() + 20 * 86400000) }),
  ]);
  console.log('[Seed] Created 4 projects ✓');

  // ── 4. Tasks (assigned to real team members) ──────────────────────────────
  const makeTasks = (projectId: any, assignedTo: string, items: any[]) =>
    items.map(t => ({ ...t, projectId, organizationId: org._id, assignedTo, assignedBy: rahulId }));

  const omTasks = makeTasks(proj1._id, omId, [
    { title: 'Setup Next.js + Tailwind',        taskType: 'dev',        status: 'done',       priority: 'high',   dueDate: new Date(Date.now() - 10 * 86400000) },
    { title: 'Home page — hero + nav',          taskType: 'dev',        status: 'done',       priority: 'high',   dueDate: new Date(Date.now() -  8 * 86400000) },
    { title: 'Services section UI',             taskType: 'dev',        status: 'ongoing',priority: 'urgent', dueDate: new Date(Date.now() +  3 * 86400000) },
    { title: 'Contact form + email integration',taskType: 'dev',        status: 'pending',    priority: 'medium', dueDate: new Date(Date.now() +  5 * 86400000) },
    { title: 'SEO meta tags + sitemap',         taskType: 'dev',        status: 'pending',    priority: 'medium', dueDate: new Date(Date.now() +  7 * 86400000) },
    { title: 'Mobile responsiveness QA',        taskType: 'dev',        status: 'pending',    priority: 'high',   dueDate: new Date(Date.now() - 2 * 86400000)  },
    { title: 'Deploy to Vercel production',     taskType: 'dev',        status: 'pending',    priority: 'urgent', dueDate: new Date(Date.now() + 12 * 86400000) },
  ]);

  const sakshiTasks = makeTasks(proj2._id, sakshiId, [
    { title: 'Audience research & pixel setup', taskType: 'ads',        status: 'done',       priority: 'high',   dueDate: new Date(Date.now() -  5 * 86400000) },
    { title: 'Ad creatives — 3 variations',     taskType: 'ads',        status: 'done',       priority: 'high',   dueDate: new Date(Date.now() -  3 * 86400000) },
    { title: 'A/B test ad copy',                taskType: 'ads',        status: 'ongoing',priority: 'urgent', dueDate: new Date(Date.now() +  1 * 86400000) },
    { title: 'Retargeting campaign setup',       taskType: 'ads',        status: 'pending',    priority: 'high',   dueDate: new Date(Date.now() +  4 * 86400000) },
    { title: 'Weekly ROAS performance report',  taskType: 'admin_task', status: 'pending',    priority: 'medium', dueDate: new Date(Date.now() +  6 * 86400000) },
    { title: 'Budget reallocation review',      taskType: 'ads',        status: 'pending',    priority: 'medium', dueDate: new Date(Date.now() -  2 * 86400000) },
  ]);

  const priyankaTasks = makeTasks(proj3._id, priyankaId, [
    { title: 'Influencer shortlist (50 profiles)',taskType: 'content',  status: 'done',       priority: 'high',   dueDate: new Date(Date.now() - 12 * 86400000) },
    { title: 'Outreach DMs — batch 1',           taskType: 'content',  status: 'done',       priority: 'high',   dueDate: new Date(Date.now() -  9 * 86400000) },
    { title: 'Brief & content kit sent',          taskType: 'content',  status: 'ongoing',priority: 'urgent', dueDate: new Date(Date.now() +  2 * 86400000) },
    { title: 'UGC collection & approval',         taskType: 'content',  status: 'pending',    priority: 'high',   dueDate: new Date(Date.now() +  7 * 86400000) },
    { title: 'Campaign performance dashboard',    taskType: 'admin_task',status: 'pending',   priority: 'medium', dueDate: new Date(Date.now() -  3 * 86400000) },
    { title: 'Monthly engagement report',         taskType: 'content',  status: 'pending',    priority: 'medium', dueDate: new Date(Date.now() + 14 * 86400000) },
  ]);

  await ProjectTask.insertMany([...omTasks, ...sakshiTasks, ...priyankaTasks]);

  for (const p of [proj1, proj2, proj3, proj4]) {
    const all = await ProjectTask.find({ projectId: p._id });
    const now = new Date();
    await Project.findByIdAndUpdate(p._id, {
      totalTasks:     all.length,
      completedTasks: all.filter(t => t.status === 'done').length,
      overdueTasks:   all.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < now).length,
    });
  }
  console.log('[Seed] Created tasks ✓');

  // ── 5. Leads (Rishi's pipeline) ───────────────────────────────────────────
  const leads = await Lead.insertMany([
    { organizationId: org._id, name: 'Ratan Industries',   contact: '+91 98100 11111', company: 'Ratan Industries',  source: 'referral',  stage: 'connected',   status: 'connected',   assignedTo: rishiId, estimatedValue: 150000 },
    { organizationId: org._id, name: 'Priya Startup',      contact: '+91 98765 43210', company: 'Priya Tech',        source: 'website',   stage: 'demo_booked', status: 'demo_booked', assignedTo: rishiId, estimatedValue: 75000  },
    { organizationId: org._id, name: 'MegaCorp India',     contact: 'bd@megacorp.in',  company: 'MegaCorp',          source: 'cold_call', stage: 'demo_done',   status: 'demo_done',   assignedTo: rishiId, estimatedValue: 300000 },
    { organizationId: org._id, name: 'GreenLeaf Organics', contact: 'info@greenleaf.in',company: 'GreenLeaf',        source: 'social',    stage: 'won',         status: 'won',         assignedTo: rishiId, estimatedValue: 90000, wonAmount: 90000, closedAt: new Date(Date.now() - 5 * 86400000) },
    { organizationId: org._id, name: 'XYZ Retail',         contact: 'contact@xyz.in',  company: 'XYZ Retail',        source: 'other',     stage: 'lost',        status: 'lost',        assignedTo: rishiId, estimatedValue: 50000  },
    { organizationId: org._id, name: 'FreshBake Mumbai',   contact: '+91 97000 22222', company: 'FreshBake',         source: 'inbound',   stage: 'hot_follow_up',status: 'hot_follow_up',assignedTo: rishiId, estimatedValue: 60000 },
    { organizationId: org._id, name: 'StyleKart',          contact: '+91 97000 33333', company: 'StyleKart',         source: 'website',   stage: 'follow_up',   status: 'follow_up',   assignedTo: rishiId, estimatedValue: 45000  },
  ]);
  await LeadNote.insertMany([
    { leadId: leads[0]._id, organizationId: org._id, authorId: rishiId, content: 'Good call — interested in full digital package. Follow up Wednesday.', type: 'call' },
    { leadId: leads[2]._id, organizationId: org._id, authorId: rishiId, content: 'Demo done, awaiting decision. Proposal sent.', type: 'email' },
    { leadId: leads[5]._id, organizationId: org._id, authorId: rishiId, content: 'Very interested! Founder asked for ROI case study.', type: 'call' },
  ]);
  console.log('[Seed] Created 7 leads ✓');

  // ── 6. Deals ──────────────────────────────────────────────────────────────
  await Deal.insertMany([
    { organizationId: org._id, clientId, leadId: leads[3]._id, dealValue: 90000,  currency: 'INR', serviceType: 'ads',      status: 'won',  closedAt: new Date(Date.now() -  5 * 86400000) },
    { organizationId: org._id, clientId, leadId: leads[2]._id, dealValue: 300000, currency: 'INR', serviceType: 'combined', status: 'open' },
    { organizationId: org._id, clientId, leadId: leads[4]._id, dealValue: 50000,  currency: 'INR', serviceType: 'website',  status: 'lost', closedAt: new Date(Date.now() - 10 * 86400000) },
  ]);
  console.log('[Seed] Created 3 deals ✓');

  // ── 7. Ad Metrics — 30 days (Sakshi's data) ───────────────────────────────
  const metricDefs = [
    { metricName: 'ROAS', projectId: proj2._id },
    { metricName: 'CTR',  projectId: proj2._id },
    { metricName: 'CPC',  projectId: proj2._id },
    { metricName: 'CPL',  projectId: proj2._id },
    { metricName: 'Reach',projectId: proj2._id },
    { metricName: 'Leads',projectId: proj2._id },
  ];
  const metrics: any[] = [];
  for (let i = 30; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000); date.setHours(0,0,0,0);
    for (const m of metricDefs) {
      metrics.push({
        organizationId: org._id, projectId: m.projectId, date, metricName: m.metricName,
        value:
          m.metricName === 'ROAS'  ? +(1.8 + Math.random() * 2.5).toFixed(2) :
          m.metricName === 'CTR'   ? +(2   + Math.random() * 3).toFixed(2) :
          m.metricName === 'CPC'   ? +(12  + Math.random() * 10).toFixed(2) :
          m.metricName === 'CPL'   ? +(350 + Math.random() * 200).toFixed(2) :
          m.metricName === 'Reach' ? Math.floor(5000  + Math.random() * 20000) :
          Math.floor(3 + Math.random() * 25),
      });
    }
  }
  await Metric.insertMany(metrics);
  console.log('[Seed] Created ad metrics ✓');

  // ── 8. Transactions ───────────────────────────────────────────────────────
  await ClientTransaction.insertMany([
    { organizationId: org._id, clientId, amount: 45000, currency: 'INR', status: 'paid',    description: 'Website — milestone 1',      date: new Date(Date.now() - 20 * 86400000) },
    { organizationId: org._id, clientId, amount: 45000, currency: 'INR', status: 'paid',    description: 'Website — milestone 2',      date: new Date(Date.now() - 10 * 86400000) },
    { organizationId: org._id, clientId, amount: 30000, currency: 'INR', status: 'pending', description: 'Ads management — Month 1',   date: new Date() },
    { organizationId: org._id, clientId, amount: 90000, currency: 'INR', status: 'overdue', description: 'Brand identity — full payment', date: new Date(Date.now() - 30 * 86400000) },
  ]);
  console.log('[Seed] Created transactions ✓');

  // ── 9. Work Sessions (last 7 days for each employee) ─────────────────────
  for (const uid of [omId, sakshiId, priyankaId, rishiId]) {
    for (let i = 7; i >= 1; i--) {
      const start = new Date(Date.now() - i * 86400000); start.setHours(9, 0, 0, 0);
      const end   = new Date(start.getTime() + (7 + Math.random() * 2) * 3600000);
      await Session.create({ organizationId: org._id, userId: uid, startTime: start, endTime: end, breakTime: Math.floor(20 + Math.random() * 40), status: 'ended' });
    }
  }
  console.log('[Seed] Created work sessions ✓');

  console.log('\n✅ Hastag Agency seed complete!\n');
  console.log('─────────────────────────────────────────────────');
  console.log('  REAL TEAM');
  console.log('  Rahul (Admin/Mgr): rahul@hastag.in    / Rahul@1234');
  console.log('  Rishi (Sales):     rishi@hastag.in    / Rishi@1234');
  console.log('  Sakshi (Meta Ads): sakshi@hastag.in   / Sakshi@1234');
  console.log('  Priyanka (Influ):  priyanka@hastag.in / Priyanka@1234');
  console.log('  Om (Web Dev):     om@hastag.in        / Om@1234');
  console.log('─────────────────────────────────────────────────');
  console.log('  DEMO ACCOUNTS');
  console.log('  Admin:    admin@robin.app    / Admin1234!');
  console.log('  Employee: employee@robin.app  / Employee1234!');
  console.log('  Client:   client@robin.app    / Client1234!');
  console.log('  Sales:    sales@robin.app     / Sales1234!');
  console.log('─────────────────────────────────────────────────\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('[Seed] Fatal:', err.message || err);
  process.exit(1);
});
