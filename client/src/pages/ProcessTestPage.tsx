import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import {
  GraduationCap, Plus, Loader2, X, Check, CheckCircle2, XCircle,
  Trophy, RotateCcw, Trash2, Users, ArrowRight, ArrowLeft,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import * as api from '@/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * ProcessTestPage — training tests attached to SOPs (Sep 2026).
 *
 * Three modes in one page: the list, taking a test, and the result.
 * Scoring is entirely server-side — the client never receives the
 * correct answers while taking a test, only in the result payload after
 * submitting, so the answer key can't be read out of the network tab
 * mid-attempt.
 */

interface TestRow {
  _id: string;
  title: string;
  description?: string;
  department: string;
  processDocId?: string | null;
  questionCount: number;
  passMark: number;
  myBestScore: number | null;
  myPassed: boolean;
  myAttempts: number;
  teamStats?: { attempts: number; passed: number };
}
interface Question { question: string; options: string[] }
interface ResultReview {
  question: string; options: string[]; picked: number; correctIndex: number; correct: boolean;
}
interface Result {
  score: number; passed: boolean; correctCount: number; totalCount: number;
  passMark: number; review: ResultReview[];
}

const DEPARTMENTS = ['general', 'sales', 'meta', 'development', 'influencer', 'qa'];
const DEPT_LABEL: Record<string, string> = {
  general: 'General', sales: 'Sales', meta: 'Meta Ads',
  development: 'Development', influencer: 'UGC / Influencer', qa: 'QA',
};

type BlankQ = { question: string; options: string[]; correctIndex: number };
const blankQuestion = (): BlankQ => ({ question: '', options: ['', ''], correctIndex: 0 });

export default function ProcessTestPage() {
  const { user, role } = useAuth();
  const isAdmin = role === 'admin' || ((user as any)?.roles || []).includes('admin');

  const [tests, setTests]     = useState<TestRow[]>([]);
  const [docs, setDocs]       = useState<Array<{ _id: string; title: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Taking a test
  const [taking, setTaking]   = useState<{ id: string; title: string; questions: Question[] } | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [qIndex, setQIndex]   = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]   = useState<Result | null>(null);

  // Authoring
  const [building, setBuilding] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', department: 'general', processDocId: '', passMark: 70,
    questions: [blankQuestion()] as BlankQ[],
  });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.listProcessTests()
      .then((d: any) => setTests(Array.isArray(d) ? d : []))
      .catch(() => toast.error('Could not load tests'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => {
    api.listProcessDocs().then((d: any) => setDocs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const startTest = async (t: TestRow) => {
    try {
      const full = await api.getProcessTest(t._id);
      const qs: Question[] = full.questions || [];
      if (qs.length === 0) { toast.error('That test has no questions yet'); return; }
      setTaking({ id: t._id, title: t.title, questions: qs });
      setAnswers(new Array(qs.length).fill(-1));
      setQIndex(0);
      setResult(null);
    } catch { toast.error('Could not open that test'); }
  };

  const submit = async () => {
    if (!taking) return;
    if (answers.some(a => a < 0)) {
      if (!confirm('Some questions are unanswered — they will be marked wrong. Submit anyway?')) return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitProcessTest(taking.id, answers);
      setResult(res);
      load();
    } catch { toast.error('Could not submit — try again'); }
    finally { setSubmitting(false); }
  };

  const saveTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = form.questions
      .map(q => ({ ...q, options: q.options.map(o => o.trim()).filter(Boolean) }))
      .filter(q => q.question.trim() && q.options.length >= 2);
    if (!form.title.trim()) { toast.error('Give the test a title'); return; }
    if (clean.length === 0) { toast.error('Add at least one question with two options'); return; }
    setSaving(true);
    try {
      await api.createProcessTest({
        title: form.title, description: form.description, department: form.department,
        processDocId: form.processDocId || null, passMark: Number(form.passMark) || 70,
        questions: clean,
      });
      toast.success('Test published');
      setBuilding(false);
      setForm({ title: '', description: '', department: 'general', processDocId: '', passMark: 70, questions: [blankQuestion()] });
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  const removeTest = async (t: TestRow) => {
    if (!confirm(`Delete "${t.title}" and every attempt at it? This can't be undone.`)) return;
    try { await api.deleteProcessTest(t._id); toast.success('Test deleted'); load(); }
    catch { toast.error('Could not delete'); }
  };

  /* ───────────────────────── RESULT SCREEN ───────────────────────── */
  if (result && taking) {
    return (
      <AppLayout>
        <div className="space-y-4 page-transition-enter max-w-3xl mx-auto">
          <div className={`rounded-2xl border p-6 text-center ${
            result.passed ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-rose-500/5 border-rose-500/30'}`}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${
              result.passed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {result.passed ? <Trophy className="h-7 w-7" /> : <RotateCcw className="h-7 w-7" />}
            </div>
            <h2 className="text-2xl font-bold text-foreground">{result.score}%</h2>
            <p className={`text-sm font-semibold mt-1 ${result.passed ? 'text-emerald-400' : 'text-rose-400'}`}>
              {result.passed ? 'Passed' : `Not passed — ${result.passMark}% needed`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {result.correctCount} of {result.totalCount} correct · {taking.title}
            </p>
          </div>

          <div className="space-y-2">
            {result.review.map((r, i) => (
              <div key={i} className={`bg-card border rounded-xl p-4 ${r.correct ? 'border-border' : 'border-rose-500/30'}`}>
                <div className="flex items-start gap-2 mb-2">
                  {r.correct
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    : <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />}
                  <p className="text-sm font-semibold text-foreground">{i + 1}. {r.question}</p>
                </div>
                <div className="space-y-1 pl-6">
                  {r.options.map((o, oi) => (
                    <p key={oi} className={`text-xs px-2 py-1 rounded ${
                      oi === r.correctIndex ? 'bg-emerald-500/10 text-emerald-400 font-semibold'
                      : oi === r.picked     ? 'bg-rose-500/10 text-rose-400 line-through'
                                            : 'text-muted-foreground'}`}>
                      {o}
                      {oi === r.correctIndex && ' ← correct'}
                      {oi === r.picked && oi !== r.correctIndex && ' ← you picked'}
                    </p>
                  ))}
                  {r.picked === -1 && <p className="text-xs text-muted-foreground italic">You left this blank.</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => { setResult(null); setTaking(null); }}
              className="bg-card border border-border text-foreground px-4 py-2 rounded-lg text-xs font-semibold hover:bg-muted"
            >
              Back to tests
            </button>
            {!result.passed && (
              <button
                onClick={() => { const t = tests.find(x => x._id === taking.id); setResult(null); if (t) startTest(t); }}
                className="bg-primary hover:bg-primary/85 text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Retake
              </button>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  /* ───────────────────────── TAKING A TEST ───────────────────────── */
  if (taking) {
    const q = taking.questions[qIndex];
    const answered = answers.filter(a => a >= 0).length;
    return (
      <AppLayout>
        <div className="space-y-4 page-transition-enter max-w-2xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground truncate">{taking.title}</h2>
              <p className="text-xs text-muted-foreground">
                Question {qIndex + 1} of {taking.questions.length} · {answered} answered
              </p>
            </div>
            <button
              onClick={() => { if (confirm('Leave this test? Your answers will be lost.')) setTaking(null); }}
              className="text-muted-foreground hover:text-foreground p-2 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${((qIndex + 1) / taking.questions.length) * 100}%` }} />
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <p className="text-sm font-semibold text-foreground mb-4">{q.question}</p>
            <div className="space-y-2">
              {q.options.map((o, oi) => (
                <button
                  key={oi}
                  onClick={() => setAnswers(a => a.map((v, i) => i === qIndex ? oi : v))}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition flex items-center gap-3 ${
                    answers[qIndex] === oi
                      ? 'bg-primary/10 border-primary text-foreground font-semibold'
                      : 'bg-background border-border text-foreground/80 hover:border-primary/50'}`}
                >
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    answers[qIndex] === oi ? 'border-primary bg-primary' : 'border-input'}`}>
                    {answers[qIndex] === oi && <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />}
                  </span>
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setQIndex(i => Math.max(0, i - 1))}
              disabled={qIndex === 0}
              className="bg-card border border-border text-foreground px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Previous
            </button>
            {qIndex < taking.questions.length - 1 ? (
              <button
                onClick={() => setQIndex(i => i + 1)}
                className="bg-primary hover:bg-primary/85 text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
              >
                Next <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Submit test
              </button>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  /* ─────────────────────────── TEST LIST ─────────────────────────── */
  return (
    <AppLayout>
      <div className="space-y-5 page-transition-enter">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-border/80">
          <div>
            <h2 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-indigo-400" /> Process Training & Tests
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Short tests that prove an SOP actually landed before it's run on a live client account.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setBuilding(true)}
              className="bg-primary hover:bg-primary/85 text-primary-foreground px-3.5 py-2 rounded-lg text-xs font-semibold transition shadow-md shadow-primary/20 flex items-center gap-2 self-start"
            >
              <Plus className="h-3.5 w-3.5" /> New test
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-16 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : tests.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 text-center">
            <GraduationCap className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">No tests yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isAdmin ? 'Write one against your most-misapplied SOP.' : 'Nothing has been assigned to you yet.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {tests.map(t => (
              <div key={t._id} className="bg-card border border-border rounded-xl p-4 flex flex-col">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-500/10 text-indigo-400">
                    {DEPT_LABEL[t.department] || t.department}
                  </span>
                  {t.myPassed ? (
                    <span className="text-[10px] text-emerald-400 font-semibold inline-flex items-center gap-1">
                      <Trophy className="h-3 w-3" /> Passed {t.myBestScore}%
                    </span>
                  ) : t.myAttempts > 0 ? (
                    <span className="text-[10px] text-amber-400 font-semibold">Best {t.myBestScore}% · not passed</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground font-semibold">Not attempted</span>
                  )}
                </div>

                <p className="text-sm font-bold text-foreground">{t.title}</p>
                {t.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}

                <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                  <span>{t.questionCount} questions</span>
                  <span>Pass {t.passMark}%</span>
                  {t.teamStats && (
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {t.teamStats.passed}/{t.teamStats.attempts} team passes
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={() => startTest(t)}
                    className="flex-1 bg-primary hover:bg-primary/85 text-primary-foreground px-3 py-2 rounded-lg text-xs font-semibold transition inline-flex items-center justify-center gap-1.5"
                  >
                    {t.myAttempts > 0 ? <><RotateCcw className="h-3.5 w-3.5" /> Retake</> : <>Start test <ArrowRight className="h-3.5 w-3.5" /></>}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => removeTest(t)}
                      className="h-8 w-8 rounded-lg bg-card border border-border text-muted-foreground hover:text-rose-400 hover:border-rose-500/30 inline-flex items-center justify-center"
                      title="Delete test"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Test builder (admin) ─────────────────────────────────────── */}
        {building && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <form onSubmit={saveTest} className="bg-card border border-border rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h3 className="text-base font-bold text-foreground">New process test</h3>
                <button type="button" onClick={() => setBuilding(false)} className="text-muted-foreground hover:text-foreground p-1.5">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Test title *"
                  required
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-sm focus:outline-none focus:border-primary"
                />
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What this test covers"
                  className="w-full px-3 py-2 bg-background border border-input rounded-xl text-xs focus:outline-none focus:border-primary"
                />
                <div className="grid sm:grid-cols-3 gap-3">
                  <select
                    value={form.department}
                    onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                    className="px-3 py-2 bg-background border border-input rounded-xl text-xs focus:outline-none focus:border-primary"
                  >
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{DEPT_LABEL[d]}</option>)}
                  </select>
                  <select
                    value={form.processDocId}
                    onChange={e => setForm(f => ({ ...f, processDocId: e.target.value }))}
                    className="px-3 py-2 bg-background border border-input rounded-xl text-xs focus:outline-none focus:border-primary"
                  >
                    <option value="">No linked SOP</option>
                    {docs.map(d => <option key={d._id} value={d._id}>{d.title}</option>)}
                  </select>
                  <div className="flex items-center gap-2 px-3 py-2 bg-background border border-input rounded-xl text-xs">
                    <span className="text-muted-foreground shrink-0">Pass %</span>
                    <input
                      type="number" min={1} max={100}
                      value={form.passMark}
                      onChange={e => setForm(f => ({ ...f, passMark: Number(e.target.value) }))}
                      className="w-full bg-transparent focus:outline-none text-foreground font-semibold"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  {form.questions.map((q, qi) => (
                    <div key={qi} className="bg-background border border-border rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-muted-foreground shrink-0">Q{qi + 1}</span>
                        <input
                          value={q.question}
                          onChange={e => setForm(f => ({ ...f, questions: f.questions.map((x, i) => i === qi ? { ...x, question: e.target.value } : x) }))}
                          placeholder="Question"
                          className="flex-1 px-2.5 py-1.5 bg-card border border-input rounded-lg text-xs focus:outline-none focus:border-primary"
                        />
                        {form.questions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, questions: f.questions.filter((_, i) => i !== qi) }))}
                            className="text-muted-foreground hover:text-rose-400 p-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground pl-6">Click the circle to mark the correct answer.</p>
                      {q.options.map((o, oi) => (
                        <div key={oi} className="flex items-center gap-2 pl-6">
                          <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, questions: f.questions.map((x, i) => i === qi ? { ...x, correctIndex: oi } : x) }))}
                            className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${
                              q.correctIndex === oi ? 'border-emerald-500 bg-emerald-500' : 'border-input'}`}
                            title="Mark as the correct answer"
                          >
                            {q.correctIndex === oi && <Check className="h-2.5 w-2.5 text-white" />}
                          </button>
                          <input
                            value={o}
                            onChange={e => setForm(f => ({ ...f, questions: f.questions.map((x, i) => i === qi
                              ? { ...x, options: x.options.map((y, j) => j === oi ? e.target.value : y) } : x) }))}
                            placeholder={`Option ${oi + 1}`}
                            className="flex-1 px-2.5 py-1.5 bg-card border border-input rounded-lg text-xs focus:outline-none focus:border-primary"
                          />
                          {q.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setForm(f => ({ ...f, questions: f.questions.map((x, i) => i === qi
                                ? { ...x, options: x.options.filter((_, j) => j !== oi), correctIndex: Math.min(x.correctIndex, x.options.length - 2) } : x) }))}
                              className="text-muted-foreground hover:text-rose-400 p-1"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                      {q.options.length < 6 && (
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, questions: f.questions.map((x, i) => i === qi ? { ...x, options: [...x.options, ''] } : x) }))}
                          className="ml-6 text-[11px] text-primary font-semibold hover:underline"
                        >
                          + Add option
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, questions: [...f.questions, blankQuestion()] }))}
                    className="w-full bg-background border border-dashed border-border hover:border-primary/50 rounded-xl py-2 text-xs font-semibold text-muted-foreground hover:text-primary transition"
                  >
                    + Add question
                  </button>
                </div>
              </div>

              <div className="p-4 border-t border-border flex justify-end gap-3">
                <button type="button" onClick={() => setBuilding(false)} className="px-4 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-muted">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-primary hover:bg-primary/85 text-primary-foreground px-5 py-2 rounded-lg text-xs font-semibold transition shadow inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Publish test
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
