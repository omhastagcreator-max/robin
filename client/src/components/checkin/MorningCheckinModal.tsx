import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Sunrise, ArrowRight, Sparkles, Plus, X, Megaphone, Pause, PowerOff, CircleAlert,
  Loader2, ListChecks, Calendar, Clock, Search, Command,
} from 'lucide-react';
import * as api from '@/api';
import { useCheckin, type BrandForMorning } from '@/contexts/CheckinContext';
import { celebrate } from '@/lib/celebrate';

/**
 * MorningCheckinModal — the first of three daily pulses.
 *
 * Two compact steps (each ≤20 seconds):
 *
 *   1. Brand pulse — one Meta-status chip per assigned brand + optional
 *      one-liner. Brands without Meta service auto-default to 'na' so
 *      the user only has to actively answer the ones that matter.
 *
 *   2. Today's tasks — autocomplete-backed input that surfaces:
 *        • Recent tasks the user has done in the last 14 days
 *        • Open checklist items from their assigned brands
 *        • Common templates ("Client meeting", "Weekly report" …)
 *      Toggle "Meeting" on the add row to switch a row into a calendar
 *      capture (brand + time + agenda → mirrored to ProjectTask with
 *      category='meeting' + dueDate=meetingAt so the workroom inbox
 *      surfaces it with the calendar icon).
 *
 * Tasks are mirrored into ProjectTask on submit; they show up on the
 * workroom inbox + brand workspace + ledger.
 *
 * Modal is NOT dismissible until submit succeeds — owner rule. The
 * window-flag mirror in CheckinContext keeps the huddle gate in sync.
 */
export function MorningCheckinModal() {
  const { status, openKind, close, refresh } = useCheckin();
  const visible = openKind === 'morning';

  const [step, setStep] = useState<1 | 2>(1);
  const [brandEntries, setBrandEntries] = useState<Record<string, { metaStatus: string; note: string }>>({});
  const [tasks, setTasks] = useState<Array<{
    title: string;
    clientWorkflowId?: string | null;
    priority: string;
    kind: 'task' | 'meeting';
    meetingAt?: string | null;
  }>>([]);
  const [taskInput, setTaskInput]   = useState('');
  const [taskBrandSel, setTaskBrandSel] = useState<string>('');
  const [taskPriSel, setTaskPriSel]     = useState<string>('medium');
  const [taskKind, setTaskKind]         = useState<'task' | 'meeting'>('task');
  const [meetingTime, setMeetingTime]   = useState<string>('');     // HH:MM (local)
  const [suggestions, setSuggestions]   = useState<Array<{ title: string; source: string; clientWorkflowId?: string; clientName?: string }>>([]);
  const [showSugg, setShowSugg]         = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ───────── Initial seed: defaults + draft restore + suggestions ───────── */
  useEffect(() => {
    if (!visible || !status) return;
    const draftKey = `robin.checkin.morning.draft.${status.dateIST}`;
    let draftBrands: typeof brandEntries | null = null;
    let draftTasks: typeof tasks | null = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.brands && typeof parsed.brands === 'object') draftBrands = parsed.brands;
          if (Array.isArray(parsed.tasks)) draftTasks = parsed.tasks;
        }
      }
    } catch { /* ignore corrupt draft */ }

    const init: Record<string, { metaStatus: string; note: string }> = {};
    for (const b of status.brandsForMorning) {
      const d = draftBrands?.[b.clientWorkflowId];
      init[b.clientWorkflowId] = {
        metaStatus: d?.metaStatus ?? (b.hasMeta ? '' : 'na'),
        note: d?.note ?? '',
      };
    }
    setBrandEntries(init);
    setStep(status.brandsForMorning.length === 0 ? 2 : 1);

    if (draftTasks && draftTasks.length > 0) {
      // Backfill missing kind for older drafts.
      setTasks(draftTasks.map(t => ({ ...t, kind: (t as any).kind || 'task' })));
    } else {
      const plan = status.yesterdayTomorrowPlan || '';
      const lines = plan
        .split(/[\n,•]+/g)
        .map(l => l.trim().replace(/^[-*]\s*/, ''))
        .filter(l => l.length > 0 && l.length <= 200)
        .slice(0, 6);
      setTasks(lines.length > 0
        ? lines.map(l => ({ title: l, clientWorkflowId: null, priority: 'medium', kind: 'task' as const }))
        : []);
    }

    // Pre-fetch suggestions in the background — they're not blocking
    // and the user only needs them once they reach step 2 anyway.
    api.getCheckinSuggestions()
      .then(r => { if (r?.suggestions) setSuggestions(r.suggestions); })
      .catch(() => { /* silent — empty suggestions list is fine */ });
  }, [visible, status]);

  /* ───────── Draft persistence ───────── */
  useEffect(() => {
    if (!visible || !status) return;
    try {
      localStorage.setItem(
        `robin.checkin.morning.draft.${status.dateIST}`,
        JSON.stringify({ brands: brandEntries, tasks }),
      );
    } catch { /* quota / private mode */ }
  }, [visible, status, brandEntries, tasks]);

  /* ───────── Autofocus task input on step 2 ───────── */
  useEffect(() => {
    if (visible && step === 2) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [visible, step]);

  /* ───────── Safety net: close if server says morning already done ─────── */
  useEffect(() => {
    if (visible && status?.morning?.done) close();
  }, [visible, status?.morning?.done, close]);

  /* ───────── Filtered suggestions for typeahead ───────── */
  const filteredSuggestions = useMemo(() => {
    const q = taskInput.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 6);
    return suggestions
      .filter(s => s.title.toLowerCase().includes(q) && s.title.toLowerCase() !== q)
      .slice(0, 6);
  }, [suggestions, taskInput]);

  if (!visible) return null;
  if (!status) return null;

  const brands = status.brandsForMorning;
  const allMetaPicked = brands.every(b => {
    const e = brandEntries[b.clientWorkflowId];
    return e && (e.metaStatus !== '' || !b.hasMeta);
  });

  /* ───────── Add / remove / next / submit ───────── */
  const addTask = (override?: { title?: string; clientWorkflowId?: string }) => {
    const title = (override?.title ?? taskInput).trim();
    if (!title) return;
    if (tasks.length >= 20) {
      toast.error('Max 20 tasks per day. Edit the list instead.');
      return;
    }
    let meetingAt: string | null = null;
    if (taskKind === 'meeting' && meetingTime) {
      // Build full ISO from today's IST date + the picked HH:MM.
      const ist = new Date(Date.now() + 330 * 60_000);
      const [hh, mm] = meetingTime.split(':').map(n => parseInt(n, 10));
      ist.setUTCHours(hh, mm, 0, 0);
      // ist is in "IST disguise"; subtract 5:30 to get UTC ISO.
      const utc = new Date(ist.getTime() - 330 * 60_000);
      meetingAt = utc.toISOString();
    }
    setTasks(p => [...p, {
      title: title.slice(0, 200),
      clientWorkflowId: override?.clientWorkflowId ?? taskBrandSel ?? null,
      priority: taskPriSel,
      kind: taskKind,
      meetingAt,
    }]);
    setTaskInput('');
    setShowSugg(false);
    if (taskKind === 'meeting') {
      // Keep meeting mode + clear time so it's obvious you can add another.
      setMeetingTime('');
    }
    inputRef.current?.focus();
  };

  const removeTask = (idx: number) => setTasks(p => p.filter((_, i) => i !== idx));

  const next = () => {
    if (!allMetaPicked) { toast.error('Pick a Meta status for every brand.'); return; }
    setStep(2);
  };

  const submit = async () => {
    if (submitting) return;
    if (tasks.length === 0) { toast.error('Add at least one task or meeting for today.'); return; }
    setSubmitting(true);
    try {
      await api.submitMorningCheckin({
        brands: brands.map(b => ({
          clientWorkflowId: b.clientWorkflowId,
          clientName: b.clientName,
          metaStatus: brandEntries[b.clientWorkflowId]?.metaStatus || 'na',
          note: brandEntries[b.clientWorkflowId]?.note || '',
        })),
        tasks,
      });
      try { localStorage.removeItem(`robin.checkin.morning.draft.${status.dateIST}`); } catch { /* */ }
      await refresh();
      celebrate();
      toast.success("Morning checkin done! Let's get to it.", { duration: 4000 });
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ───────── Progress meter values ───────── */
  const step1Pct = brands.length === 0 ? 100 : Math.round((brands.filter(b => {
    const e = brandEntries[b.clientWorkflowId];
    return e && e.metaStatus && e.metaStatus !== '';
  }).length / brands.length) * 100);
  const step2Pct = tasks.length === 0 ? 0 : Math.min(100, tasks.length * 25);
  const overallPct = step === 1 ? Math.round(step1Pct * 0.5) : Math.round(50 + step2Pct * 0.5);

  return (
    <div className="fixed inset-0 z-[150] bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-card text-card-foreground rounded-3xl shadow-2xl w-full max-w-2xl border border-border max-h-[94vh] flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-amber-400/20 via-orange-400/15 to-rose-400/15 border-b border-border/40 overflow-hidden">
          {/* Soft decorative orb */}
          <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-amber-300/30 blur-3xl pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Sunrise className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold leading-tight">Good morning! Let's plan the day.</h2>
              <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">
                {step === 1
                  ? 'One chip per brand — 15 seconds.'
                  : 'Type a task or pick from your usual list. Add a meeting if you have one.'}
              </p>
            </div>
            <span className="hidden sm:inline-flex h-7 px-2.5 rounded-full bg-amber-500/15 text-amber-800 text-[10.5px] font-bold tracking-wider items-center gap-1 border border-amber-500/30">
              <span>STEP {step} / 2</span>
            </span>
          </div>
          {/* Progress meter */}
          <div className="mt-4 relative h-1.5 rounded-full bg-amber-100/60 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
              style={{ width: `${overallPct}%` }}
            />
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {step === 1 && (
            <>
              <SectionTitle icon={<Megaphone className="h-3.5 w-3.5 text-orange-600" />} title="Daily Meta pulse" sub="Pick the current state per brand. Add a one-liner only if there's a blocker." />

              {brands.length === 0 && (
                <EmptyCard
                  title="No brands assigned yet"
                  sub="Skip ahead — just add today's tasks on the next step."
                />
              )}

              {brands.map((b) => (
                <BrandRow
                  key={b.clientWorkflowId}
                  brand={b}
                  value={brandEntries[b.clientWorkflowId] || { metaStatus: '', note: '' }}
                  onChange={(v) => setBrandEntries(p => ({ ...p, [b.clientWorkflowId]: v }))}
                />
              ))}
            </>
          )}

          {step === 2 && (
            <>
              <SectionTitle icon={<ListChecks className="h-3.5 w-3.5 text-amber-600" />} title="Today's tasks + meetings" sub="Start typing — Robin suggests from your recent work, brand checklists and common templates." />

              {tasks.length > 0 && status.yesterdayTomorrowPlan && (
                <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-3 py-2 text-[11.5px] text-emerald-800">
                  Pre-filled from yesterday's plan. Trim anything that doesn't apply today.
                </div>
              )}

              {/* Add row */}
              <div className="rounded-2xl border border-border bg-muted/30 p-3 space-y-2.5">
                {/* Kind toggle */}
                <div className="flex items-center gap-1.5">
                  <KindChip active={taskKind === 'task'} onClick={() => setTaskKind('task')} icon={<ListChecks className="h-3 w-3" />}>Task</KindChip>
                  <KindChip active={taskKind === 'meeting'} onClick={() => setTaskKind('meeting')} icon={<Calendar className="h-3 w-3" />}>Meeting with client</KindChip>
                </div>

                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    ref={inputRef}
                    value={taskInput}
                    onChange={e => { setTaskInput(e.target.value); setShowSugg(true); }}
                    onFocus={() => setShowSugg(true)}
                    onBlur={() => setTimeout(() => setShowSugg(false), 140)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addTask(); }
                      else if (e.key === 'Escape') setShowSugg(false);
                    }}
                    placeholder={taskKind === 'meeting' ? 'Meeting topic (e.g. WOODSIFY weekly review)' : 'e.g. Launch Bhawna\'s reel for WOODSIFY'}
                    className="w-full h-10 pl-9 pr-3 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400/40 transition-all"
                  />
                  {/* Autocomplete dropdown */}
                  {showSugg && filteredSuggestions.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-3 pt-2 pb-1">
                        Suggestions
                      </p>
                      {filteredSuggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          // onMouseDown not onClick — onBlur on the input fires before
                          // onClick which would close the dropdown before the click registered.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addTask({ title: s.title, clientWorkflowId: s.clientWorkflowId });
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/60 transition-colors text-[12.5px]"
                        >
                          <SourceBadge source={s.source} />
                          <span className="flex-1 min-w-0 truncate">{s.title}</span>
                          <span className="text-[10px] text-muted-foreground">add</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Meeting time picker (only when kind=meeting) */}
                {taskKind === 'meeting' && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="time"
                      value={meetingTime}
                      onChange={e => setMeetingTime(e.target.value)}
                      className="h-8 px-2 rounded-lg bg-background border border-border text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                    />
                    <span className="text-[11px] text-muted-foreground">today IST</span>
                  </div>
                )}

                {/* Brand + priority + add */}
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={taskBrandSel}
                    onChange={e => setTaskBrandSel(e.target.value)}
                    className="h-8 px-2 rounded-lg bg-background border border-border text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  >
                    <option value="">No brand</option>
                    {brands.map(b => (
                      <option key={b.clientWorkflowId} value={b.clientWorkflowId}>{b.clientName}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    {(['low', 'medium', 'high', 'urgent'] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setTaskPriSel(p)}
                        className={
                          'h-7 px-2.5 rounded-full text-[11px] font-semibold transition-all ' +
                          (taskPriSel === p
                            ? (p === 'urgent' ? 'bg-rose-500 text-white scale-105' :
                               p === 'high'   ? 'bg-orange-500 text-white scale-105' :
                               p === 'medium' ? 'bg-blue-500 text-white scale-105' :
                                                'bg-foreground text-background scale-105')
                            : 'bg-muted/60 text-muted-foreground hover:bg-muted')
                        }
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => addTask()}
                    disabled={!taskInput.trim() || (taskKind === 'meeting' && !meetingTime)}
                    className="ml-auto h-8 px-3 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-40 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>

                <p className="text-[10.5px] text-muted-foreground flex items-center gap-1">
                  <Command className="h-3 w-3" /> Tip: press <kbd className="px-1 bg-card border border-border rounded text-[10px]">Enter</kbd> to add
                </p>
              </div>

              {/* Task list */}
              <div className="space-y-1.5">
                {tasks.map((t, i) => {
                  const brandName = t.clientWorkflowId ? brands.find(b => b.clientWorkflowId === t.clientWorkflowId)?.clientName : '';
                  const isMeeting = t.kind === 'meeting';
                  const time = t.meetingAt ? new Date(t.meetingAt) : null;
                  const timeStr = time ? time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
                  return (
                    <div key={i} className={
                      'group flex items-center gap-2 rounded-xl px-3 py-2 transition-colors ' +
                      (isMeeting
                        ? 'bg-indigo-500/5 border border-indigo-500/30 hover:bg-indigo-500/10'
                        : 'bg-background border border-border hover:bg-muted/30')
                    }>
                      {isMeeting
                        ? <Calendar className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                        : <span className={
                            'h-1.5 w-1.5 rounded-full shrink-0 ' +
                            (t.priority === 'urgent' ? 'bg-rose-500' :
                             t.priority === 'high'   ? 'bg-orange-500' :
                             t.priority === 'medium' ? 'bg-blue-500' :
                                                       'bg-muted-foreground')
                          } />}
                      <span className="text-sm font-medium min-w-0 truncate">{t.title}</span>
                      {isMeeting && timeStr && (
                        <span className="text-[10.5px] font-bold bg-indigo-500/15 text-indigo-700 px-1.5 py-0.5 rounded">
                          {timeStr}
                        </span>
                      )}
                      {brandName && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded">
                          {brandName}
                        </span>
                      )}
                      <button
                        onClick={() => removeTask(i)}
                        className="ml-auto h-5 w-5 rounded hover:bg-rose-500/15 flex items-center justify-center opacity-50 group-hover:opacity-100 transition-opacity"
                        title="Remove"
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  );
                })}
                {tasks.length === 0 && (
                  <EmptyCard
                    title="Nothing planned yet"
                    sub="Type above and press Enter — Robin will suggest from your usual work."
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="border-t border-border px-6 py-3.5 flex items-center justify-between gap-3 bg-card/80 backdrop-blur-sm">
          {step === 2 ? (
            <button
              onClick={() => setStep(1)}
              className="text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to brand pulse
            </button>
          ) : <span className="text-[11.5px] text-muted-foreground">Two short steps · saves to all dashboards</span>}

          {step === 1 ? (
            <button
              onClick={next}
              className="h-9 px-4 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-md shadow-amber-500/30 hover:shadow-lg hover:shadow-amber-500/40 transition-all"
            >
              Next · Today's tasks <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting || tasks.length === 0}
              className="h-9 px-4 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-md shadow-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/40 transition-all disabled:opacity-50 disabled:shadow-none"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {submitting ? 'Saving…' : 'Start my day'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Sub-components ─────────────────────────── */

function SectionTitle({ icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <div>
      <p className="text-sm font-bold flex items-center gap-1.5">{icon}{title}</p>
      <p className="text-[12px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function EmptyCard({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-muted/30 border border-dashed border-border p-5 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-[12px] text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function KindChip({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: any; children: any }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'h-7 px-2.5 rounded-full text-[11.5px] font-semibold inline-flex items-center gap-1 transition-all ' +
        (active
          ? 'bg-foreground text-background scale-105 shadow-sm'
          : 'bg-muted/60 text-muted-foreground hover:bg-muted')
      }
    >
      {icon}{children}
    </button>
  );
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    recent:    { label: 'Recent',    cls: 'bg-blue-500/15 text-blue-700' },
    checklist: { label: 'Brand',     cls: 'bg-emerald-500/15 text-emerald-700' },
    template:  { label: 'Template',  cls: 'bg-violet-500/15 text-violet-700' },
  };
  const m = map[source] || { label: source, cls: 'bg-muted text-muted-foreground' };
  return <span className={'shrink-0 text-[9.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ' + m.cls}>{m.label}</span>;
}

function BrandRow({
  brand, value, onChange,
}: {
  brand: BrandForMorning;
  value: { metaStatus: string; note: string };
  onChange: (v: { metaStatus: string; note: string }) => void;
}) {
  const opts: Array<{ k: string; label: string; cls: string; Icon: any }> = brand.hasMeta
    ? [
        { k: 'running', label: 'Running', cls: 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white', Icon: Megaphone },
        { k: 'paused',  label: 'Paused',  cls: 'bg-gradient-to-br from-amber-500 to-orange-500 text-white', Icon: Pause },
        { k: 'off',     label: 'Off',     cls: 'bg-gradient-to-br from-rose-500 to-red-500 text-white',    Icon: PowerOff },
        { k: 'pending', label: 'Pending', cls: 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white', Icon: CircleAlert },
      ]
    : [
        { k: 'na', label: 'No Meta service', cls: 'bg-muted text-muted-foreground', Icon: CircleAlert },
      ];

  return (
    <div className="rounded-2xl border border-border bg-background p-3 transition-all hover:shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[13px] font-bold truncate">{brand.clientName}</p>
        {!brand.hasMeta && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">No Meta</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {opts.map(o => {
          const active = value.metaStatus === o.k;
          return (
            <button
              key={o.k}
              type="button"
              onClick={() => onChange({ ...value, metaStatus: o.k })}
              className={
                'h-7 px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 transition-all ' +
                (active ? `${o.cls} scale-105 shadow-md` : 'bg-muted/60 text-muted-foreground hover:bg-muted')
              }
            >
              <o.Icon className="h-3 w-3" />
              {o.label}
            </button>
          );
        })}
      </div>
      {brand.hasMeta && (
        <input
          value={value.note}
          onChange={e => onChange({ ...value, note: e.target.value.slice(0, 280) })}
          placeholder="Optional: anything blocking? (e.g. waiting on creatives)"
          className="mt-2 w-full h-8 px-2.5 rounded-lg bg-muted/30 border border-border text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400/40"
        />
      )}
    </div>
  );
}

export default MorningCheckinModal;
