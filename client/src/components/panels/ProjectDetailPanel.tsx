import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Phone, Mail, Sparkles, ExternalLink, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { Button }     from '@/components/ui/Button';
import { StatusPill, type Status } from '@/components/ui/StatusPill';
import { Stat }       from '@/components/ui/Stat';
import { EmptyState } from '@/components/ui/EmptyState';
import { Row }        from '@/components/ui/Row';
import * as api from '@/api';

/**
 * <ProjectDetailPanel /> — drawer content for a single Project (workflow).
 *
 * Anatomy:
 *   - Identity header: client name, phone, email.
 *   - Health snapshot: pill + AI status snapshot button (one-paragraph paste-ready).
 *   - Service rows: each shows progress + status pill + jump-into-full-detail.
 *   - Recent activity strip: last 5 entries from the workflow's audit log.
 *   - Footer: "Open full pipeline" → navigates to /clients/pipeline/:id.
 *
 * Reuses existing endpoints — no new backend.
 */

interface ChecklistItem { done: boolean; text?: string; title?: string }
interface Service {
  _id?: string;
  label: string;
  serviceType: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  checklist: ChecklistItem[];
  assignedTo?: string;
}
interface Workflow {
  _id: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  services: Service[];
  activity?: Array<{ at?: string; createdAt?: string; action: string; detail?: string; actorName?: string }>;
  health?: string;
  healthReason?: string;
  lastUpdate?: { detail?: string; at?: string };
  updatedAt?: string;
}

function statusToPill(status: Service['status']): Status {
  switch (status) {
    case 'done':        return 'ready_to_deliver';
    case 'in_progress': return 'in_huddle';
    case 'blocked':     return 'blocked';
    default:            return 'waiting_internal';
  }
}

function healthToPill(h?: string): Status {
  // Map ClientWorkflow.health values to StatusPill states. The pill component
  // already supports every project-health enum value, but we fall back if
  // the field is unset (default state from the schema is 'healthy').
  return (h as Status) || 'healthy';
}

export function ProjectDetailPanel({ workflowId }: { workflowId: string }) {
  const [wf, setWf]           = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);

  // AI status snapshot — Phase 1 shipped; we surface it here so admin can
  // get a paste-ready paragraph without navigating to the full detail page.
  const [aiSummary, setAiSummary] = useState<{ text: string; aiUsed: boolean } | null>(null);
  const [aiBusy, setAiBusy]       = useState(false);

  const load = async () => {
    try { setWf(await api.cwGetWorkflow(workflowId)); }
    catch { /* axios toast */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [workflowId]);

  const generateSummary = async () => {
    setAiBusy(true);
    try { setAiSummary(await api.aiSummarizeWorkflow(workflowId)); }
    catch { toast.error('AI summary failed'); }
    finally { setAiBusy(false); }
  };

  if (loading || !wf) {
    return <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const services = wf.services || [];
  const total    = services.reduce((n, s) => n + (s.checklist?.length || 0), 0);
  const done     = services.reduce((n, s) => n + (s.checklist?.filter(c => c.done).length || 0), 0);
  const pct      = total ? Math.round((done / total) * 100) : 0;
  const recent   = (wf.activity || []).slice(-5).reverse();

  return (
    <div className="divide-y divide-border">
      {/* Identity */}
      <section className="p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-[15px] font-bold tracking-tight">{wf.clientName || 'Unnamed client'}</h2>
          <StatusPill state={healthToPill(wf.health)} size="sm" label={wf.healthReason || undefined} />
        </div>
        <div className="space-y-1 text-[12px]">
          {wf.clientPhone && (
            <a href={`tel:${wf.clientPhone}`} className="flex items-center gap-1.5 text-primary hover:underline tabular-nums">
              <Phone className="h-3 w-3" /> {wf.clientPhone}
            </a>
          )}
          {wf.clientEmail && (
            <a href={`mailto:${wf.clientEmail}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <Mail className="h-3 w-3" /> {wf.clientEmail}
            </a>
          )}
        </div>
      </section>

      {/* Progress + AI */}
      <section className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Stat block value={`${pct}%`} label="overall" tone="primary" />
          <Stat block value={`${done}/${total}`} label="steps" />
          <Stat block value={services.length} label="services" />
        </div>

        <div className="rounded-md border border-primary/20 bg-primary/[0.03] p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-primary/80">AI status snapshot</span>
          </div>
          {aiSummary ? (
            <p className="text-[12.5px] leading-snug">{aiSummary.text}</p>
          ) : (
            <p className="text-[11.5px] text-muted-foreground">One-paragraph status the team can paste to the client.</p>
          )}
          <Button size="xs" intent="secondary" loading={aiBusy} onClick={generateSummary} iconLeft={<Sparkles className="h-3 w-3" />}>
            {aiSummary ? 'Regenerate' : 'Generate'}
          </Button>
        </div>
      </section>

      {/* Services */}
      <section className="py-1">
        <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Services</p>
        {services.length === 0 ? (
          <EmptyState size="sm" title="No services added yet" />
        ) : (
          services.map(s => {
            const sTotal = s.checklist?.length || 0;
            const sDone  = (s.checklist || []).filter(c => c.done).length;
            const sPct   = sTotal ? Math.round((sDone / sTotal) * 100) : 0;
            return (
              <Row key={s._id || s.serviceType} accent={
                s.status === 'done'     ? 'success' :
                s.status === 'blocked'  ? 'danger'  :
                s.status === 'in_progress' ? 'primary' :
                                             'none'
              }>
                <Row.Leading>
                  <CheckCircle2 className={`h-3.5 w-3.5 ${
                    s.status === 'done'    ? 'text-emerald-600' :
                    s.status === 'blocked' ? 'text-rose-500'    :
                                             'text-muted-foreground'
                  }`} />
                </Row.Leading>
                <Row.Main>
                  <Row.Title>{s.label}</Row.Title>
                  <Row.Meta>{sDone} of {sTotal} steps · {sPct}%</Row.Meta>
                </Row.Main>
                <Row.Trail>
                  <StatusPill state={statusToPill(s.status)} size="xs" />
                </Row.Trail>
              </Row>
            );
          })
        )}
      </section>

      {/* Recent activity */}
      <section className="py-1">
        <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">Recent</p>
        {recent.length === 0 ? (
          <EmptyState size="sm" title="No activity yet" />
        ) : (
          recent.map((a, i) => (
            <Row key={i}>
              <Row.Main>
                <Row.Title>{a.detail || a.action || 'Activity'}</Row.Title>
                <Row.Meta>
                  {a.actorName ? `${a.actorName} · ` : ''}
                  {a.at && formatDistanceToNow(new Date(a.at), { addSuffix: true })}
                </Row.Meta>
              </Row.Main>
            </Row>
          ))
        )}
      </section>

      {/* Footer */}
      <section className="p-3 bg-muted/30">
        <Link to={`/clients/pipeline/${wf._id}`}>
          <Button size="sm" intent="secondary" iconRight={<ExternalLink className="h-3 w-3" />}>
            Open full pipeline
          </Button>
        </Link>
      </section>
    </div>
  );
}
