import 'dotenv/config';
import mongoose from 'mongoose';
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

async function seed() {
  console.log('[Seed] Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('[Seed] Connected ✓');

  // Clear everything
  await Promise.all([
    User.deleteMany({}),
    Organization.deleteMany({}),
    Project.deleteMany({}),
    ProjectTask.deleteMany({}),
    Lead.deleteMany({}),
    Deal.deleteMany({}),
    Metric.deleteMany({}),
    ClientTransaction.deleteMany({}),
    ProjectUpdate.deleteMany({}),
    Session.deleteMany({}),
    LeadNote.deleteMany({}),
  ]);
  console.log('[Seed] Cleared existing data ✓');

  // 1. Organization
  const org = await Organization.create({ name: 'Robin Agency', plan: 'pro' });
  console.log('[Seed] Created organization:', org._id);

  // 2. Users — directly in MongoDB (no Supabase)
  const [adminUser, empUser, clientUser, salesUser] = await Promise.all([
    User.create({ email: 'admin@robin.app', passwordHash: 'Admin1234!', name: 'Admin User', role: 'admin', team: '', organizationId: org._id }),
    User.create({ email: 'employee@robin.app', passwordHash: 'Employee1234!', name: 'Alex Employee', role: 'employee', team: 'web', organizationId: org._id }),
    User.create({ email: 'client@robin.app', passwordHash: 'Client1234!', name: 'Acme Corp', role: 'client', team: '', organizationId: org._id }),
    User.create({ email: 'sales@robin.app', passwordHash: 'Sales1234!', name: 'Sam Sales', role: 'sales', team: 'sales', organizationId: org._id }),
  ]);
  console.log('[Seed] Created 4 users ✓');

  const adminId = String(adminUser._id);
  const empId   = String(empUser._id);
  const clientId = String(clientUser._id);
  const salesId  = String(salesUser._id);

  // 3. Projects
  const [proj1, proj2, proj3] = await Promise.all([
    Project.create({ organizationId: org._id, name: 'TechCorp Website Revamp', clientId, projectLeadId: empId, projectType: 'website', status: 'active', deadline: new Date(Date.now() + 30 * 86400000), members: [{ supabaseId: empId, roleInProject: 'lead' }] }),
    Project.create({ organizationId: org._id, name: 'Q2 Google Ads Campaign',   clientId, projectLeadId: empId, projectType: 'ads',     status: 'active', deadline: new Date(Date.now() + 15 * 86400000) }),
    Project.create({ organizationId: org._id, name: 'Brand Identity Package',   clientId, projectLeadId: adminId, projectType: 'combined', status: 'active', deadline: new Date(Date.now() + 45 * 86400000) }),
  ]);
  console.log('[Seed] Created 3 projects ✓');

  // 4. Tasks
  const tasks = [
    // Project 1
    { projectId: proj1._id, title: 'Setup Next.js project',           taskType: 'dev',        status: 'done',    priority: 'high',   dueDate: new Date(Date.now() - 10 * 86400000) },
    { projectId: proj1._id, title: 'Design wireframes',               taskType: 'dev',        status: 'done',    priority: 'high',   dueDate: new Date(Date.now() -  8 * 86400000) },
    { projectId: proj1._id, title: 'Implement homepage',              taskType: 'dev',        status: 'ongoing', priority: 'urgent', dueDate: new Date(Date.now() +  3 * 86400000) },
    { projectId: proj1._id, title: 'SEO on-page optimization',        taskType: 'content',    status: 'pending', priority: 'medium', dueDate: new Date(Date.now() +  7 * 86400000) },
    { projectId: proj1._id, title: 'Mobile responsiveness fixes',     taskType: 'dev',        status: 'pending', priority: 'high',   dueDate: new Date(Date.now() -  2 * 86400000) },
    { projectId: proj1._id, title: 'Contact form integration',        taskType: 'dev',        status: 'pending', priority: 'medium', dueDate: new Date(Date.now() +  5 * 86400000) },
    { projectId: proj1._id, title: 'Deploy to staging',               taskType: 'dev',        status: 'pending', priority: 'high',   dueDate: new Date(Date.now() + 12 * 86400000) },
    { projectId: proj1._id, title: 'Client review session',           taskType: 'admin_task', status: 'pending', priority: 'high',   dueDate: new Date(Date.now() -  1 * 86400000) },
    { projectId: proj1._id, title: 'Final QA testing',                taskType: 'dev',        status: 'pending', priority: 'urgent', dueDate: new Date(Date.now() + 14 * 86400000) },
    // Project 2
    { projectId: proj2._id, title: 'Keyword research',                taskType: 'ads',        status: 'done',    priority: 'high',   dueDate: new Date(Date.now() -  5 * 86400000) },
    { projectId: proj2._id, title: 'Campaign structure setup',        taskType: 'ads',        status: 'done',    priority: 'high',   dueDate: new Date(Date.now() -  3 * 86400000) },
    { projectId: proj2._id, title: 'Ad copy variations A/B',         taskType: 'content',    status: 'ongoing', priority: 'urgent', dueDate: new Date(Date.now() +  1 * 86400000) },
    { projectId: proj2._id, title: 'Landing page optimization',       taskType: 'ads',        status: 'pending', priority: 'high',   dueDate: new Date(Date.now() -  1 * 86400000) },
    { projectId: proj2._id, title: 'Tracking pixel setup',            taskType: 'ads',        status: 'pending', priority: 'medium', dueDate: new Date(Date.now() +  2 * 86400000) },
    { projectId: proj2._id, title: 'Weekly performance report',       taskType: 'admin_task', status: 'pending', priority: 'low',    dueDate: new Date(Date.now() +  6 * 86400000) },
    { projectId: proj2._id, title: 'Budget reallocation review',      taskType: 'ads',        status: 'pending', priority: 'medium', dueDate: new Date(Date.now() -  2 * 86400000) },
    // Project 3
    { projectId: proj3._id, title: 'Brand discovery call',            taskType: 'admin_task', status: 'done',    priority: 'high',   dueDate: new Date(Date.now() - 12 * 86400000) },
    { projectId: proj3._id, title: 'Mood board creation',             taskType: 'content',    status: 'done',    priority: 'medium', dueDate: new Date(Date.now() -  9 * 86400000) },
    { projectId: proj3._id, title: 'Logo design concepts',            taskType: 'content',    status: 'ongoing', priority: 'urgent', dueDate: new Date(Date.now() +  2 * 86400000) },
    { projectId: proj3._id, title: 'Brand guidelines document',       taskType: 'content',    status: 'pending', priority: 'high',   dueDate: new Date(Date.now() +  7 * 86400000) },
    { projectId: proj3._id, title: 'Social media kit',                taskType: 'content',    status: 'pending', priority: 'medium', dueDate: new Date(Date.now() - 3 * 86400000) },
    { projectId: proj3._id, title: 'Final brand delivery',            taskType: 'admin_task', status: 'pending', priority: 'high',   dueDate: new Date(Date.now() + 15 * 86400000) },
  ];
  await ProjectTask.insertMany(tasks.map(t => ({ ...t, organizationId: org._id, assignedTo: empId, assignedBy: adminId })));

  // Update project counters
  for (const p of [proj1, proj2, proj3]) {
    const all = await ProjectTask.find({ projectId: p._id });
    const now = new Date();
    await Project.findByIdAndUpdate(p._id, {
      totalTasks:     all.length,
      completedTasks: all.filter(t => t.status === 'done').length,
      overdueTasks:   all.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < now).length,
    });
  }
  console.log('[Seed] Created tasks + updated project counters ✓');

  // 5. Leads + Notes
  const leads = await Lead.insertMany([
    { organizationId: org._id, name: 'Ratan Industries',  contact: 'ratan@industries.com', company: 'Ratan Industries',  source: 'referral',  status: 'new',       assignedTo: salesId, estimatedValue: 150000 },
    { organizationId: org._id, name: 'Priya Startup',     contact: '+91 98765 43210',       company: 'Priya Tech',        source: 'website',   status: 'contacted', assignedTo: salesId, estimatedValue: 75000  },
    { organizationId: org._id, name: 'MegaCorp India',    contact: 'bd@megacorp.in',        company: 'MegaCorp',          source: 'cold_call', status: 'qualified', assignedTo: salesId, estimatedValue: 300000 },
    { organizationId: org._id, name: 'GreenLeaf Organics',contact: 'info@greenleaf.in',     company: 'GreenLeaf',         source: 'social',    status: 'converted', assignedTo: salesId, estimatedValue: 90000  },
    { organizationId: org._id, name: 'XYZ Retail',        contact: 'contact@xyz.in',        company: 'XYZ Retail',        source: 'other',     status: 'lost',      assignedTo: salesId, estimatedValue: 50000  },
  ]);
  await LeadNote.insertMany([
    { leadId: leads[0]._id, organizationId: org._id, authorId: salesId, content: 'Initial call — interested in website + ads combo', type: 'call'    },
    { leadId: leads[0]._id, organizationId: org._id, authorId: salesId, content: 'Sent proposal via email',                          type: 'email'   },
    { leadId: leads[2]._id, organizationId: org._id, authorId: salesId, content: 'Meeting scheduled Tuesday 3PM',                   type: 'meeting' },
  ]);
  console.log('[Seed] Created 5 leads + notes ✓');

  // 6. Deals
  await Deal.insertMany([
    { organizationId: org._id, leadId: leads[3]._id, dealValue: 90000,  currency: 'INR', serviceType: 'ads',      status: 'won',  closedAt: new Date(Date.now() -  5 * 86400000) },
    { organizationId: org._id, leadId: leads[2]._id, dealValue: 300000, currency: 'INR', serviceType: 'combined', status: 'open' },
    { organizationId: org._id, leadId: leads[4]._id, dealValue: 50000,  currency: 'INR', serviceType: 'website',  status: 'lost', closedAt: new Date(Date.now() - 10 * 86400000) },
  ]);
  console.log('[Seed] Created 3 deals ✓');

  // 7. Metrics (30 days)
  const metricDefs = [
    { metricName: 'Leads',   projectId: proj2._id },
    { metricName: 'ROAS',    projectId: proj2._id },
    { metricName: 'CTR',     projectId: proj2._id },
    { metricName: 'CPC',     projectId: proj2._id },
  ];
  const metrics = [];
  for (let i = 30; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000);
    date.setHours(0, 0, 0, 0);
    for (const m of metricDefs) {
      metrics.push({
        organizationId: org._id,
        projectId: m.projectId,
        date,
        metricName: m.metricName,
        value:
          m.metricName === 'ROAS' ? 1.5 + Math.random() * 2 :
          m.metricName === 'CTR'  ? 2   + Math.random() * 3 :
          m.metricName === 'CPC'  ? 15  + Math.random() * 10 :
          Math.floor(5 + Math.random() * 20),
      });
    }
  }
  await Metric.insertMany(metrics);
  console.log('[Seed] Created 124 metric data points ✓');

  // 8. Transactions
  await ClientTransaction.insertMany([
    { organizationId: org._id, clientId, amount: 45000, currency: 'INR', status: 'paid',    description: 'Website — milestone 1',       date: new Date(Date.now() - 20 * 86400000) },
    { organizationId: org._id, clientId, amount: 45000, currency: 'INR', status: 'paid',    description: 'Website — milestone 2',       date: new Date(Date.now() - 10 * 86400000) },
    { organizationId: org._id, clientId, amount: 30000, currency: 'INR', status: 'pending', description: 'Ads management — Month 1',    date: new Date() },
    { organizationId: org._id, clientId, amount: 90000, currency: 'INR', status: 'overdue', description: 'Brand identity — full payment', date: new Date(Date.now() - 30 * 86400000) },
  ]);
  console.log('[Seed] Created 4 transactions ✓');

  // 9. Project updates
  await ProjectUpdate.insertMany([
    { organizationId: org._id, projectId: proj1._id, authorId: empId, content: 'Homepage design complete. Hero + nav + services grid done. Ready for client review.', requiresApproval: true,  isApproved: null },
    { organizationId: org._id, projectId: proj1._id, authorId: empId, content: 'Wireframes and sitemap approved. Moving to development phase.',                       requiresApproval: false, isApproved: null },
    { organizationId: org._id, projectId: proj2._id, authorId: empId, content: 'Q2 campaign live. 4 ad groups, 3 ad variants. Week 1: CTR 3.2%, CPC ₹18.',           requiresApproval: true,  isApproved: true  },
    { organizationId: org._id, projectId: proj2._id, authorId: empId, content: 'Proposing budget increase to ₹50k/mo — ROAS trending above 2.5x.',                   requiresApproval: true,  isApproved: false, feedback: 'Wait till month end before increasing.' },
  ]);
  console.log('[Seed] Created 4 project updates ✓');

  // 10. Work sessions (last 7 days)
  for (let i = 7; i >= 1; i--) {
    const start = new Date(Date.now() - i * 86400000);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + (7 + Math.random() * 2) * 3600000);
    await Session.create({ organizationId: org._id, userId: empId, startTime: start, endTime: end, breakTime: Math.floor(30 + Math.random() * 30), status: 'ended' });
  }
  console.log('[Seed] Created 7 work sessions ✓');

  console.log('\n✅ Robin seed complete!\n');
  console.log('  Admin:    admin@robin.app    / Admin1234!');
  console.log('  Employee: employee@robin.app  / Employee1234!');
  console.log('  Client:   client@robin.app    / Client1234!');
  console.log('  Sales:    sales@robin.app     / Sales1234!');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('[Seed] Fatal:', err);
  process.exit(1);
});
