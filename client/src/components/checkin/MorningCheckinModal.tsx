import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Sunrise, ArrowRight, Sparkles, Plus, X, Megaphone, Pause, PowerOff, CircleAlert, Loader2 } from 'lucide-react';
import * as api from '@/api';
import { useCheckin, type BrandForMorning } from '@/contexts/CheckinContext';
import { celebrate } from '@/lib/celebrate';

/**
 * MorningCheckinModal — the first of three daily pulses.
 *
 * Two compact steps (each <= 20 seconds):
 *   1. Brand pulse: for each brand the user is assigned to, pick a
 *      Meta-status chip + optional one-liner note. 'na' is allowed and
 *      defaulted for brands without Meta service, so the user only has
 *      to actively answer for brands that need attention.
 *   2. Today's tasks: chip-style add (Enter or +). Tasks are mirrored
 *      into ProjectTask on submit; they show up on the workroom inbox
 *      and the brand workspace automatically.
 *
 * Why two steps not one form: a long form = a form people skip-fill.
 * Two crisp screens with bold copy + visible progress = a flow people
 * actually finish.
 *
 * Modal is NOT dismissible — no close button until submit succeeds.
 * That's the rule the owner asked for. The flow is short enough that
 * "trapped" feels acceptable.
 */
export function MorningCheckinModal() {
  const { status, openKind, close, refresh } = useCheckin();
  const visible = openKind === 'morning';

  const [step, setStep] = useState<1 | 2>(1);
  const [brandEntries, setBrandEntries] = useState<Record<string, { metaStatus: string; note: string }>>({});
  const [tasks, setTasks] = useState<Array<{ title: string; clientWorkflowId?: string | null; priority: string }>>([]);
  const [taskInput, setTaskInput] = useState('');
  const [taskBrandSel, setTaskBrandSel] = useState<string>('');
  const [taskPriSel, setTaskPriSel]   = useState<string>('medium');
  const [submitting, setSubmitting]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-seed brand defaults: 'na' for no-Meta brands, '' for Meta brands
  // (forces the user to actively pick). Pre-fill tomorrow plan items as
  // task suggestions when applicable.
  //
  // Also load any draft saved during a previous session today — if Robin
  // crashed / browser closed mid-fill we don't make the user re-type
  // everything. localStorage key is keyed on today's IST date so
  // yesterday's draft never bleeds in.
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
    } catch { /* corrupted draft — ignore */ }

    const init: Record<string, { metaStatus: string; note: string }> = {};
    for (const b of status.brandsForMorning) {
      const d = draftBrands?.[b.clientWorkflowId];
      init[b.clientWorkflowId] = {
        metaStatus: d?.metaStatus ?? (b.hasMeta ? '' : 'na'),
        note: d?.note ?? '',
      };
    }
    setBrandEntries(init);
    // No-brand users skip step 1 entirely — straight to tasks.
    setStep(status.brandsForMorning.length === 0 ? 2 : 1);

    if (draftTasks && draftTasks.length > 0) {
      setTasks(draftTasks);
    } else {
      // Pre-fill suggestions from yesterday's tomorrowPlan (one bullet per line).
      const plan = status.yesterdayTomorrowPlan || '';
      const lines = plan
        .split(/[\n,•]+/g)
        .map(l => l.trim().replace(/^[-*]\s*/, ''))
        .filter(l => l.length > 0 && l.length <= 200)
        .slice(0, 6);
      if (lines.length > 0) {
        setTasks(lines.map(l => ({ title: l, clientWorkflowId: null, priority: 'medium' })));
      } else {
        setTasks([]);
      }
    }
  }, [visible, status]);

  // Persist draft on every change so a refresh / crash doesn't lose work.
  // Cleared on successful submit (see submit()) so the next day starts fresh.
  useEffect(() => {
    if (!visible || !status) return;
    try {
      localStorage.setItem(
        `robin.checkin.morning.draft.${status.dateIST}`,
        JSON.stringify({ brands: brandEntries, tasks }),
      );
    } catch { /* quota / private mode */ }
  }, [visible, status, brandEntries, tasks]);

  // Autofocus the task input when step 2 opens.
  useEffect(() => {
    if (visible && step === 2) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [visible, step]);

  if (!visible) return null;
  if (!status) return null;

  const brands = status.brandsForMorning;
  const allMetaPicked = brands.every(b => {
    const e = brandEntries[b.clientWorkflowId];
    return e && (e.metaStatus !== '' || !b.hasMeta);
  });

  const addTask = () => {
    const t = taskInput.trim();
    if (!t) return;
    if (tasks.length >= 20) {
      toast.error('Max 20 tasks per day. Edit the list instead.');
      return;
    }
    setTasks(p => [...p, {
      title: t.slice(0, 200),
      clientWorkflowId: taskBrandSel || null,
      priority: taskPriSel,
    }]);
    setTaskInput('');
    inputRef.current?.focus();
  };

  const removeTask = (idx: number) => setTasks(p => p.filter((_, i) => i !== idx));

  const submit = async () => {
    if (submitting) return;
    if (tasks.length === 0) {
      toast.error('Add at least one task for today.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        brands: brands.map(b => ({
          clientWorkflowId: b.clientWorkflowId,
          clientName: b.clientName,
          metaStatus: brandEntries[b.clientWorkflowId]?.metaStatus || 'na',
          note: brandEntries[b.clientWorkflowId]?.note || '',
        })),
        tasks,
      };
      await api.submitMorningCheckin(payload);
      // Wipe the draft now that the submit succeeded.
      try { localStorage.removeItem(`robin.checkin.morning.draft.${status.dateIST}`); } catch { /* */ }
      await refresh();
      celebrate();
      toast.success("Morning checkin done! Now let's get into the huddle.", { duration: 4000 });
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 1 → Step 2: only if all Meta-bearing brands have a chip picked.
  const next = () => {
    if (!allMetaPicked) {
      toast.error('Pick a Meta status for every brand.');
      return;
    }
    setStep(2);
  };

  // Safety net — if the modal somehow opens with morning already submitted
  // (server-side state out of sync), close ourselves and refresh. Prevents
  // a re-submit from creating duplicate ProjectTask docs.
  useEffect(() => {
    if (visible && status?.morning?.done) {
      close();
    }
  }, [visible, status?.morning?.done, close]);

  return (
    <div className="fixed inset-0 z-[150] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-2xl border border-border max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-br from-amber-400/15 via-orange-400/10 to-rose-400/15 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
              <Sunrise className="h-5 w-5 text-amber-700" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base sm:text-lg font-bold leading-tight">Good morning! Let's get the day going.</h2>
              <p className="text-[12px] text-muted-foreground leading-snug">
                Two quick steps, ~30 seconds. Then huddle's open.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className={`h-1.5 w-6 rounded-full ${step >= 1 ? 'bg-amber-500' : 'bg-muted'}`} />
              <span className={`h-1.5 w-6 rounded-full ${step >= 2 ? 'bg-amber-500' : 'bg-muted'}`} />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {step === 1 && (
            <>
              <div>
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Megaphone className="h-3.5 w-3.5 text-orange-600" />
                  Daily Meta pulse — one chip per brand
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Pick the current ad-account state. Add a one-liner only if there's a blocker.
                </p>
              </div>

              {brands.length === 0 && (
                <div className="rounded-xl bg-muted/40 border border-border p-5 text-center text-sm">
                  <p className="font-semibold">No brands assigned yet</p>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    Skip the brand pulse — just add today's tasks on the next step.
                  </p>
                </div>
              )}

              {brands.map((b: BrandForMorning) => (
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
              <div>
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                  What are you tackling today?
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Press Enter to add. Tag a brand to attach the task to their pipeline.
                </p>
                {status.yesterdayTomorrowPlan && tasks.length > 0 && (
                  <p className="text-[11px] text-emerald-700 mt-1">
                    Pre-filled from yesterday's plan. Edit or remove anything that doesn't apply.
                  </p>
                )}
              </div>

              {/* Add row */}
              <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                <input
                  ref={inputRef}
                  value={taskInput}
                  onChange={e => setTaskInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
                  placeholder="e.g. Launch Bhawna's reel for WOODSIFY"
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={taskBrandSel}
                    onChange={e => setTaskBrandSel(e.target.value)}
                    className="h-8 px-2 rounded-lg bg-background border border-border text-[12px]"
                  >
                    <option value="">No brand</option>
                    {brands.map(b => (
                      <option key={b.clientWorkflowId} value={b.clientWorkflowId}>{b.clientName}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    {['low', 'medium', 'high', 'urgent'].map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setTaskPriSel(p)}
                        className={
                          'h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors ' +
                          (taskPriSel === p
                            ? (p === 'urgent' ? 'bg-rose-500 text-white' :
                               p === 'high'   ? 'bg-orange-500 text-white' :
                               p === 'medium' ? 'bg-blue-500 text-white' :
                                                'bg-muted text-foreground')
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted')
                        }
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={addTask}
                    disabled={!taskInput.trim()}
                    className="ml-auto h-8 px-3 rounded-lg bg-amber-500 text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-40 hover:bg-amber-600"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
              </div>

              {/* Task list */}
              <div className="space-y-1.5">
                {tasks.map((t, i) => {
                  const brandName = t.clientWorkflowId ? brands.find(b => b.clientWorkflowId === t.clientWorkflowId)?.clientName : '';
                  return (
                    <div key={i} className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
                      <span className={
                        'h-1.5 w-1.5 rounded-full shrink-0 ' +
                        (t.priority === 'urgent' ? 'bg-rose-500' :
                         t.priority === 'high'   ? 'bg-orange-500' :
                         t.priority === 'medium' ? 'bg-blue-500' :
                                                   'bg-muted-foreground')
                      } />
                      <span className="text-sm font-medium min-w-0 truncate">{t.title}</span>
                      {brandName && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded">
                          {brandName}
                        </span>
                      )}
                      <button onClick={() => removeTask(i)} className="ml-auto h-5 w-5 rounded hover:bg-muted/60 flex items-center justify-center">
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  );
                })}
                {tasks.length === 0 && (
                  <p className="text-[12px] text-muted-foreground italic">Nothing added yet — type above and press Enter.</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 flex items-center justify-between gap-3 bg-card/60">
          {step === 2 ? (
            <button
              onClick={() => setStep(1)}
              className="text-[12px] font-semibold text-muted-foreground hover:text-foreground"
            >
              ← Back to brand pulse
            </button>
          ) : <span />}

          {step === 1 ? (
            <button
              onClick={next}
              className="h-9 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm"
            >
              Next · Today's tasks <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting || tasks.length === 0}
              className="h-9 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
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

function BrandRow({
  brand, value, onChange,
}: {
  brand: BrandForMorning;
  value: { metaStatus: string; note: string };
  onChange: (v: { metaStatus: string; note: string }) => void;
}) {
  const opts: Array<{ k: string; label: string; cls: string; Icon: any }> = brand.hasMeta
    ? [
        { k: 'running', label: 'Running', cls: 'bg-emerald-500 text-white',  Icon: Megaphone },
        { k: 'paused',  label: 'Paused',  cls: 'bg-amber-500 text-white',   Icon: Pause },
        { k: 'off',     label: 'Off',     cls: 'bg-rose-500 text-white',    Icon: PowerOff },
        { k: 'pending', label: 'Pending', cls: 'bg-blue-500 text-white',    Icon: CircleAlert },
      ]
    : [
        { k: 'na', label: 'No Meta service', cls: 'bg-muted text-muted-foreground', Icon: CircleAlert },
      ];

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-semibold truncate">{brand.clientName}</p>
        {!brand.hasMeta && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">(no meta)</span>
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
                (active ? `${o.cls} scale-105 shadow-sm` : 'bg-muted/60 text-muted-foreground hover:bg-muted')
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
          className="mt-2 w-full h-8 px-2.5 rounded-lg bg-muted/30 border border-border text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-400/30"
        />
      )}
    </div>
  );
}

export default MorningCheckinModal;
